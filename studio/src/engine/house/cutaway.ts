import * as THREE from 'three'
import { GeoBuilder, MeshBatch, V3 } from '../geo'
import { framePoint } from './levels'
import type { Block } from './types'

const CUT_HEIGHT = 0.96
const HIDDEN_LAYER = 31
const PIECE_ATTRIBUTE = 'cutawayPiece'
const isAltered = (piece: Piece) => piece.state !== 1

interface WallFace {
  x: number
  z: number
  nx: number
  nz: number
  interior: boolean
  length?: number
}

interface Piece {
  floor: number
  face?: WallFace
  cap?: boolean
  state: number // 0 = hidden, 1 = full, 2 = cut
}

/** The full geometry keeps its batch order, positions and attributes for the lightmap baker. */
export class CutawayBatch extends MeshBatch {
  section?: Piece
  wall?: Piece
  private readonly idsByMaterial = new Map<THREE.Material, { id: number; count: number }[]>()

  constructor(private readonly pieces: Piece[]) { super() }

  override add(material: THREE.Material, geometry: THREE.BufferGeometry) {
    const count = geometry.getAttribute('position')?.count
    if (!count) return
    const piece = this.wall ?? this.section
    let id = piece ? this.pieces.indexOf(piece) : 0
    if (id === -1) id = this.pieces.push(piece!) - 1
    let parts = this.idsByMaterial.get(material)
    if (!parts) this.idsByMaterial.set(material, parts = [])
    parts.push({ id, count })
    super.add(material, geometry)
  }

  tag(group: THREE.Group) {
    for (const mesh of group.children as THREE.Mesh[]) {
      const pos = mesh.geometry.getAttribute('position')
      const ids = new Float32Array(pos.count)
      let start = 0
      for (const { id, count } of this.idsByMaterial.get(mesh.material as THREE.Material) ?? []) {
        ids.fill(id, start, start + count)
        start += count
      }
      mesh.geometry.setAttribute(PIECE_ATTRIBUTE, new THREE.BufferAttribute(ids, 1))
    }
  }
}

export interface WallCutaway {
  /** Tag geometry emitted by build. Interior faces have an opening-facing side chosen at view time. */
  wall(x: number, z: number, nx: number, nz: number, interior: boolean, build: () => void, length?: number): void
  /** A top face in wall-local coordinates, broken where an opening crosses the cut. */
  cap(matrix: THREE.Matrix4, u0: number, u1: number, w0: number, w1: number,
    openings: readonly { u0: number; u1: number; y0: number; y1: number }[]): void
}

const CAP = new THREE.MeshStandardMaterial({ name: 'cutaway-cap', color: '#beb7ac', roughness: 0.88 })

export class Cutaway {
  private readonly pieces: Piece[] = [{ floor: -Infinity, state: 1 }]
  private readonly caps = new CutawayBatch(this.pieces)
  private readonly entries: { full: THREE.Mesh; mesh: THREE.Mesh; pieces: Piece[]; variant?: Variant }[] = []
  readonly group = new THREE.Group()
  private furniture?: THREE.Group
  private furnitureCount = 0
  private furnitureFloor?: number
  private curtains: { wall: Piece; objects: THREE.Object3D[] }[] = []

  batch() { return new CutawayBatch(this.pieces) }

  floor(floor: number): Piece { return { floor, state: 1 } }

  section(batch: CutawayBatch, floor: number, frame?: Block): WallCutaway {
    batch.section = this.floor(floor)
    return {
      wall: (x, z, nx, nz, interior, build, length) => {
        const [wx, wz] = framePoint(frame, x, z)
        const [tx, tz] = framePoint(frame, x + nx, z + nz)
        const face = { x: wx, z: wz, nx: tx - wx, nz: tz - wz, interior, length }
        batch.wall = { floor, face, state: 1 }
        build()
        batch.wall = undefined
      },
      cap: (matrix, u0, u1, w0, w1, openings) => {
        const wall = batch.wall
        if (!wall) return
        this.caps.wall = { ...wall, cap: true, state: 0 }
        const builder = new GeoBuilder()
        const y = floor + CUT_HEIGHT
        const span = (a: number, b: number) => {
          if (a >= b) return
          const point = (u: number, w: number) => {
            const p = V3(u, y, w).applyMatrix4(matrix)
            const [x, z] = framePoint(frame, p.x, p.z)
            return p.set(x, y, z)
          }
          const points = [point(a, w1), point(b, w1), point(b, w0), point(a, w0)] as const
          if (matrix.determinant() < 0) builder.quad(points[3], points[2], points[1], points[0])
          else builder.quad(...points)
        }
        let start = u0
        for (const opening of [...openings].sort((a, b) => a.u0 - b.u0)) {
          if (opening.y0 > y || opening.y1 < y) continue
          span(start, opening.u0)
          start = Math.max(start, opening.u1)
        }
        span(start, u1)
        this.caps.addBuilder(CAP, builder)
        this.caps.wall = undefined
      },
    }
  }

