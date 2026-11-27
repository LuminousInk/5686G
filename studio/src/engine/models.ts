import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// No meshopt decoder: it is WebAssembly, and a strict host (the claude.ai artifact CSP) refuses to compile it.
const loader = new GLTFLoader()
const cache = new Map<string, Promise<THREE.Group>>()
let folder = 'models'
/** Models that could not be loaded this session. They are skipped so the rest of the home still appears. */
export const skippedModels: string[] = []

/** Phones load the low-texture copies (256-512 px) to stay well inside mobile GPU memory. */
export function setModelQuality(lo: boolean) {
  folder = lo ? 'models-lo' : 'models'
}

interface GltfJson {
  buffers?: { uri?: string; byteLength: number }[]
  [key: string]: unknown
}

/**
 * glTF JSON whose single buffer is inline base64 -> a GLB in memory. Handing the data: URI to GLTFLoader would make
 * it fetch() the URI, which a strict host refuses (connect-src), so the buffer becomes the GLB's binary chunk.
 * Textures stay external, same-origin files (see tools/build_assets.mjs).
 */
export function gltfJsonToGlb(json: GltfJson): ArrayBuffer {
  const buffers = json.buffers ?? []
  if (buffers.length !== 1) throw new Error(`expected one buffer, got ${buffers.length}`)
  const uri = buffers[0].uri ?? ''
  const comma = uri.indexOf(',')
  if (!uri.startsWith('data:') || comma < 0) throw new Error('the buffer is not inline base64')
  const raw = atob(uri.slice(comma + 1))
  const bin = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i)
  // JSON.stringify drops the undefined uri, which tells GLTFLoader to use the binary chunk
  const head = new TextEncoder().encode(JSON.stringify({ ...json, buffers: [{ ...buffers[0], uri: undefined, byteLength: bin.length }] }))
  const jsonLen = Math.ceil(head.length / 4) * 4
  const binLen = Math.ceil(bin.length / 4) * 4
  const total = 12 + 8 + jsonLen + 8 + binLen
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true) // 'glTF'
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)
  dv.setUint32(12, jsonLen, true)
  dv.setUint32(16, 0x4e4f534a, true) // 'JSON'
  out.set(head, 20)
  out.fill(0x20, 20 + head.length, 20 + jsonLen) // JSON chunk is padded with spaces
  const o = 20 + jsonLen
  dv.setUint32(o, binLen, true)
  dv.setUint32(o + 4, 0x004e4942, true) // 'BIN\0'
  out.set(bin, o + 8)
  return out.buffer
}

/**
 * Load a Poly Haven model built by tools/build_assets.mjs (cached; returns the shared scene - clone to place).
 * A model that fails to load resolves to an empty group: one missing chair or rock must not stop the home loading.
 */
export function loadModel(id: string): Promise<THREE.Group> {
  let p = cache.get(id)
  if (!p) {
    const base = `./assets/${folder}/`
    p = fetch(`${base}${id}.json`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<GltfJson>
      })
      .then(json => loader.parseAsync(gltfJsonToGlb(json), base))
      .then(g => {
        g.scene.traverse(o => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            m.castShadow = true
            m.receiveShadow = true
            const mat = m.material as THREE.MeshStandardMaterial
            if (mat.map) mat.map.anisotropy = 4
          }
        })
        return g.scene
      })
      .catch(err => {
        console.warn(`model ${id} skipped:`, err)
        skippedModels.push(id)
        cache.delete(id) // a later load (Try again, another plan) fetches it afresh
        return new THREE.Group()
      })
    cache.set(id, p)
  }
  return p
}

/** All meshes of a model as separate pieces (rock sets hold several rocks). */
export async function modelPieces(id: string): Promise<THREE.Mesh[]> {
  const scene = await loadModel(id)
  const out: THREE.Mesh[] = []
  scene.updateMatrixWorld(true)
  scene.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    // bake the node transform and centre the piece on its base
    const g = m.geometry.clone()
    g.applyMatrix4(m.matrixWorld)
    g.computeBoundingBox()
    const b = g.boundingBox!
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
    g.computeBoundingBox()
    g.computeBoundingSphere()
    const mesh = new THREE.Mesh(g, m.material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = `${id}:${m.name}`
    out.push(mesh)
  })
  return out
}

/**
 * Facing fixes, in radians about +y, for models whose front does not face +z (the convention of every placement in
 * src/engine/interior): applied before measuring, so sizes refer to the corrected orientation.
 */
export const MODEL_YAW: Record<string, number> = {
  bed_dark_headboard: Math.PI / 2,
  bed_upholstered_white: -Math.PI / 2,
  dresser_tall: -Math.PI / 2,
  vanity_floating: Math.PI / 2,
  toilet_modern: -Math.PI / 2,
  basin_mixer_dark: Math.PI / 2,
}

/**
 * Clone a model, turn it to face +z, and scale it uniformly: `size` = largest horizontal dimension, `width` = x
 * extent, `depth` = z extent, `height` = y extent (meters; the last one given wins). `width` and `depth` together fit
 * the footprint exactly (non-uniform). Rests on y = 0, centred on x and z.
 */
export async function placeModel(id: string, opts: { size?: number; width?: number; depth?: number; height?: number } = {}): Promise<THREE.Group> {
  const src = await loadModel(id)
  const g = src.clone(true)
  g.rotation.y = MODEL_YAW[id] ?? 0
  g.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(g)
  const wrap = new THREE.Group()
  wrap.name = id
  // a skipped model is an empty group: nothing to measure or place
  if (box.isEmpty()) return wrap
  const s = box.getSize(new THREE.Vector3())
  let k = 1
  if (opts.size) k = opts.size / Math.max(s.x, s.z)
  if (opts.width) k = opts.width / s.x
  if (opts.depth) k = opts.depth / s.z
  if (opts.height) k = opts.height / s.y
  // width and depth together fit a footprint exactly (a little stretch reads fine on beds and rugs)
  const kx = opts.width && opts.depth ? opts.width / s.x : k
  const kz = opts.width && opts.depth ? opts.depth / s.z : k
  const ky = opts.width && opts.depth && !opts.height ? Math.sqrt(kx * kz) : k
  // the scale applies before the facing turn: a quarter turn swaps x and z
  const quarter = Math.abs(Math.sin(g.rotation.y)) > 0.5
  g.scale.set(quarter ? kz : kx, ky, quarter ? kx : kz)
  // rest on y=0, centred
  const c = box.getCenter(new THREE.Vector3())
  g.position.set(-c.x * kx, -box.min.y * ky, -c.z * kz)
  wrap.add(g)
  return wrap
}
