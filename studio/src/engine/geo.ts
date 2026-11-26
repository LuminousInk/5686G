import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Accumulates triangles with positions, normals, UVs (in meters, box-projected) and colours, then emits one
 * BufferGeometry. Used for everything procedural: boards, ribs, roofs, decks, frames.
 */
export class GeoBuilder {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []
  col: number[] = []
  idx: number[] = []
  color: [number, number, number] = [1, 1, 1]
  /** UV offset applied to new faces (randomises texture per board) */
  uvOffset: [number, number] = [0, 0]
  /** rotate texture 90 degrees on new faces (grain direction) */
  uvRotate = false

  get vertexCount() {
    return this.pos.length / 3
  }

  /** Quad from 4 corners (counter-clockwise seen from the front). UVs are projected on the quad plane. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uAxis?: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize()
    if (n.lengthSq() < 0.5) {
      // degenerate (zero-width side) - try the other diagonal
      n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize()
      if (n.lengthSq() < 0.5) return
    }
    // projection axes: u horizontal along the face (or given), v up the face
    let u: THREE.Vector3
    if (uAxis) u = uAxis.clone()
    else if (Math.abs(n.y) > 0.9) u = new THREE.Vector3(1, 0, 0)
    else u = new THREE.Vector3(0, 1, 0).cross(n).normalize()
    let v = new THREE.Vector3().crossVectors(n, u).normalize()
    if (this.uvRotate) [u, v] = [v, u.negate()]
    const base = this.vertexCount
    for (const p of [a, b, c, d]) {
      this.pos.push(p.x, p.y, p.z)
      this.nor.push(n.x, n.y, n.z)
      this.uv.push(p.dot(u) + this.uvOffset[0], p.dot(v) + this.uvOffset[1])
      this.col.push(...this.color)
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
    if (n.lengthSq() < 0.5) return
    const u = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(n).normalize()
    const v = new THREE.Vector3().crossVectors(n, u).normalize()
    const base = this.vertexCount
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z)
      this.nor.push(n.x, n.y, n.z)
      this.uv.push(p.dot(u) + this.uvOffset[0], p.dot(v) + this.uvOffset[1])
      this.col.push(...this.color)
    }
    this.idx.push(base, base + 1, base + 2)
  }

  /**
   * General hexahedron from 8 corners: bottom face b0..b3 and top face t0..t3, both counter-clockwise seen from
   * above. Skips faces listed in `skip` ('top','bottom','s0'..'s3', side i connects corner i to i+1).
   */
  hexa(b: THREE.Vector3[], t: THREE.Vector3[], skip: string[] = []) {
    if (!skip.includes('top')) this.quad(t[0], t[1], t[2], t[3])
    if (!skip.includes('bottom')) this.quad(b[3], b[2], b[1], b[0])
    for (let i = 0; i < 4; i++) {
      if (skip.includes(`s${i}`)) continue
      const j = (i + 1) % 4
      this.quad(b[i], b[j], t[j], t[i])
    }
  }

