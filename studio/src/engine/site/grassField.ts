import * as THREE from 'three'
import { DataUtils } from 'three'
import { rng } from '../materials/textures'
import { wind } from './grass'
import type { QualitySettings } from '../quality'

/**
 * Dense lawn that follows the camera. Grass lives on a world-anchored grid (so it never swims): each ring of
 * instances covers an annulus around the view centre at a fixed spacing, snapped to that spacing. A mask texture
 * (height + lawn coverage) keeps grass off the house, terraces and planting beds. Rings crossfade by blade height.
 */

export interface LawnMask {
  /** world origin (min x, min z) and size of the mask square */
  x0: number
  z0: number
  size: number
  res: number
  height: (x: number, z: number) => number
  lawn: (x: number, z: number) => number
}

function maskTexture(m: LawnMask) {
  const data = new Uint16Array(m.res * m.res * 4)
  for (let j = 0; j < m.res; j++)
    for (let i = 0; i < m.res; i++) {
      const x = m.x0 + ((i + 0.5) / m.res) * m.size
      const z = m.z0 + ((j + 0.5) / m.res) * m.size
      const k = (j * m.res + i) * 4
      data[k] = DataUtils.toHalfFloat(m.height(x, z))
      data[k + 1] = DataUtils.toHalfFloat(m.lawn(x, z))
      data[k + 2] = 0
      data[k + 3] = DataUtils.toHalfFloat(1)
    }
  const t = new THREE.DataTexture(data, m.res, m.res, THREE.RGBAFormat, THREE.HalfFloatType)
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

function tuft(blades: number, segs: number, seed: number) {
  const rand = rng(seed)
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let b = 0; b < blades; b++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 0.045
    const bx = Math.cos(a) * r
    const bz = Math.sin(a) * r
    const yaw = rand() * Math.PI * 2
    const lean = 0.12 + rand() * 0.4
    const h = 0.6 + rand() * 0.4
    const w = 0.0075 + rand() * 0.005
    const dx = Math.cos(yaw)
    const dz = Math.sin(yaw)
    const sx = -dz
    const sz = dx
    const base = pos.length / 3
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const width = w * (1 - t * 0.9)
      const y = t * h
      const off = lean * t * t * h
      const cx = bx + dx * off
      const cz = bz + dz * off
      if (i < segs) {
        pos.push(cx - sx * width, y, cz - sz * width, cx + sx * width, y, cz + sz * width)
        uv.push(0, t, 1, t)
        nor.push(dx * 0.5, 0.85, dz * 0.5, dx * 0.5, 0.85, dz * 0.5)
      } else {
        pos.push(cx, y, cz)
        uv.push(0.5, 1)
        nor.push(dx * 0.5, 0.85, dz * 0.5)
      }
    }
    for (let i = 0; i < segs - 1; i++) {
      const a0 = base + i * 2
      idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2)
    }
    const l = base + (segs - 1) * 2
    idx.push(l, l + 1, l + 2)
  }
  return { pos, nor, uv, idx }
}

interface RingDef {
  s: number
  r0: number
  r1: number
  seed: number
  spread: number
  tuft: ReturnType<typeof tuft>
  offs: number[]
}

