import * as THREE from 'three'
import { framePoint, inRect } from './levels'
import type { Block, Rect, Roof, Side } from './types'

export const WALL_T = 0.2
export const INT_WALL_T = 0.12

export const SIDES: Side[] = ['n', 'e', 's', 'w']

export interface SideFrame {
  side: Side
  /** start corner on the exterior face (plan x, z) */
  sx: number
  sz: number
  /** unit direction along the side */
  dx: number
  dz: number
  /** outward normal */
  ox: number
  oz: number
  length: number
}

/** n/s sides run west -> east; e/w sides run north -> south. */
export function sideFrame(r: Rect, s: Side): SideFrame {
  const [x0, z0, x1, z1] = r
  switch (s) {
    case 's':
      return { side: s, sx: x0, sz: z1, dx: 1, dz: 0, ox: 0, oz: 1, length: x1 - x0 }
    case 'n':
      return { side: s, sx: x0, sz: z0, dx: 1, dz: 0, ox: 0, oz: -1, length: x1 - x0 }
    case 'e':
      return { side: s, sx: x1, sz: z0, dx: 0, dz: 1, ox: 1, oz: 0, length: z1 - z0 }
    case 'w':
      return { side: s, sx: x0, sz: z0, dx: 0, dz: 1, ox: -1, oz: 0, length: z1 - z0 }
  }
}

/** Local side space (u along the side, y up world, w inward from the exterior face) -> world. */
export function sideMatrix(f: SideFrame): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    f.dx, 0, -f.ox, f.sx,
    0, 1, 0, 0,
    f.dz, 0, -f.oz, f.sz,
    0, 0, 0, 1,
  )
}

export function sidePoint(f: SideFrame, u: number, w = 0): [number, number] {
  return [f.sx + f.dx * u - f.ox * w, f.sz + f.dz * u - f.oz * w]
}

export function roofThickness(roof: Roof) {
  return roof.thickness ?? (roof.type === 'flat' ? 0.4 : 0.32)
}

/** Height of the roof underside (= vaulted ceiling) above the finished floor at plan point x, z (extrapolates). */
export function roofHeightAt(b: Block, x: number, z: number): number {
  const [x0, z0, x1, z1] = b.rect
  const r = b.roof
  if (r.type === 'flat') return r.height
  if (r.type === 'shed') {
    let t: number
    switch (r.rises) {
      case 'e': t = (x - x0) / (x1 - x0); break
      case 'w': t = (x1 - x) / (x1 - x0); break
      case 'n': t = (z1 - z) / (z1 - z0); break
      case 's': t = (z - z0) / (z1 - z0); break
    }
    return r.low + (r.high - r.low) * t
  }
  // gable
  if (r.ridgeAxis === 'x') {
    const zc = (z0 + z1) / 2
    const d = Math.abs(z - zc) / ((z1 - z0) / 2)
    return r.ridge - (r.ridge - r.eave) * d
  }
  const xc = (x0 + x1) / 2
  const d = Math.abs(x - xc) / ((x1 - x0) / 2)
  return r.ridge - (r.ridge - r.eave) * d
}

/** Interior ceiling height (flat ceilings cap the vault). */
export function ceilingAt(b: Block, x: number, z: number): number {
  const roof = roofHeightAt(b, x, z)
  if (typeof b.ceiling === 'number') return Math.min(b.ceiling, roof)
  return roof
}

/** u positions along a side where the roof height function bends (gable ridge). */
export function roofBreaks(b: Block, f: SideFrame): number[] {
  const r = b.roof
  if (r.type !== 'gable') return []
  const [x0, z0, x1, z1] = b.rect
  if (r.ridgeAxis === 'x' && (f.side === 'e' || f.side === 'w')) return [(z1 - z0) / 2]
  if (r.ridgeAxis === 'z' && (f.side === 'n' || f.side === 's')) return [(x1 - x0) / 2]
  return []
}

export function overlap1(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return hi - lo > 1e-4 ? [lo, hi] : null
}

const EPS = 1e-3

/** Blocks touching side `s` of block `b`, with the shared u-interval. */
export function neighbours(b: Block, s: Side, all: Block[]): { block: Block; u0: number; u1: number }[] {
  const [x0, z0, x1, z1] = b.rect
  const out: { block: Block; u0: number; u1: number }[] = []
  for (const o of all) {
    if (o === b || b.yaw || o.yaw || (b.level ?? 'main') !== (o.level ?? 'main')) continue
    const [ox0, oz0, ox1, oz1] = o.rect
    let iv: [number, number] | null = null
    if (s === 's' && Math.abs(oz0 - z1) < EPS) iv = overlap1(x0, x1, ox0, ox1)
    if (s === 'n' && Math.abs(oz1 - z0) < EPS) iv = overlap1(x0, x1, ox0, ox1)
    if (s === 'e' && Math.abs(ox0 - x1) < EPS) iv = overlap1(z0, z1, oz0, oz1)
    if (s === 'w' && Math.abs(ox1 - x0) < EPS) iv = overlap1(z0, z1, oz0, oz1)
    if (!iv) continue
    const base = s === 'n' || s === 's' ? x0 : z0
    out.push({ block: o, u0: iv[0] - base, u1: iv[1] - base })
  }
  return out.sort((a, b2) => a.u0 - b2.u0)
}

/** Split [0, len] into exterior intervals and intervals shared with neighbours. */
export function sideIntervals(b: Block, s: Side, all: Block[]) {
  const f = sideFrame(b.rect, s)
  const ns = neighbours(b, s, all)
  const out: { u0: number; u1: number; neighbour: Block | null }[] = []
  let u = 0
  for (const n of ns) {
    if (n.u0 > u + 1e-4) out.push({ u0: u, u1: n.u0, neighbour: null })
    out.push({ u0: Math.max(u, n.u0), u1: n.u1, neighbour: n.block })
    u = Math.max(u, n.u1)
  }
  if (u < f.length - 1e-4) out.push({ u0: u, u1: f.length, neighbour: null })
  return { frame: f, intervals: out }
}

export function blockAt(blocks: Block[], x: number, z: number): Block | undefined {
  return blocks.find(b => {
    if (!b.yaw) return inRect(b.rect, x, z, -1e-6)
    const [px, pz] = framePoint(b, x, z, true)
    return inRect(b.rect, px, pz, -1e-6)
  })
}

/** Overhang per side; zero where the side touches a block whose roof is above this one. */
export function overhangs(b: Block, all: Block[]): Record<Side, number> {
  const r = b.roof
  const base: Record<Side, number> = { n: 0.45, s: 0.45, e: 0.45, w: 0.45 }
  const o = r.overhang
  if (typeof o === 'number') for (const s of SIDES) base[s] = o
  else if (o) for (const s of SIDES) if (o[s] !== undefined) base[s] = o[s]!
  for (const s of SIDES) {
    for (const n of neighbours(b, s, all)) {
      // neighbour taller anywhere along the shared edge -> no overhang into its wall
      const f = sideFrame(b.rect, s)
      const [px, pz] = sidePoint(f, (n.u0 + n.u1) / 2)
      if (roofHeightAt(n.block, px, pz) >= roofHeightAt(b, px, pz) - 0.05) base[s] = 0
    }
  }
  return base
}