  attach(...groups: THREE.Group[]) {
    const caps = this.caps.toGroup('cutaway-caps')
    this.caps.tag(caps)
    const cap = caps.children[0] as THREE.Mesh | undefined
    if (cap) this.add(cap, true)
    for (const group of groups) for (const mesh of group.children as THREE.Mesh[]) {
      if (mesh.geometry.hasAttribute(PIECE_ATTRIBUTE)) this.add(mesh)
    }
    this.group.visible = false
  }

  private add(full: THREE.Mesh, cap = false) {
    const mesh = new THREE.Mesh(undefined, full.material)
    mesh.name = full.name
    mesh.userData = full.userData
    mesh.castShadow = full.castShadow
    mesh.receiveShadow = full.receiveShadow
    mesh.renderOrder = full.renderOrder
    this.group.add(mesh)
    if (cap) full.visible = false
    const ids = new Set(full.geometry.getAttribute(PIECE_ATTRIBUTE).array)
    this.entries.push({ full, mesh, pieces: [...ids].map(id => this.pieces[id]) })
  }

  update(floor: number | undefined, cut: boolean, camera: THREE.Vector3, target: THREE.Vector3) {
    const active = floor !== undefined
    let changed = this.group.visible !== active
    this.group.visible = active
    for (const piece of this.pieces) {
      const face = piece.face
      let state = active && piece.floor > floor + 0.01 ? 0 : 1
      if (state && cut && face && piece.floor === floor) {
        // Both sides of a partition are usable. Keep the side beyond the focus
        // full height, and lower partitions between the camera and that focus.
        const focusSide = (face.x - target.x) * face.nx + (face.z - target.z) * face.nz
        const side = face.interior && focusSide < -0.05 ? -1 : 1
        const facing = ((camera.x - face.x) * face.nx + (camera.z - face.z) * face.nz) * side
        const wasCut = piece.cap ? piece.state === 1 : piece.state === 2
        if (facing > (wasCut ? -0.24 : 0.24)) state = 2
      }
      if (piece.cap) state = state === 2 ? 1 : 0
      if (piece.state !== state) changed = true
      piece.state = state
    }
    for (const entry of this.entries) {
      const { full, mesh } = entry
      const useVariant = active && (!full.visible || entry.pieces.some(isAltered))
      const switched = mesh.visible !== useVariant
      mesh.visible = useVariant
      full.layers.set(useVariant ? HIDDEN_LAYER : 0)
      if (!useVariant) continue
      this.syncEntry(entry, changed || switched)
    }
    return changed
  }

  /** Lightmap refresh can replace the source buffers and material while the camera is at rest. */
  syncBindings() {
    if (!this.group.visible) return
    for (const entry of this.entries) if (entry.mesh.visible) this.syncEntry(entry, false)
  }

  private syncEntry(entry: (typeof this.entries)[number], changed: boolean) {
    const { full, mesh } = entry
    const refresh = entry.variant?.source !== full.geometry
    if (refresh) {
      mesh.geometry.dispose()
      entry.variant = new Variant(full.geometry, this.pieces)
      mesh.geometry = entry.variant.geometry
    }
    mesh.material = full.material
    if (refresh || changed) entry.variant!.update()
  }

  /** Keep furnishings in the bake graph and hide curtains attached to lowered walls. */
  syncFurniture(group: THREE.Group, floor: number | undefined) {
    const newFurniture = this.furniture !== group || this.furnitureCount !== group.children.length
    if (newFurniture) {
      this.furniture = group
      this.furnitureCount = group.children.length
      this.bindCurtains(group)
    }
    if (newFurniture || this.furnitureFloor !== floor) {
      this.furnitureFloor = floor
      for (const child of group.children) {
        if (child.userData.cutawayFloor === undefined) continue
        const layer = floor !== undefined && child.userData.cutawayFloor > floor + 0.01 ? HIDDEN_LAYER : 0
        child.traverse(object => { object.layers.set(layer) })
      }
    }
    for (const { wall, objects } of this.curtains) {
      const layer = wall.state === 1 ? 0 : HIDDEN_LAYER
      for (const object of objects) object.layers.set(layer)
    }
  }

