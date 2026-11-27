import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { Engine } from '../Engine'
import { bakeSignature, collectBakeMeshes } from './bakeScene'
import { ensureLayout } from './lightmaps'

/**
 * Packs the loaded home for the offline bake (tools/bake): one GLB with the lightmap targets (named LM_*, their atlas
 * UVs as the only UV set) and every other opaque mesh as an occluder (OCC_*), all in world space with plain albedo
 * materials; plus the world-space light-casting sky and the sun, so Blender lights the scene exactly like the app.
 */

export interface BakeMetaOut {
  plan: string
  preset: string
  signature: string
  size: number
  density: number
  charts: number
  sky: { width: number; height: number }
  /** world direction toward the sun and its irradiance (three.js units, 0 when the preset has no sun) */
  sun: { dir: [number, number, number]; rgb: [number, number, number] }
}

export interface BakePayload {
  glb: ArrayBuffer
  sky: Float32Array
  meta: BakeMetaOut
}

const albedoOfTexture = new WeakMap<THREE.Texture, THREE.Color>()

function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Average colour of a texture in linear space (16 x 16 downsample). */
function textureAverage(t: THREE.Texture): THREE.Color {
  let c = albedoOfTexture.get(t)
  if (c) return c
  c = new THREE.Color(1, 1, 1)
  const img = t.image as CanvasImageSource & { width: number; height: number }
  if (img && img.width && !(t as THREE.DataTexture).isDataTexture) {
    try {
      const cv = document.createElement('canvas')
      cv.width = cv.height = 16
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0, 16, 16)
      const d = ctx.getImageData(0, 0, 16, 16).data
      let r = 0
      let g = 0
      let b = 0
      const srgb = t.colorSpace === THREE.SRGBColorSpace
      for (let i = 0; i < d.length; i += 4) {
        const f = (v: number) => (srgb ? srgbToLinear(v / 255) : v / 255)
        r += f(d[i])
        g += f(d[i + 1])
        b += f(d[i + 2])
      }
      const n = d.length / 4
      c.setRGB(r / n, g / n, b / n)
    } catch {
      /* unreadable image: keep white */
    }
  }
  albedoOfTexture.set(t, c)
  return c
}

function bakeMaterial(src: THREE.Material, cache: Map<THREE.Material, THREE.MeshStandardMaterial>) {
  let m = cache.get(src)
  if (!m) {
    const s = src as THREE.MeshStandardMaterial
    const color = s.color ? s.color.clone() : new THREE.Color(0.7, 0.7, 0.7)
    if (s.map) color.multiply(textureAverage(s.map))
    // keep bounce light plausible: nothing in a home is a perfect absorber or reflector
    color.r = THREE.MathUtils.clamp(color.r, 0.02, 0.9)
    color.g = THREE.MathUtils.clamp(color.g, 0.02, 0.9)
    color.b = THREE.MathUtils.clamp(color.b, 0.02, 0.9)
    m = new THREE.MeshStandardMaterial({ color, roughness: THREE.MathUtils.clamp(s.roughness ?? 0.8, 0.2, 1), metalness: 0 })
    m.name = src.name || 'mat'
    cache.set(src, m)
  }
  return m
}

export async function exportForBake(engine: Engine): Promise<BakePayload> {
  const house = engine.house
  if (!house || !engine.plan) throw new Error('no home loaded')
  const { site, sky: s } = engine
  const interior = engine.interior?.group ?? null
  const meshes = collectBakeMeshes(house, interior, site)
  const signature = bakeSignature(house, meshes, s.preset)
  const { layout } = ensureLayout(house, meshes)
  const root = new THREE.Scene()
  const mats = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  let lm = 0
  let occ = 0
  const add = (m: THREE.Mesh, mat: THREE.Material, isTarget: boolean) => {
    const src = m.geometry
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', src.getAttribute('position').clone())
    if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone())
    // Blender needs the atlas coordinates as the first UV set.
    if (isTarget) g.setAttribute('uv', src.getAttribute('uv1').clone())
    if (src.index) g.setIndex(src.index.clone())
    g.applyMatrix4(m.matrixWorld)
    const out = new THREE.Mesh(g, bakeMaterial(mat, mats))
    out.name = isTarget ? `LM_${lm++}_${m.name}` : `OCC_${occ++}`
    root.add(out)
  }
  for (const { mesh, material, target } of meshes) add(mesh, material, target)

  // The canyon mesh is tessellated differently on phones. Bake a fixed representation of the authored surface.
  if (site?.terrain.hillside) {
    const ground = site.group.getObjectByName('Coastal canyon') as THREE.Mesh | undefined
    const retaining = site.group.getObjectByName('Board-formed terrace walls') as THREE.Mesh | undefined
    if (ground && retaining) {
      const terrain = site.terrain.hillside.buildSurface(ground.material as THREE.Material, retaining.material as THREE.Material, true)
      for (const mesh of terrain.children as THREE.Mesh[]) {
        add(mesh, mesh.material as THREE.Material, false)
        mesh.geometry.dispose()
      }
    }
  }

  const width = 1024
  const height = 512
  const sky = s.worldSky(width, height)
  if (!sky) throw new Error('sky not loaded')
  const e = s.sun.visible ? s.sunIntensity : 0
  const meta: BakeMetaOut = {
    plan: house.plan.id,
    preset: s.preset.id,
    signature,
    size: layout.size,
    density: layout.density,
    charts: layout.charts,
    sky: { width, height },
    sun: { dir: [s.sunDir.x, s.sunDir.y, s.sunDir.z], rgb: [s.sunColor.r * e, s.sunColor.g * e, s.sunColor.b * e] },
  }
  const glb = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false })) as ArrayBuffer
  return { glb, sky, meta }
}
