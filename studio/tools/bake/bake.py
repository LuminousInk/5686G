#!/usr/bin/env python3
"""Bakes one interior lightmap with Cycles from a home exported by the app (window.__bakeExport, see tools/bake.mjs).

    /root/.venvs/bake/bin/python tools/bake/bake.py <prefix> <out_dir> [--samples 256]

Reads <prefix>.glb, <prefix>.sky.f32 and <prefix>.json; writes <out_dir>/<plan>-<preset>.webp (atlas size),
<plan>-<preset>-1k.webp (phones) and <plan>-<preset>.json.

What is baked: light from the sky (direct through windows + all bounces) plus the bounce of the sun, but NOT the direct
sun, which the app draws in real time with shadows. Two bakes give exactly that: sky with direct + indirect, then sun
with indirect only. Values are Cycles' diffuse light passes (outgoing = albedo x value); three.js wants irradiance,
so meta.scale = pi. Rows are stored with the app's v = 0 first (the first row WebGL uploads).
Encoding: RGBE in lossless WebP (mantissa rows on top, exponent rows below), the format of the app's skies.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time

import bpy
import cv2
import numpy as np
from mathutils import Vector
from PIL import Image


def rgbe_webp(rgb: np.ndarray, path: str) -> None:
    m = rgb.max(axis=2)
    frac, exp = np.frexp(m)
    valid = m > 1e-32
    scale = np.where(valid, frac * 256.0 / np.maximum(m, 1e-32), 0)
    mant = np.clip(np.floor(rgb * scale[..., None]), 0, 255).astype(np.uint8)
    e = np.where(valid, exp + 128, 0).clip(0, 255).astype(np.uint8)
    h, w, _ = rgb.shape
    packed = np.zeros((h * 2, w, 3), np.uint8)
    packed[:h] = mant
    packed[h:] = e[..., None]
    Image.fromarray(packed, 'RGB').save(path, 'WEBP', lossless=True, quality=100, method=4)


def setup(meta: dict, prefix: str, samples: int):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'
    cy.samples = samples
    cy.use_denoising = False
    cy.max_bounces = 8
    # halls and corners are lit almost only by bounces: too few bounces leaves them black and noisy
    cy.diffuse_bounces = 6
    cy.glossy_bounces = 1
    cy.transmission_bounces = 0
    cy.transparent_max_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    # clamp indirect fireflies (they showed as bright specks on dark floors)
    cy.sample_clamp_indirect = 6.0
    sc.render.threads_mode = 'AUTO'
    bk = sc.render.bake
    # no margin: coverage must mark exactly the chart texels; denoise() grows the charts into their gutters itself
    bk.margin = 0
    bk.margin_type = 'EXTEND'
    bk.use_clear = True
    bk.target = 'IMAGE_TEXTURES'

    bpy.ops.import_scene.gltf(filepath=prefix + '.glb')

    # world: the app's light-casting sky; rows arrive zenith first, Blender's pixel buffer starts at the bottom
    w, h = meta['sky']['width'], meta['sky']['height']
    sky = np.fromfile(prefix + '.sky.f32', dtype=np.float32).reshape(h, w, 3)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.flipud(sky)
    img = bpy.data.images.new('sky', w, h, float_buffer=True)
    img.pixels.foreach_set(rgba.ravel())
    world = bpy.data.worlds.new('world')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = img
    env.interpolation = 'Linear'
    nt.links.new(env.outputs['Color'], nt.nodes['Background'].inputs['Color'])

    # sun: three.js (x, y, z) -> Blender (x, -z, y); a sun lamp shines along its local -Z
    sx, sy, sz = meta['sun']['dir']
    d = Vector((sx, -sz, sy)).normalized()
    rgb = meta['sun']['rgb']
    e = max(rgb)
    light = bpy.data.lights.new('sun', 'SUN')
    light.energy = e
    light.color = [c / e for c in rgb] if e > 0 else (1.0, 1.0, 1.0)
    light.angle = math.radians(0.53)
    sun = bpy.data.objects.new('sun', light)
    sc.collection.objects.link(sun)
    sun.rotation_mode = 'QUATERNION'
    sun.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)

    size = meta['size']
    atlas = bpy.data.images.new('atlas', size, size, float_buffer=True, alpha=True)
    targets = [o for o in sc.objects if o.type == 'MESH' and o.name.startswith('LM_')]
    done = set()
    for o in targets:
        o.data.uv_layers.active_index = 0
        for slot in o.material_slots:
            mat = slot.material
            if mat is None or mat.name in done:
                continue
            done.add(mat.name)
            mat.use_nodes = True
            node = mat.node_tree.nodes.new('ShaderNodeTexImage')
            node.image = atlas
            mat.node_tree.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    for o in targets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    return sc, world, light, atlas, len(targets)


def grow(rgb: np.ndarray, cover: np.ndarray, steps: int) -> np.ndarray:
    """Extend every chart into the empty gutter around it (so filtering never reads black)."""
    out = np.where(cover[..., None], rgb, 0).astype(np.float32)
    m = cover.astype(np.float32)
    for _ in range(steps):
        num = cv2.blur(out * m[..., None], (3, 3))
        den = cv2.blur(m, (3, 3))
        add = (m < 0.5) & (den > 0)
        out[add] = num[add] / den[add][..., None]
        m = np.where(add, 1.0, m).astype(np.float32)
    return out


def oidn_lightmap(rgb: np.ndarray) -> np.ndarray | None:
    """Intel Open Image Denoise, lightmap filter (HDR). bpy has already loaded the TBB it links against."""
    try:
        import oidn
    except Exception as err:  # noqa: BLE001 - optional dependency
        print('oidn unavailable, falling back to a blur:', err)
        return None
    h, w, _ = rgb.shape
    src = np.ascontiguousarray(rgb, dtype=np.float32)
    out = np.zeros_like(src)
    dev = oidn.NewDevice()
    oidn.CommitDevice(dev)
    flt = oidn.NewFilter(dev, 'RTLightmap')
    oidn.SetSharedFilterImage(flt, 'color', src, oidn.FORMAT_FLOAT3, w, h)
    oidn.SetSharedFilterImage(flt, 'output', out, oidn.FORMAT_FLOAT3, w, h)
    oidn.CommitFilter(flt)
    oidn.ExecuteFilter(flt)
    err = oidn.GetDeviceError(dev)
    oidn.ReleaseFilter(flt)
    oidn.ReleaseDevice(dev)
    return out if not err else None


def denoise(rgb: np.ndarray, cover: np.ndarray, pad_steps: int = 6) -> np.ndarray:
    """Fill gutters, denoise the atlas (OIDN, else a coverage-normalised blur), keep chart texels, refill gutters."""
    filled = grow(rgb, cover, pad_steps)
    out = oidn_lightmap(filled)
    if out is None:
        m = cover.astype(np.float32)
        num = cv2.GaussianBlur(rgb * m[..., None], (9, 9), 1.5)
        den = cv2.GaussianBlur(m, (9, 9), 1.5)
        out = num / np.maximum(den, 1e-6)[..., None]
    return grow(np.maximum(out, 0), cover, pad_steps)


def bake_pass(atlas, pass_filter: set[str]) -> np.ndarray:
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=pass_filter, use_clear=True, margin=0)
    px = np.empty(atlas.size[0] * atlas.size[1] * 4, np.float32)
    atlas.pixels.foreach_get(px)
    return px.reshape(atlas.size[1], atlas.size[0], 4)


def main() -> None:
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    prefix, out_dir = args[0], args[1]
    samples = int(args[args.index('--samples') + 1]) if '--samples' in args else 256
    meta = json.load(open(prefix + '.json'))
    t0 = time.time()
    sc, world, light, atlas, n = setup(meta, prefix, samples)
    bg = world.node_tree.nodes['Background']
    energy = light.energy

    # 1) sky only: direct + indirect
    light.energy = 0
    bg.inputs['Strength'].default_value = 1.0
    sky = bake_pass(atlas, {'DIRECT', 'INDIRECT'})
    t1 = time.time()
    # 2) sun only: indirect (its bounce); the direct sun is drawn live by the app
    total = sky[..., :3].copy()
    if energy > 0:
        light.energy = energy
        bg.inputs['Strength'].default_value = 0.0
        sun = bake_pass(atlas, {'INDIRECT'})
        total += sun[..., :3]
    t2 = time.time()
    total = np.maximum(total, 0)
    cover = sky[..., 3] > 0.5
    total = denoise(total, cover)

    # Blender's glTF import flips V (glTF's origin is top-left, Blender's bottom-left), so the baked rows run opposite
    # to the app's uv1: flip them back so the first stored row is the app's v = 0
    total = np.ascontiguousarray(total[::-1])
    os.makedirs(out_dir, exist_ok=True)
    name = f"{meta['plan']}-{meta['preset']}"
    rgbe_webp(total, os.path.join(out_dir, f'{name}.webp'))
    half = total.reshape(total.shape[0] // 2, 2, total.shape[1] // 2, 2, 3).mean(axis=(1, 3))
    rgbe_webp(half, os.path.join(out_dir, f'{name}-1k.webp'))
    out_meta = {k: meta[k] for k in ('plan', 'preset', 'signature', 'size', 'density')}
    out_meta['scale'] = math.pi
    json.dump(out_meta, open(os.path.join(out_dir, f'{name}.json'), 'w'))
    cover = float((sky[..., 3] > 0.5).mean())
    print(f'BAKED {name}: {n} targets, {samples} spp, sky {t1 - t0:.0f}s, sun {t2 - t1:.0f}s, '
          f'coverage {cover:.2f}, mean {total.mean():.3f}, max {total.max():.2f}')


if __name__ == '__main__':
    main()
