import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { Engine } from '../Engine'
import { ensureLayout, lightmapTargets } from './lightmaps'

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

function exportable(m: THREE.Mesh): THREE.Material | null {
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return null
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial
  if (!mat || !mat.isMeshStandardMaterial) return null
  if (mat.name === 'glass' || mat.transparent || mat.alphaTest > 0 || mat.opacity < 1) return null
  return mat
}

export async function exportForBake(engine: Engine): Promise<BakePayload> {
  const house = engine.house
  if (!house || !engine.plan) throw new Error('no home loaded')
  const interior = engine.interior?.group ?? null
  const layout = ensureLayout(house, interior)
  const targets = new Set(lightmapTargets(house, interior))
  const root = new THREE.Scene()
  const mats = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  engine.scene.updateMatrixWorld(true)
  let lm = 0
  let occ = 0
  engine.scene.traverseVisible(o => {
    const m = o as THREE.Mesh
    const mat = exportable(m)
    if (!mat) return
    const src = m.geometry
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', src.getAttribute('position').clone())
    if (src.getAttribute('normal')) g.setAttribute('normal', src.getAttribute('normal').clone())
    const isTarget = targets.has(m)
    // the lightmap UVs become the only UV set, so Blender bakes into them without any lookup by name
    if (isTarget) g.setAttribute('uv', src.getAttribute('uv1').clone())
    if (src.index) g.setIndex(src.index.clone())
    g.applyMatrix4(m.matrixWorld)
    const out = new THREE.Mesh(g, bakeMaterial(mat, mats))
    out.name = isTarget ? `LM_${lm++}_${m.name}` : `OCC_${occ++}`
    root.add(out)
  })
  if (lm !== targets.size) throw new Error(`exported ${lm} of ${targets.size} lightmap targets (hidden?)`)
  const glb = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false })) as ArrayBuffer
  const width = 1024
  const height = 512
  const sky = engine.sky.worldSky(width, height)
  if (!sky) throw new Error('sky not loaded')
  const s = engine.sky
  const e = s.sun.visible ? s.sunIntensity : 0
  return {
    glb,
    sky,
    meta: {
      plan: engine.plan.id,
      preset: s.preset.id,
      signature: layout.signature,
      size: layout.size,
      density: layout.density,
      charts: layout.charts,
      sky: { width, height },
      sun: { dir: [s.sunDir.x, s.sunDir.y, s.sunDir.z], rgb: [s.sunColor.r * e, s.sunColor.g * e, s.sunColor.b * e] },
    },
  }
}
