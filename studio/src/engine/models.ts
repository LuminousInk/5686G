import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CameraView, HomePlan, RoomType } from './house/types'
import { AssetPriority, assets, loadImage, yieldToBrowser } from './materials/textures'

const cache = new Map<string, Promise<THREE.Group>>()
const images = new Map<string, Promise<THREE.Texture>>()
let folder = 'models'
let entryModels: ReadonlySet<string> = new Set()
/** Models that could not be loaded this session. They are skipped so the rest of the home still appears. */
export const skippedModels: string[] = []

const roomModels: Partial<Record<RoomType, readonly string[]>> = {
  living: ['sectional_grey', 'sofa_beige', 'SheenChair', 'coffee_table_round_01', 'sideboard_midcentury', 'potted_plant_01', 'ceramic_vase_02'],
  kitchen: ['fridge_steel', 'bar_stool_wood', 'ceramic_vase_02', 'wooden_bowl_01'],
  dining: ['dining_chair_bentwood', 'wooden_bowl_01', 'sideboard_midcentury', 'ceramic_vase_02'],
  primary: ['bed_dark_headboard', 'dresser_tall'],
  bedroom: ['bed_dark_headboard', 'dresser_tall'],
  bath: ['toilet_modern'],
  powder: ['toilet_modern'],
  office: ['desk_lamp_black', 'dining_chair_bentwood'],
}

/** Only rank requests the builders actually make. Exterior views favor shared spaces behind glazing. */
export function modelsForEntry(plan: HomePlan, view?: CameraView): ReadonlySet<string> {
  const room = view?.room && plan.rooms.find(room => room.id === view.room)
  const rooms: RoomType[] = room ? [room.type] : ['living', 'dining', 'kitchen']
  return new Set(rooms.flatMap(type => roomModels[type] ?? []))
}

export function prioritizeModels(plan: HomePlan, view?: CameraView) {
  const previous = entryModels
  const current = modelsForEntry(plan, view)
  entryModels = current
  return () => { if (entryModels === current) entryModels = previous }
}

/** Phones load the low-texture copies (256-512 px) to stay well inside mobile GPU memory. */
export function setModelQuality(lo: boolean) {
  folder = lo ? 'models-lo' : 'models'
}

interface GltfJson {
  buffers?: { uri?: string; byteLength: number }[]
  [key: string]: unknown
}

function decodeBase64(base64: string): Uint8Array {
  const native = (Uint8Array as Uint8ArrayConstructor & { fromBase64?: (value: string) => Uint8Array }).fromBase64
  if (native) return native(base64)
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
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
  const bin = decodeBase64(uri.slice(comma + 1))
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

function modelLoader(priority: number) {
  const manager = new THREE.LoadingManager()
  manager.addHandler(/\.webp$/i, new class extends THREE.Loader<THREE.Texture> {
    override load(url: string, onLoad: (texture: THREE.Texture) => void, _onProgress?: unknown, onError?: (error: unknown) => void) {
      let pending = images.get(url)
      if (!pending) {
        pending = loadImage(url, false, priority).then(image => {
          const texture = new THREE.Texture(image)
          texture.flipY = false
          texture.needsUpdate = true
          return texture
        }).catch(error => {
          images.delete(url)
          throw error
        })
        images.set(url, pending)
      }
      // glTF samplers and transforms belong to each texture. The decoded image is shared.
      void pending.then(texture => onLoad(texture.clone()), error => onError?.(error))
    }
  }(manager))
  // The packaged models use plain buffers and external WebP images.
  return new GLTFLoader(manager)
}

/**
 * Load a Poly Haven model built by tools/build_assets.mjs (cached; returns the shared scene - clone to place).
 * A model that fails to load resolves to an empty group: one missing chair or rock must not stop the home loading.
 */
export function loadModel(id: string): Promise<THREE.Group> {
  const base = `./assets/${folder}/`
  const url = `${base}${id}.json`
  let p = cache.get(url)
  if (!p) {
    const priority = entryModels.has(id) ? AssetPriority.view : AssetPriority.rest
    p = assets.run(priority, async () => {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<GltfJson>
    })
      .then(async json => {
        await yieldToBrowser()
        return modelLoader(priority).parseAsync(gltfJsonToGlb(json), base)
      })
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
        cache.delete(url) // allow a later plan or retry to fetch it afresh
        return new THREE.Group()
      })
    cache.set(url, p)
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
