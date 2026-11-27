import * as THREE from 'three'

/**
 * Deterministic lightmap UVs (attribute `uv1`) for the generated house shell.
 *
 * Triangles are grouped into flat charts (edge-connected and coplanar), each chart is projected onto its own plane at a
 * chosen texel density, and all charts of all meshes are shelf-packed into one square atlas. The same plan always gives
 * the same layout, so a lightmap baked offline from exported geometry (tools/bake) lines up with the runtime geometry.
 * The returned signature fingerprints the input geometry; a baked lightmap stores it and is only applied on a match.
 */

export interface LightmapLayout {
  /** atlas width = height, in texels */
  size: number
  /** Peak texels per metre (lowered automatically until everything fits). */
  density: number
  charts: number
  /** fingerprint of the input geometry (names, counts, positions) */
  signature: string
}

export interface LayoutOptions {
  size?: number
  density?: number
  /** empty texels around every chart, so bilinear filtering and bake dilation never bleed between charts */
  pad?: number
  budget?: (mesh: THREE.Mesh) => SurfaceBudget
}

export const LIGHTMAP_SIZE = 2048

export interface SurfaceBudget {
  cuts?: (point: THREE.Vector3) => readonly THREE.Plane[]
  weight?: (point: THREE.Vector3, normal: THREE.Vector3) => number
}

const sources = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()
export function lightmapSource(geometry: THREE.BufferGeometry) {
  return sources.get(geometry) ?? geometry
}

interface Chart {
  tris: number[]
  u: THREE.Vector3
  v: THREE.Vector3
  min: [number, number]
  max: [number, number]
  weight: number
  w: number
  h: number
  x: number
  y: number
}

const Q = 1000 // positions quantised to 1 mm when matching shared edges

function fnv(h: number, n: number) {
  h ^= n & 0xffff
  h = Math.imul(h, 16777619)
  h ^= n >>> 16
  return Math.imul(h, 16777619) >>> 0
}

/** Fingerprint of a set of meshes: names, vertex and index counts and quantised positions. */
export function geometrySignature(meshes: THREE.Mesh[]): string {
  let h = 2166136261
  for (const m of meshes) {
    for (let i = 0; i < m.name.length; i++) h = fnv(h, m.name.charCodeAt(i))
    const g = lightmapSource(m.geometry)
    const p = g.getAttribute('position')
    h = fnv(h, p.count)
    h = fnv(h, g.index ? g.index.count : 0)
    for (let i = 0; i < p.count; i++) {
      h = fnv(h, Math.round(p.getX(i) * 1e4))
      h = fnv(h, Math.round(p.getY(i) * 1e4))
      h = fnv(h, Math.round(p.getZ(i) * 1e4))
    }
  }
  return h.toString(16).padStart(8, '0')
}

class UnionFind {
  p: Int32Array
  constructor(n: number) {
    this.p = new Int32Array(n)
    for (let i = 0; i < n; i++) this.p[i] = i
  }
  find(a: number): number {
    while (this.p[a] !== a) {
      this.p[a] = this.p[this.p[a]]
      a = this.p[a]
    }
    return a
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    // smaller root wins: keeps the result independent of edge visiting order
    if (ra < rb) this.p[rb] = ra
    else this.p[ra] = rb
  }
}