  /** Axis aligned box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip: string[] = []) {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    // counter-clockwise from above: (x0,z1) -> (x1,z1) -> (x1,z0) -> (x0,z0)
    const b = [V(x0, y0, z1), V(x1, y0, z1), V(x1, y0, z0), V(x0, y0, z0)]
    const t = [V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0)]
    this.hexa(b, t, skip)
  }

  /** Box centered at `c` with half sizes, rotated by yaw around y. */
  orientedBox(c: THREE.Vector3, hx: number, hy: number, hz: number, yaw = 0, pitch = 0) {
    const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(pitch))
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m).add(c)
    const b = [P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, -hy, -hz), P(-hx, -hy, -hz)]
    const t = [P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz)]
    this.hexa(b, t)
  }

  /** Box between two points with a square-ish cross section (posts, rails, slats). */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, up = new THREE.Vector3(0, 1, 0)) {
    const dir = new THREE.Vector3().subVectors(b, a)
    const len = dir.length()
    if (len < 1e-5) return
    dir.normalize()
    let side = new THREE.Vector3().crossVectors(dir, up)
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0)
    side.normalize()
    const nup = new THREE.Vector3().crossVectors(side, dir).normalize()
    const s = side.multiplyScalar(w / 2)
    const u = nup.multiplyScalar(h / 2)
    const corner = (p: THREE.Vector3, sx: number, sy: number) => p.clone().addScaledVector(s, sx).addScaledVector(u, sy)
    // treat `a` end as bottom face, `b` end as top face
    const bot = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)]
    const top = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)]
    // orientation check: make sure bottom ring is counter-clockwise looking from b toward a
    const n = new THREE.Vector3().subVectors(bot[1], bot[0]).cross(new THREE.Vector3().subVectors(bot[3], bot[0]))
    if (n.dot(dir) < 0) {
      bot.reverse()
      top.reverse()
    }
    this.hexa(bot, top)
  }

  build(withColor = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

/** Apply a matrix and keep triangles front-facing even when the matrix mirrors. */
export function applyMatrixKeepWinding(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  g.applyMatrix4(m)
  if (m.determinant() < 0) {
    const idx = g.getIndex()
    if (idx) {
      const a = idx.array as Uint16Array | Uint32Array
      for (let i = 0; i < a.length; i += 3) {
        const t = a[i + 1]
        a[i + 1] = a[i + 2]
        a[i + 2] = t
      }
      idx.needsUpdate = true
    } else {
      const p = g.getAttribute('position') as THREE.BufferAttribute
      const swap = (attr: THREE.BufferAttribute) => {
        const s = attr.itemSize
        const arr = attr.array as Float32Array
        for (let i = 0; i < attr.count; i += 3) {
          for (let k = 0; k < s; k++) {
            const t = arr[(i + 1) * s + k]
            arr[(i + 1) * s + k] = arr[(i + 2) * s + k]
            arr[(i + 2) * s + k] = t
          }
        }
        attr.needsUpdate = true
      }
      for (const name of Object.keys(g.attributes)) swap(g.getAttribute(name) as THREE.BufferAttribute)
      void p
    }
  }
  return g
}

/** Normalise attribute sets so geometries can be merged (adds missing uv/color, drops extras). */
export function harmonise(geos: THREE.BufferGeometry[], withColor: boolean): THREE.BufferGeometry[] {
  return geos.map(g0 => {
    let g = g0.index ? g0 : g0
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
    }
    if (withColor && !g.getAttribute('color')) {
      const n = g.getAttribute('position').count
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3))
    }
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name) || (name === 'color' && !withColor)) g.deleteAttribute(name)
    }
    if (!g.index) {
      const n = g.getAttribute('position').count
      const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n)
      for (let i = 0; i < n; i++) idx[i] = i
      g = g.clone()
      g.setIndex(new THREE.BufferAttribute(idx, 1))
    }
    return g
  })
}

/** Groups geometries by material and merges each group into one mesh. */
export class MeshBatch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>()

  add(mat: THREE.Material, geo: THREE.BufferGeometry) {
    if (!geo.getAttribute('position') || geo.getAttribute('position').count === 0) return
    let list = this.parts.get(mat)
    if (!list) this.parts.set(mat, (list = []))
    list.push(geo)
  }

  addBuilder(mat: THREE.Material, b: GeoBuilder) {
    if (b.vertexCount) this.add(mat, b.build(true))
  }

  toGroup(name: string, opts: { cast?: boolean; receive?: boolean; tag?: Record<string, unknown> } = {}): THREE.Group {
    const group = new THREE.Group()
    group.name = name
    for (const [mat, geos] of this.parts) {
      const withColor = !!(mat as THREE.MeshStandardMaterial).vertexColors
      const merged = mergeGeometries(harmonise(geos, withColor), false)
      if (!merged) continue
      merged.computeBoundingBox()
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, mat)
      mesh.name = `${name}:${mat.name}`
      mesh.castShadow = opts.cast ?? true
      mesh.receiveShadow = opts.receive ?? true
      mesh.userData = { ...opts.tag, material: mat.name }
      group.add(mesh)
    }
    return group
  }
}

export const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
