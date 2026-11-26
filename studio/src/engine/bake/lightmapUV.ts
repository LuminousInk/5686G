import * as THREE from 'three'

/**
 * Deterministic lightmap UVs (attribute `uv1`) for the generated house shell.
 *
 * Triangles are grouped into flat charts (edge-connected and coplanar), each chart is projected onto its own plane at a
 * fixed texel density, and all charts of all meshes are shelf-packed into one square atlas. The same plan always gives
 * the same layout, so a lightmap baked offline from exported geometry (tools/bake) lines up with the runtime geometry.
 * The returned signature fingerprints the input geometry; a baked lightmap stores it and is only applied on a match.
 */

export interface LightmapLayout {
  /** atlas width = height, in texels */
  size: number
  /** texels per metre actually used (lowered automatically until everything fits) */
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
}

interface Chart {
  mesh: number
  tris: number[]
  u: THREE.Vector3
  v: THREE.Vector3
  min: [number, number]
  max: [number, number]
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
    const g = m.geometry
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
function chartsOf(g: THREE.BufferGeometry, meshIndex: number): Chart[] {
  const pos = g.getAttribute('position')
  const idx = g.index!.array
  const nt = idx.length / 3
  const nrm = new Float32Array(nt * 3)
  const off = new Float32Array(nt)
  const area = new Float32Array(nt)
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
    nrm[s * 3] * nrm[t * 3] + nrm[s * 3 + 1] * nrm[t * 3 + 1] + nrm[s * 3 + 2] * nrm[t * 3 + 2] > 0.9995 && Math.abs(off[s] - off[t]) < 0.002
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
    out.push({ mesh: meshIndex, tris, u, v, min, max, w: 0, h: 0, x: 0, y: 0 })
  }
  return out
}

/** Shelf packing; returns false when the charts do not fit at this density. */
function pack(charts: Chart[], size: number, density: number, pad: number): boolean {
  for (const c of charts) {
    c.w = Math.max(1, Math.ceil((c.max[0] - c.min[0]) * density)) + pad * 2
    c.h = Math.max(1, Math.ceil((c.max[1] - c.min[1]) * density)) + pad * 2
  }
  const order = charts.map((_, i) => i).sort((i, j) => charts[j].h - charts[i].h || charts[j].w - charts[i].w || i - j)
  let x = 0
  let y = 0
  let shelf = 0
  for (const i of order) {
    const c = charts[i]
    if (c.w > size) return false
    if (x + c.w > size) {
      x = 0
      y += shelf
      shelf = 0
    }
    if (y + c.h > size) return false
    c.x = x
    c.y = y
    x += c.w
    shelf = Math.max(shelf, c.h)
  }
  return true
}

/**
 * Adds `uv1` to every mesh (splitting vertices shared between charts) and returns the atlas layout. Meshes must be
 * indexed and in world space (the house meshes are: merged per material, identity transforms).
 */
export function layoutLightmap(meshes: THREE.Mesh[], opts: LayoutOptions = {}): LightmapLayout {
  const size = opts.size ?? 2048
  const pad = opts.pad ?? 2
  let density = opts.density ?? 40
  const signature = geometrySignature(meshes)
  for (const m of meshes) if (!m.geometry.index) m.geometry = toIndexed(m.geometry)
  const charts = meshes.flatMap((m, i) => chartsOf(m.geometry, i))
  let fits = pack(charts, size, density, pad)
  for (let k = 0; k < 40 && !fits; k++) {
    density *= 0.92
    fits = pack(charts, size, density, pad)
  }
  if (!fits) throw new Error(`lightmap: ${charts.length} charts do not fit a ${size}px atlas`)
  meshes.forEach((m, i) => writeUVs(m, charts.filter(c => c.mesh === i), size, density, pad))
  return { size, density, charts: charts.length, signature }
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
    uv1[i * 2] = (c.x + pad + (p.dot(c.u) - c.min[0]) * density) / size
    uv1[i * 2 + 1] = (c.y + pad + (p.dot(c.v) - c.min[1]) * density) / size
  }
  out.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2))
  out.setIndex(new THREE.BufferAttribute(nv > 65535 ? newIdx : Uint16Array.from(newIdx), 1))
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex)
  out.computeBoundingBox()
  out.computeBoundingSphere()
  mesh.geometry = out
  g.dispose()
}