/** Planar charts of one indexed geometry. */
function chartsOf(mesh: THREE.Mesh, budget: SurfaceBudget): Chart[] {
  const g = mesh.geometry
  const pos = g.getAttribute('position')
  const idx = g.index!.array
  const nt = idx.length / 3
  const nrm = new Float32Array(nt * 3)
  const off = new Float32Array(nt)
  const area = new Float32Array(nt)
  const weights = new Float32Array(nt).fill(1)
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
  const center = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < nt; t++) {
    a.fromBufferAttribute(pos, idx[t * 3])
    b.fromBufferAttribute(pos, idx[t * 3 + 1])
    c.fromBufferAttribute(pos, idx[t * 3 + 2])
    const n = b.clone().sub(a).cross(c.clone().sub(a))
    const len = n.length()
    area[t] = len / 2
    if (len > 1e-12) n.divideScalar(len)
    else n.set(0, 1, 0)
    nrm[t * 3] = n.x
    nrm[t * 3 + 1] = n.y
    nrm[t * 3 + 2] = n.z
    off[t] = n.dot(a)
    if (budget.weight) {
      center.copy(a).add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld)
      normal.copy(n).applyNormalMatrix(normalMatrix)
      weights[t] = budget.weight(center, normal)
    }
  }
  const key = (i: number) => `${Math.round(pos.getX(i) * Q)},${Math.round(pos.getY(i) * Q)},${Math.round(pos.getZ(i) * Q)}`
  const vkey: string[] = Array.from({ length: pos.count }, (_, i) => key(i))
  const edges = new Map<string, number[]>()
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const k0 = vkey[idx[t * 3 + e]]
      const k1 = vkey[idx[t * 3 + ((e + 1) % 3)]]
      const k = k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`
      let list = edges.get(k)
      if (!list) edges.set(k, (list = []))
      list.push(t)
    }
  }
  const uf = new UnionFind(nt)
  const coplanar = (s: number, t: number) =>
    weights[s] === weights[t] && nrm[s * 3] * nrm[t * 3] + nrm[s * 3 + 1] * nrm[t * 3 + 1] + nrm[s * 3 + 2] * nrm[t * 3 + 2] > 0.9995 && Math.abs(off[s] - off[t]) < 0.002
  for (const list of edges.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) if (area[list[i]] > 0 && area[list[j]] > 0 && coplanar(list[i], list[j])) uf.union(list[i], list[j])
  }
  const groups = new Map<number, number[]>()
  for (let t = 0; t < nt; t++) {
    const r = uf.find(t)
    let list = groups.get(r)
    if (!list) groups.set(r, (list = []))
    list.push(t)
  }
  const out: Chart[] = []
  // Map iteration follows insertion order = smallest triangle first: deterministic
  for (const tris of groups.values()) {
    const n = new THREE.Vector3()
    for (const t of tris) n.add(new THREE.Vector3(nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2]).multiplyScalar(Math.max(area[t], 1e-9)))
    if (n.lengthSq() < 1e-18) n.set(0, 1, 0)
    n.normalize()
    const u = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(n).normalize()
    const v = new THREE.Vector3().crossVectors(n, u).normalize()
    const min: [number, number] = [Infinity, Infinity]
    const max: [number, number] = [-Infinity, -Infinity]
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        a.fromBufferAttribute(pos, idx[t * 3 + k])
        const pu = a.dot(u)
        const pv = a.dot(v)
        min[0] = Math.min(min[0], pu)
        min[1] = Math.min(min[1], pv)
        max[0] = Math.max(max[0], pu)
        max[1] = Math.max(max[1], pv)
      }
    out.push({ tris, u, v, min, max, weight: weights[tris[0]], w: 0, h: 0, x: 0, y: 0 })
  }
  return out
}

/** Shelf packing; returns false when the charts do not fit at this density. */
function pack(charts: Chart[], size: number, density: number, pad: number): boolean {
  for (const c of charts) {
    const rate = density * c.weight
    c.w = Math.max(1, Math.ceil((c.max[0] - c.min[0]) * rate)) + pad * 2
    c.h = Math.max(1, Math.ceil((c.max[1] - c.min[1]) * rate)) + pad * 2
  }
  const order = charts.map((_, i) => i).sort((i, j) => charts[j].h - charts[i].h || charts[j].w - charts[i].w || i - j)
  const shelves: { x: number; y: number }[] = []
  let y = 0
  for (const i of order) {
    const c = charts[i]
    if (c.w > size) return false
    let shelf = shelves.find(s => s.x + c.w <= size)
    if (!shelf) {
      if (y + c.h > size) return false
      shelf = { x: 0, y }
      shelves.push(shelf)
      y += c.h
    }
    c.x = shelf.x
    c.y = shelf.y
    shelf.x += c.w
  }
  return true
}

/**
 * Adds `uv1` to every mesh (splitting vertices shared between charts) and returns the atlas layout. Meshes must be
 * static with baked dimensions and may be placed with rigid transforms.
 */
export function layoutLightmap(meshes: THREE.Mesh[], opts: LayoutOptions = {}): LightmapLayout {
  const size = opts.size ?? LIGHTMAP_SIZE
  const pad = opts.pad ?? 2
  let density = opts.density ?? 40
  const signature = geometrySignature(meshes)
  const original = meshes.map(m => m.geometry)
  const chartsByMesh: Chart[][] = []
  try {
    for (const [i, mesh] of meshes.entries()) {
      mesh.updateWorldMatrix(true, false)
      const budget = opts.budget?.(mesh) ?? {}
      const source = lightmapSource(original[i])
      const sliced = budget.cuts ? sliceGeometry(source, mesh.matrixWorld, budget.cuts) : source
      mesh.geometry = sliced.index ? sliced : toIndexed(sliced)
      if (sliced !== source && mesh.geometry !== sliced) sliced.dispose()
      chartsByMesh.push(chartsOf(mesh, budget))
    }
    const charts = chartsByMesh.flat()
    let fits = pack(charts, size, density, pad)
    for (let k = 0; k < 40 && !fits; k++) {
      density *= 0.92
      fits = pack(charts, size, density, pad)
    }
    if (!fits) throw new Error(`lightmap: ${charts.length} charts do not fit a ${size}px atlas`)
    meshes.forEach((mesh, i) => {
      const intermediate = mesh.geometry
      writeUVs(mesh, chartsByMesh[i], size, density, pad)
      const source = lightmapSource(original[i])
      sources.set(mesh.geometry, source)
      if (intermediate !== source) intermediate.dispose()
      original[i].dispose()
    })
    return { size, density, charts: charts.length, signature }
  } catch (err) {
    meshes.forEach((mesh, i) => {
      if (mesh.geometry !== original[i] && mesh.geometry !== lightmapSource(original[i])) mesh.geometry.dispose()
      mesh.geometry = original[i]
    })
    throw err
  }
}

/** Split triangles on budget boundaries. Keep the position and material UVs continuous across each cut. */
function sliceGeometry(g: THREE.BufferGeometry, world: THREE.Matrix4, cuts: NonNullable<SurfaceBudget['cuts']>) {
  const attributes = Object.entries(g.attributes)
  const values = attributes.map((): number[] => [])
  const pos = g.getAttribute('position')
  const count = g.index?.count ?? pos.count
  const inverse = world.clone().invert()
  const localPlanes = new Map<THREE.Plane, THREE.Plane>()
  const center = new THREE.Vector3()
  const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  let changed = false

  for (let t = 0; t < count; t += 3) {
    const ids = points.map((p, k) => {
      const i = g.index?.getX(t + k) ?? t + k
      p.fromBufferAttribute(pos, i)
      return i
    })
    // Store barycentric weights for each polygon vertex so all source attributes interpolate together.
    let polygons = [[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]]
    center.copy(points[0]).add(points[1]).add(points[2]).multiplyScalar(1 / 3).applyMatrix4(world)
    for (const cut of cuts(center)) {
      let plane = localPlanes.get(cut)
      if (!plane) {
        plane = cut.clone().applyMatrix4(inverse)
        localPlanes.set(cut, plane)
      }
      const ds = new THREE.Vector3(plane.distanceToPoint(points[0]), plane.distanceToPoint(points[1]), plane.distanceToPoint(points[2]))
      if (Math.min(ds.x, ds.y, ds.z) >= -1e-5 || Math.max(ds.x, ds.y, ds.z) <= 1e-5) continue
      polygons = polygons.flatMap(poly => {
        const distances = poly.map(p => p.dot(ds))
        if (Math.min(...distances) >= -1e-5 || Math.max(...distances) <= 1e-5) return [poly]
        changed = true
        const low: THREE.Vector3[] = []
        const high: THREE.Vector3[] = []
        for (const [i, a] of poly.entries()) {
          const j = (i + 1) % poly.length
          const da = distances[i]
          const db = distances[j]
          if (da <= 1e-5) low.push(a)
          if (da >= -1e-5) high.push(a)
          if (Math.min(da, db) < -1e-5 && Math.max(da, db) > 1e-5) {
            const split = a.clone().lerp(poly[j], da / (da - db))
            low.push(split)
            high.push(split)
          }
        }
        return [low, high]
      })
    }
    for (const poly of polygons) for (let i = 1; i < poly.length - 1; i++) {
      for (const p of [poly[0], poly[i], poly[i + 1]]) {
        attributes.forEach(([, attr], i) => {
          for (let k = 0; k < attr.itemSize; k++) {
            values[i].push(p.x * attr.getComponent(ids[0], k) + p.y * attr.getComponent(ids[1], k) + p.z * attr.getComponent(ids[2], k))
          }
        })
      }
    }
  }
  if (!changed) return g
  const out = new THREE.BufferGeometry()
  attributes.forEach(([name, attr], i) => out.setAttribute(name, new THREE.Float32BufferAttribute(values[i], attr.itemSize)))
  return out
}

function toIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n)
  for (let i = 0; i < n; i++) idx[i] = i
  const out = g.clone()
  out.setIndex(new THREE.BufferAttribute(idx, 1))
  return out
}

/** Writes uv1 for one mesh; a vertex used by two charts is duplicated so each copy gets its own lightmap UV. */
function writeUVs(mesh: THREE.Mesh, charts: Chart[], size: number, density: number, pad: number) {
  const g = mesh.geometry
  const idx = g.index!.array
  const pos = g.getAttribute('position')
  const chartOfTri = new Int32Array(idx.length / 3)
  charts.forEach((c, ci) => {
    for (const t of c.tris) chartOfTri[t] = ci
  })
  // new vertex per (old vertex, chart)
  const first = new Int32Array(pos.count).fill(-1)
  const firstChart = new Int32Array(pos.count).fill(-1)
  const extra = new Map<string, number>()
  const src: number[] = []
  const srcChart: number[] = []
  const newIdx = new Uint32Array(idx.length)
  for (let k = 0; k < idx.length; k++) {
    const vi = idx[k]
    const ci = chartOfTri[(k / 3) | 0]
    let ni: number
    if (first[vi] < 0) {
      ni = src.length
      first[vi] = ni
      firstChart[vi] = ci
      src.push(vi)
      srcChart.push(ci)
    } else if (firstChart[vi] === ci) ni = first[vi]
    else {
      const key = `${vi}:${ci}`
      const hit = extra.get(key)
      if (hit !== undefined) ni = hit
      else {
        ni = src.length
        extra.set(key, ni)
        src.push(vi)
        srcChart.push(ci)
      }
    }
    newIdx[k] = ni
  }
  const nv = src.length
  const out = new THREE.BufferGeometry()
  for (const name of Object.keys(g.attributes)) {
    const at = g.getAttribute(name) as THREE.BufferAttribute
    const arr = new (at.array.constructor as new (n: number) => THREE.TypedArray)(nv * at.itemSize)
    for (let i = 0; i < nv; i++) for (let k = 0; k < at.itemSize; k++) arr[i * at.itemSize + k] = at.array[src[i] * at.itemSize + k]
    out.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize, at.normalized))
  }
  const uv1 = new Float32Array(nv * 2)
  const p = new THREE.Vector3()
  for (let i = 0; i < nv; i++) {
    const c = charts[srcChart[i]]
    p.fromBufferAttribute(pos, src[i])
    const rate = density * c.weight
    uv1[i * 2] = (c.x + pad + (p.dot(c.u) - c.min[0]) * rate) / size
    uv1[i * 2 + 1] = (c.y + pad + (p.dot(c.v) - c.min[1]) * rate) / size
  }
  out.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
  out.setIndex(new THREE.BufferAttribute(nv > 65535 ? newIdx : Uint16Array.from(newIdx), 1))
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex)
  out.computeBoundingBox()
  out.computeBoundingSphere()
  mesh.geometry = out
}
