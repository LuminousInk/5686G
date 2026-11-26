import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const cache = new Map<string, Promise<THREE.Group>>()
let folder = 'models'
/** Phones load the low-texture copies (256-512 px) to stay well inside mobile GPU memory. */
export function setModelQuality(lo: boolean) {
  folder = lo ? 'models-lo' : 'models'
}

/** Load a Poly Haven model built by tools/build_assets.mjs (cached; returns the shared scene - clone to place). */
export function loadModel(id: string): Promise<THREE.Group> {
  let p = cache.get(id)
  if (!p) {
    // self-contained glTF JSON (web hosts serve .json, not .glb)
    p = fetch(`./assets/${folder}/${id}.json`)
      .then(r => {
        if (!r.ok) throw new Error(`model ${id}: ${r.status}`)
        return r.text()
      })
      .then(text => loader.parseAsync(text, ''))
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

/** Clone a model and scale it so its largest horizontal dimension equals `size` meters (optional). */
export async function placeModel(id: string, opts: { size?: number; height?: number } = {}): Promise<THREE.Group> {
  const src = await loadModel(id)
  const g = src.clone(true)
  const box = new THREE.Box3().setFromObject(g)
  const s = box.getSize(new THREE.Vector3())
  let k = 1
  if (opts.size) k = opts.size / Math.max(s.x, s.z)
  if (opts.height) k = opts.height / s.y
  g.scale.setScalar(k)
  // rest on y=0, centred
  const c = box.getCenter(new THREE.Vector3())
  g.position.set(-c.x * k, -box.min.y * k, -c.z * k)
  const wrap = new THREE.Group()
  wrap.add(g)
  wrap.name = id
  return wrap
}