  private bindCurtains(group: THREE.Group) {
    this.curtains = []
    const position = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    group.traverse(object => {
      if (object.name !== 'linen-curtain') return
      object.getWorldPosition(position)
      normal.set(0, 0, -1).applyQuaternion(object.getWorldQuaternion(rotation))
      let closest = 0.55
      let wall: Piece | undefined
      for (const piece of this.pieces) {
        const face = piece.face
        if (!face?.length || face.interior || piece.cap || Math.abs(position.y - piece.floor) > 0.1 ||
            normal.x * face.nx + normal.z * face.nz < 0.95) continue
        const x = position.x - face.x, z = position.z - face.z
        const depth = Math.abs(x * face.nx + z * face.nz)
        const along = Math.abs(x * face.nz - z * face.nx)
        if (depth >= closest || along > face.length / 2 + 0.12) continue
        wall = piece
        closest = depth
      }
      if (!wall) return
      const objects: THREE.Object3D[] = []
      object.traverse(child => { objects.push(child) })
      this.curtains.push({ wall, objects })
    })
  }

  dispose() {
    for (const { full } of this.entries) if (!full.visible) full.geometry.dispose()
    for (const { mesh } of this.entries) mesh.geometry.dispose()
  }
}

/** One draw per material. Angle changes only rewrite the preallocated index buffer. */
class Variant {
  readonly geometry = new THREE.BufferGeometry()
  private readonly groups: { piece: Piece; full: number[]; low: number[] }[]
  private readonly index: THREE.BufferAttribute

  constructor(readonly source: THREE.BufferGeometry, pieces: Piece[]) {
    const position = source.getAttribute('position')
    const tags = source.getAttribute(PIECE_ATTRIBUTE)
    const attributes = Object.entries(source.attributes)
    const crossings: { a: number; b: number; t: number }[] = []
    const edge = (a: number, b: number, t: number) => {
      crossings.push({ a, b, t })
      return position.count + crossings.length - 1
    }
    const groups = new Map<number, (typeof this.groups)[number]>()
    const src = source.index!
    for (let i = 0; i < src.count; i += 3) {
      const ids = [src.getX(i), src.getX(i + 1), src.getX(i + 2)]
      const tag = Math.round(tags.getX(ids[0]))
      let group = groups.get(tag)
      if (!group) {
        group = { piece: pieces[tag], full: [], low: [] }
        groups.set(tag, group)
      }
      group.full.push(...ids)
      if (group.piece.face && !group.piece.cap)
        clipTriangle(ids, position, group.piece.floor + CUT_HEIGHT, edge, group.low)
    }
    this.groups = [...groups.values()]
    for (const [name, attr] of attributes) {
      if (name === PIECE_ATTRIBUTE) continue
      const data = new Float32Array((attr.count + crossings.length) * attr.itemSize)
      data.set(attr.array)
      for (const [i, { a, b, t }] of crossings.entries()) {
        for (let j = 0; j < attr.itemSize; j++) {
          data[(attr.count + i) * attr.itemSize + j] =
            THREE.MathUtils.lerp(attr.getComponent(a, j), attr.getComponent(b, j), t)
        }
      }
      this.geometry.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize))
    }
    const count = this.groups.reduce((total, group) => total + Math.max(group.full.length, group.low.length), 0)
    const Index = position.count + crossings.length > 65535 ? Uint32Array : Uint16Array
    this.index = new THREE.BufferAttribute(new Index(count), 1).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setIndex(this.index)
    this.geometry.boundingBox = source.boundingBox
    this.geometry.boundingSphere = source.boundingSphere
  }

  update() {
    let offset = 0
    for (const { piece, full, low } of this.groups) {
      if (!piece.state) continue
      const indices = piece.state === 2 ? low : full
      this.index.array.set(indices, offset)
      offset += indices.length
    }
    this.index.needsUpdate = true
    this.geometry.setDrawRange(0, offset)
  }
}

/** Keep the part of a triangle at or below the cut plane, retaining its winding. */
export function clipTriangle(ids: number[], position: Pick<THREE.BufferAttribute, 'getY'>, y: number,
  edge: (a: number, b: number, t: number) => number, out: number[]) {
  const polygon: number[] = []
  for (let i = 0; i < 3; i++) {
    const a = ids[i], b = ids[(i + 1) % 3]
    const da = position.getY(a) - y, db = position.getY(b) - y
    if (da <= 0) polygon.push(a)
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) polygon.push(edge(a, b, da / (da - db)))
  }
  for (let i = 1; i + 1 < polygon.length; i++) out.push(polygon[0], polygon[i], polygon[i + 1])
}