const fract = (x: number) => x - Math.floor(x)
const gh = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453)
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export class GrassField {
  readonly group = new THREE.Group()
  private center = { value: new THREE.Vector2() }
  private materials: THREE.MeshStandardMaterial[] = []
  private tex: THREE.DataTexture
  private rings: RingDef[] = []

  constructor(
    private mask: LawnMask,
    q: QualitySettings,
  ) {
    this.group.name = 'lawn'
    this.tex = maskTexture(mask)
    const k = q.tier === 'low' ? 0.52 : q.tier === 'medium' ? 0.8 : 1
    const lo = q.tier === 'low'
    // ring: spacing, inner radius, outer radius, blades per tuft, segments
    const rings: [number, number, number, number, number][] = [
      [0.075 / k, 0, 8 * k + 3, lo ? 5 : 6, 3],
      [0.15 / k, 7 * k + 1, 19 * k + 3, lo ? 5 : 6, lo ? 2 : 3],
      [0.28 / k, 18 * k, 40 * k + 4, lo ? 4 : 6, 2],
    ]
    rings.forEach(([s, r0, r1, blades, segs], i) => this.ring(s, r0, r1, blades, segs, i, mask))
  }

  private ring(s: number, r0: number, r1: number, blades: number, segs: number, seed: number, mask: LawnMask) {
    const offs: number[] = []
    const n = Math.ceil(r1 / s) + 1
    const pad = s * 2
    for (let j = -n; j <= n; j++)
      for (let i = -n; i <= n; i++) {
        const d = Math.hypot(i * s, j * s)
        if (d < r0 - pad - 1.5 || d > r1 + pad) continue
        offs.push(i * s, j * s)
      }
    const t = tuft(blades, segs, 31 + seed)
    this.rings.push({ s, r0, r1, seed, spread: seed === 0 ? 1 : seed === 1 ? 1.9 : 3.2, tuft: t, offs })
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2))
    g.setIndex(t.idx)
    g.setAttribute('iOff', new THREE.InstancedBufferAttribute(new Float32Array(offs), 2))
    g.instanceCount = offs.length / 2
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, side: THREE.DoubleSide })
    const u = {
      uCenter: this.center,
      uMask: { value: this.tex },
      uMaskBox: { value: new THREE.Vector4(mask.x0, mask.z0, mask.size, mask.size) },
      uRing: { value: new THREE.Vector4(s, r0, r1, seed) },
      uSpread: { value: seed === 0 ? 1 : seed === 1 ? 1.9 : 3.2 },
    }
    mat.userData.uniforms = u
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, u, { uTime: wind.uTime, uWind: wind.uWind })
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec2 iOff;
          uniform vec2 uCenter; uniform sampler2D uMask; uniform vec4 uMaskBox; uniform vec4 uRing; uniform float uSpread;
          uniform float uTime; uniform float uWind;
          varying vec3 vGrass; varying float vTip;
          float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `float sp = uRing.x;
          vec2 snapC = floor(uCenter / sp) * sp;
          vec2 wp = snapC + iOff;
          vec2 cell = floor(wp / sp + 0.5);
          float h1 = gh(cell + uRing.w * 7.13);
          float h2 = gh(cell + 17.31);
          float h3 = gh(cell + 3.77);
          wp += (vec2(h1, h2) - 0.5) * sp * 0.95;
          float yaw = h3 * 6.2831;
          float gc = cos(yaw); float gs = sin(yaw);
          vec3 objectNormal = normal;
          objectNormal.xz = mat2(gc, gs, -gs, gc) * objectNormal.xz;
          objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.5));`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 muv = (wp - uMaskBox.xy) / uMaskBox.zw;
          vec4 mk = texture2D(uMask, muv);
          float inBox = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
          float lawn = mix(1.0, mk.g, inBox);
          float gy = mix(0.0, mk.r, inBox);
          float dist = length(wp - uCenter);
          float fadeIn = uRing.y <= 0.0 ? 1.0 : smoothstep(uRing.y - 3.0, uRing.y + 2.0, dist);
          float fadeOut = 1.0 - smoothstep(uRing.z - 4.0, uRing.z, dist);
          float hs = (0.065 + 0.075 * fract(h3 * 7.7)) * lawn * fadeIn * fadeOut;
          // patchiness: slightly longer, lusher clumps
          hs *= 0.8 + 0.4 * gh(floor(wp * 0.7));
          vec3 transformed = position;
          transformed.y = position.y * hs;
          transformed.xz = mat2(gc, gs, -gs, gc) * position.xz * uSpread * (0.8 + hs * 2.5);
          float t = uv.y;
          vec2 wdir = normalize(vec2(1.0, 0.4));
          float ph = uTime * 1.6 + dot(wp, vec2(0.23, 0.17)) + sin(wp.x * 0.5 + wp.y * 0.37) * 1.4;
          float sway = (sin(ph) * 0.55 + sin(ph * 2.6 + 1.1) * 0.2 + 0.35) * uWind;
          transformed.xz += wdir * sway * t * t * hs * 0.5;
          transformed += vec3(wp.x, gy - 0.005, wp.y);
          vec3 base = vec3(0.028, 0.05, 0.009);
          vec3 tip = vec3(0.13, 0.2, 0.035);
          vec3 dry = vec3(0.26, 0.22, 0.09);
          vec3 col = mix(base, tip, smoothstep(0.0, 1.0, t));
          float v = gh(cell * 1.31 + 9.0);
          col = mix(col, dry * mix(0.75, 1.1, t), smoothstep(0.72, 1.0, v) * 0.7);
          col *= 0.8 + 0.4 * fract(v * 13.7);
          vGrass = col; vTip = t;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrass; varying float vTip;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb *= vGrass;')
    }
    mat.customProgramCacheKey = () => `lawn-ring-${seed}`
    this.materials.push(mat)
    const mesh = new THREE.Mesh(g, mat)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = true
    this.group.add(mesh)
  }

  /** Replace the coverage mask (after the footprint changed). */
  setMask(terrain: { heightAt(x: number, z: number): number }, lawn: (x: number, z: number) => number) {
    this.mask = { ...this.mask, height: (x, z) => terrain.heightAt(x, z), lawn }
    const next = maskTexture({ ...this.mask, res: Math.min(this.mask.res, 512) })
    const old = this.tex
    this.tex = next
    for (const m of this.materials) {
      const sh = (m.userData.uniforms as { uMask: { value: THREE.Texture } } | undefined)
      if (sh) sh.uMask.value = next
    }
    old.dispose()
  }

  /** Centre the rings on the part of the ground the camera is looking at. */
  update(camera: THREE.Camera) {
    const p = camera.position
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    const ahead = THREE.MathUtils.clamp(p.y * 1.2, 0, 26)
    const h = Math.hypot(dir.x, dir.z) || 1
    this.center.value.set(p.x + (dir.x / h) * ahead, p.z + (dir.z / h) * ahead)
  }

  /** Real blades for the path tracer: the tufts in view within `maxDist`, posed exactly as the shader places them. */
  bake(camera: THREE.PerspectiveCamera, maxDist = 16, maxTufts = 45000): THREE.Mesh | null {
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const C = this.center.value
    const P: number[] = []
    const N: number[] = []
    const COL: number[] = []
    const I: number[] = []
    const v = new THREE.Vector3()
    let count = 0
    const base = new THREE.Color(0.028, 0.05, 0.009)
    const tip = new THREE.Color(0.13, 0.2, 0.035)
    const dry = new THREE.Color(0.26, 0.22, 0.09)
    for (const r of this.rings) {
      const sx = Math.floor(C.x / r.s) * r.s
      const sz = Math.floor(C.y / r.s) * r.s
      for (let k = 0; k < r.offs.length; k += 2) {
        if (count >= maxTufts) break
        let wx = sx + r.offs[k]
        let wz = sz + r.offs[k + 1]
        const cx = Math.floor(wx / r.s + 0.5)
        const cz = Math.floor(wz / r.s + 0.5)
        const h1 = gh(cx + r.seed * 7.13, cz + r.seed * 7.13)
        const h2 = gh(cx + 17.31, cz + 17.31)
        const h3 = gh(cx + 3.77, cz + 3.77)
        wx += (h1 - 0.5) * r.s * 0.95
        wz += (h2 - 0.5) * r.s * 0.95
        const camD = Math.hypot(wx - camera.position.x, wz - camera.position.z)
        if (camD > maxDist) continue
        const lawn = this.mask.lawn(wx, wz)
        if (lawn <= 0) continue
        const gy = this.mask.height(wx, wz)
        if (!frustum.containsPoint(v.set(wx, gy + 0.05, wz))) continue
        const dist = Math.hypot(wx - C.x, wz - C.y)
        const fadeIn = r.r0 <= 0 ? 1 : smooth(r.r0 - 3, r.r0 + 2, dist)
        const fadeOut = 1 - smooth(r.r1 - 4, r.r1, dist)
        let hs = (0.065 + 0.075 * fract(h3 * 7.7)) * lawn * fadeIn * fadeOut
        hs *= 0.8 + 0.4 * gh(Math.floor(wx * 0.7), Math.floor(wz * 0.7))
        if (hs < 0.012) continue
        count++
        const yaw = h3 * Math.PI * 2
        const c = Math.cos(yaw)
        const s = Math.sin(yaw)
        const spread = r.spread * (0.8 + hs * 2.5)
        const vv = gh(cx * 1.31 + 9, cz * 1.31 + 9)
        const tone = 0.8 + 0.4 * fract(vv * 13.7)
        const b0 = P.length / 3
        const t = r.tuft
        for (let i = 0; i < t.pos.length; i += 3) {
          const px = t.pos[i] * spread
          const pz = t.pos[i + 2] * spread
          P.push(wx + c * px - s * pz, gy - 0.005 + t.pos[i + 1] * hs, wz + s * px + c * pz)
          const nx = t.nor[i]
          const nz = t.nor[i + 2]
          N.push(c * nx - s * nz, t.nor[i + 1], s * nx + c * nz)
          const tt = t.uv[(i / 3) * 2 + 1]
          const col = base.clone().lerp(tip, tt * tt * (3 - 2 * tt))
          col.lerp(dry.clone().multiplyScalar(0.75 + 0.35 * tt), smooth(0.72, 1, vv) * 0.7).multiplyScalar(tone)
          COL.push(col.r, col.g, col.b)
        }
        for (const ix of t.idx) I.push(b0 + ix)
      }
    }
    if (!count) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((P.length / 3) * 2), 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(COL, 3))
    g.setIndex(new THREE.Uint32BufferAttribute(I, 1))
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide }))
    m.receiveShadow = true
    return m
  }

  dispose() {
    this.tex.dispose()
    for (const m of this.materials) m.dispose()
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.geometry.dispose()
    })
  }
}
