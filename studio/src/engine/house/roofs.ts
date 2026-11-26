import * as THREE from 'three'
import { GeoBuilder, MeshBatch, V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { overhangs, roofHeightAt, roofThickness, sideIntervals } from './massing'
import type { Block, HomePlan, Side } from './types'

export interface RoofOutput {
  /** light fixtures in soffits (world positions) for night lighting */
  downlights: THREE.Vector3[]
}

const RIB_PITCH = 0.42

/**
 * Roof slabs (top = roof finish with standing seams, edges = fascia in the trim colour, underside = wood soffit
 * outside the walls and the ceiling inside), gutters, downspouts and solar.
 */
export function buildRoofs(plan: HomePlan, lib: MaterialLibrary, roofBatch: MeshBatch, ceilingBatch: MeshBatch): RoofOutput {
  const out: RoofOutput = { downlights: [] }
  for (const b of plan.blocks) buildBlockRoof(plan, b, lib, roofBatch, ceilingBatch, out)
  return out
}

function buildBlockRoof(plan: HomePlan, b: Block, lib: MaterialLibrary, roofBatch: MeshBatch, ceilingBatch: MeshBatch, out: RoofOutput) {
  const fy = plan.floorY
  const r = b.roof
  const T = roofThickness(r)
  const oh = overhangs(b, plan.blocks)
  const [x0, z0, x1, z1] = b.rect
  const ex0 = x0 - oh.w
  const ex1 = x1 + oh.e
  const ez0 = z0 - oh.n
  const ez1 = z1 + oh.s
  const U = (x: number, z: number) => fy + roofHeightAt(b, x, z)
  const top = new GeoBuilder()
  const fascia = new GeoBuilder()
  const soffit = new GeoBuilder()
  const ceil = new GeoBuilder()
  const ribs = new GeoBuilder()
  const vaulted = typeof b.ceiling !== 'number'
  const ceilMat = b.utility ? lib.ceiling : b.ceilingFinish === 'wood' ? lib.ceilingWood : lib.ceiling

  /** one planar slab over [ax0..ax1] x [az0..az1] (heights from U, which is planar over this patch) */
  const slab = (ax0: number, az0: number, ax1: number, az1: number, ribAxis: 'x' | 'z', skipEdges: Side[] = []) => {
    const P = (x: number, z: number, up: number) => V3(x, U(x, z) + up, z)
    const bt = [P(ax0, az1, 0), P(ax1, az1, 0), P(ax1, az0, 0), P(ax0, az0, 0)]
    const tp = [P(ax0, az1, T), P(ax1, az1, T), P(ax1, az0, T), P(ax0, az0, T)]
    top.quad(tp[0], tp[1], tp[2], tp[3])
    // fascia edges: s0 = south edge, s1 = east, s2 = north, s3 = west
    const edgeSides: Side[] = ['s', 'e', 'n', 'w']
    for (let i = 0; i < 4; i++) {
      if (skipEdges.includes(edgeSides[i])) continue
      const j = (i + 1) % 4
      fascia.quad(bt[i], bt[j], tp[j], tp[i])
    }
    // underside: inner part = ceiling, outer strips = soffit
    const ix0 = Math.max(ax0, x0)
    const ix1 = Math.min(ax1, x1)
    const iz0 = Math.max(az0, z0)
    const iz1 = Math.min(az1, z1)
    const under = (g: GeoBuilder, a0: number, c0: number, a1: number, c1: number) => {
      if (a1 - a0 < 1e-3 || c1 - c0 < 1e-3) return
      g.quad(P(a0, c0, 0), P(a1, c0, 0), P(a1, c1, 0), P(a0, c1, 0))
    }
    if (vaulted) under(ceil, ix0, iz0, ix1, iz1)
    under(soffit, ax0, az0, ax1, Math.min(az1, z0)) // north strip
    under(soffit, ax0, Math.max(az0, z1), ax1, az1) // south strip
    under(soffit, ax0, iz0, Math.min(ax1, x0), iz1) // west strip
    under(soffit, Math.max(ax0, x1), iz0, ax1, iz1) // east strip
    // standing seams
    const n = new THREE.Vector3().subVectors(tp[1], tp[0]).cross(new THREE.Vector3().subVectors(tp[3], tp[0])).normalize()
    const lift = n.clone().multiplyScalar(0.018)
    if (ribAxis === 'x') {
      for (let z = az0 + RIB_PITCH / 2; z < az1 - 0.05; z += RIB_PITCH) {
        ribs.beam(P(ax0 + 0.01, z, T).add(lift), P(ax1 - 0.01, z, T).add(lift), 0.022, 0.036, n)
      }
    } else {
      for (let x = ax0 + RIB_PITCH / 2; x < ax1 - 0.05; x += RIB_PITCH) {
        ribs.beam(P(x, az0 + 0.01, T).add(lift), P(x, az1 - 0.01, T).add(lift), 0.022, 0.036, n)
      }
    }
  }

  if (r.type === 'shed') {
    const along = r.rises === 'e' || r.rises === 'w' ? 'x' : 'z'
    slab(ex0, ez0, ex1, ez1, along)
    gutterAndDownspouts(plan, b, lib, roofBatch, lowSide(r.rises), { ex0, ex1, ez0, ez1 }, U, T)
    if (r.solar) solarArray(lib, roofBatch, b, r.rises, { ex0, ex1, ez0, ez1 }, U, T, r.solar)
  } else if (r.type === 'gable') {
    if (r.ridgeAxis === 'x') {
      const zc = (z0 + z1) / 2
      slab(ex0, zc, ex1, ez1, 'z', ['n'])
      slab(ex0, ez0, ex1, zc, 'z', ['s'])
      // ridge cap
      const capY = U(x0, zc) + T
      const cap = new GeoBuilder()
      cap.box(ex0 - 0.02, capY - 0.06, zc - 0.16, ex1 + 0.02, capY + 0.05, zc + 0.16)
      roofBatch.add(lib.zone('roof'), cap.build())
      gutterAndDownspouts(plan, b, lib, roofBatch, 's', { ex0, ex1, ez0, ez1 }, U, T)
      gutterAndDownspouts(plan, b, lib, roofBatch, 'n', { ex0, ex1, ez0, ez1 }, U, T)
    } else {
      const xc = (x0 + x1) / 2
      slab(xc, ez0, ex1, ez1, 'x', ['w'])
      slab(ex0, ez0, xc, ez1, 'x', ['e'])
      const capY = U(xc, z0) + T
      const cap = new GeoBuilder()
      cap.box(xc - 0.16, capY - 0.06, ez0 - 0.02, xc + 0.16, capY + 0.05, ez1 + 0.02)
      roofBatch.add(lib.zone('roof'), cap.build())
      gutterAndDownspouts(plan, b, lib, roofBatch, 'e', { ex0, ex1, ez0, ez1 }, U, T)
      gutterAndDownspouts(plan, b, lib, roofBatch, 'w', { ex0, ex1, ez0, ez1 }, U, T)
    }
  } else {
    slab(ex0, ez0, ex1, ez1, 'z')
  }

  // flat ceilings below a vault/attic
  if (!vaulted) {
    const h = fy + (b.ceiling as number)
    ceil.quad(V3(x0, h, z0), V3(x1, h, z0), V3(x1, h, z1), V3(x0, h, z1))
  }

  // soffit downlights over exterior doors/terraces: every ~2.4 m along overhangs deeper than 0.6 m
  for (const s of ['s', 'n', 'e', 'w'] as Side[]) {
    if (oh[s] < 0.6) continue
    const { intervals, frame } = sideIntervals(b, s, plan.blocks)
    for (const iv of intervals) {
      if (iv.neighbour) continue
      for (let u = iv.u0 + 1.2; u < iv.u1 - 0.6; u += 2.4) {
        const px = frame.sx + frame.dx * u + frame.ox * (oh[s] * 0.5)
        const pz = frame.sz + frame.dz * u + frame.oz * (oh[s] * 0.5)
        out.downlights.push(V3(px, U(px, pz) - 0.01, pz))
      }
    }
  }

  roofBatch.add(lib.zone('roof'), top.build())
  roofBatch.add(lib.zone('roof'), ribs.build())
  roofBatch.add(lib.zone('trim'), fascia.build())
  roofBatch.add(b.cladding.default.kind === 'boards' ? lib.soffit : lib.soffitDark, soffit.build())
  ceilingBatch.add(ceilMat, ceil.build())
}

function lowSide(rises: Side): Side {
  return rises === 'e' ? 'w' : rises === 'w' ? 'e' : rises === 'n' ? 's' : 'n'
}

function gutterAndDownspouts(
  plan: HomePlan,
  b: Block,
  lib: MaterialLibrary,
  batch: MeshBatch,
  side: Side,
  e: { ex0: number; ex1: number; ez0: number; ez1: number },
  U: (x: number, z: number) => number,
  T: number,
) {
  const gb = new GeoBuilder()
  const [x0, z0, x1, z1] = b.rect
  const gw = 0.11
  const gh = 0.1
  const cladOut = 0.06
  // only along stretches that are actually exterior at this side (no gutters dumping onto a neighbour wall)
  const { intervals } = sideIntervals(b, side, plan.blocks)
  if (!intervals.some(iv => !iv.neighbour)) return
  if (side === 'n' || side === 's') {
    const z = side === 's' ? e.ez1 : e.ez0
    const zo = side === 's' ? z + gw : z - gw
    const yTop = U(x0, z) + T - 0.02
    gb.box(e.ex0, yTop - gh, Math.min(z, zo), e.ex1, yTop, Math.max(z, zo))
    const wallZ = side === 's' ? z1 + cladOut : z0 - cladOut
    for (const x of [x0 + 0.18, x1 - 0.18]) {
      const zc = (z + zo) / 2
      gb.beam(V3(x, yTop - gh, zc), V3(x, yTop - gh - 0.25, wallZ + (side === 's' ? 0.05 : -0.05)), 0.075, 0.075)
      gb.box(x - 0.04, 0.05, Math.min(wallZ, wallZ + (side === 's' ? 0.09 : -0.09)), x + 0.04, yTop - gh - 0.2, Math.max(wallZ, wallZ + (side === 's' ? 0.09 : -0.09)))
    }
  } else {
    const x = side === 'e' ? e.ex1 : e.ex0
    const xo = side === 'e' ? x + gw : x - gw
    const yTop = U(x, z0) + T - 0.02
    gb.box(Math.min(x, xo), yTop - gh, e.ez0, Math.max(x, xo), yTop, e.ez1)
    const wallX = side === 'e' ? x1 + cladOut : x0 - cladOut
    for (const z of [z0 + 0.18, z1 - 0.18]) {
      const xc = (x + xo) / 2
      gb.beam(V3(xc, yTop - gh, z), V3(wallX + (side === 'e' ? 0.05 : -0.05), yTop - gh - 0.25, z), 0.075, 0.075)
      gb.box(Math.min(wallX, wallX + (side === 'e' ? 0.09 : -0.09)), 0.05, z - 0.04, Math.max(wallX, wallX + (side === 'e' ? 0.09 : -0.09)), yTop - gh - 0.2, z + 0.04)
    }
  }
  batch.add(lib.zone('trim'), gb.build())
}

function solarArray(
  lib: MaterialLibrary,
  batch: MeshBatch,
  b: Block,
  rises: Side,
  e: { ex0: number; ex1: number; ez0: number; ez1: number },
  U: (x: number, z: number) => number,
  T: number,
  cfg: { rows: number; cols: number; inset?: number },
) {
  const inset = cfg.inset ?? 0.6
  const pw = 1.05 // across slope
  const pl = 1.75 // along slope
  const gap = 0.025
  const alongX = rises === 'e' || rises === 'w'
  // plan extents along / across slope
  const a0 = alongX ? e.ex0 : e.ez0
  const a1 = alongX ? e.ex1 : e.ez1
  const c0 = alongX ? e.ez0 : e.ex0
  const c1 = alongX ? e.ez1 : e.ex1
  const runA = cfg.rows * pl + (cfg.rows - 1) * gap
  const runC = cfg.cols * pw + (cfg.cols - 1) * gap
  // plan length along slope is shorter than the sloped length; compute slope factor
  const slope = Math.abs((U(alongX ? a1 : c0, alongX ? c0 : a1) - U(alongX ? a0 : c0, alongX ? c0 : a0)) / (a1 - a0))
  const k = 1 / Math.sqrt(1 + slope * slope)
  const startA = (a0 + a1) / 2 - (runA * k) / 2
  const startC = (c0 + c1) / 2 - runC / 2
  if (runA * k > a1 - a0 - 2 * inset * k || runC > c1 - c0 - 2 * inset) {
    // does not fit, skip silently
  }
  const frame = new GeoBuilder()
  const geos: THREE.BufferGeometry[] = []
  const P = (a: number, c: number, up: number) => {
    const x = alongX ? a : c
    const z = alongX ? c : a
    return V3(x, U(x, z) + T + up, z)
  }
  for (let i = 0; i < cfg.rows; i++)
    for (let j = 0; j < cfg.cols; j++) {
      const pa0 = startA + i * (pl + gap) * k
      const pa1 = pa0 + pl * k
      const pc0 = startC + j * (pw + gap)
      const pc1 = pc0 + pw
      const lo = 0.09
      const hi = 0.13
      const bt = [P(pa0, pc1, lo), P(pa1, pc1, lo), P(pa1, pc0, lo), P(pa0, pc0, lo)]
      const tp = [P(pa0, pc1, hi), P(pa1, pc1, hi), P(pa1, pc0, hi), P(pa0, pc0, hi)]
      frame.hexa(bt, tp, ['top'])
      // glass with cell texture
      const g = new THREE.BufferGeometry()
      const q = [P(pa0 + 0.02, pc0 + 0.02, hi + 0.002), P(pa1 - 0.02, pc0 + 0.02, hi + 0.002), P(pa1 - 0.02, pc1 - 0.02, hi + 0.002), P(pa0 + 0.02, pc1 - 0.02, hi + 0.002)]
      const n = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[3], q[0])).normalize()
      const flip = n.y < 0
      const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3]
      const pos: number[] = []
      const nor: number[] = []
      const uv = [0, 0, 0, 1, 1, 1, 1, 0]
      const uvs: number[] = []
      for (const idx of order) {
        pos.push(q[idx].x, q[idx].y, q[idx].z)
        nor.push(flip ? -n.x : n.x, flip ? -n.y : n.y, flip ? -n.z : n.z)
        uvs.push(uv[idx * 2], uv[idx * 2 + 1])
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      g.setIndex([0, 1, 2, 0, 2, 3])
      geos.push(g)
      // mounting rails
      frame.beam(P(pa0 + 0.25 * k, pc0 - 0.05, 0.02), P(pa0 + 0.25 * k, pc1 + 0.05, 0.02), 0.04, 0.05)
      frame.beam(P(pa1 - 0.25 * k, pc0 - 0.05, 0.02), P(pa1 - 0.25 * k, pc1 + 0.05, 0.02), 0.04, 0.05)
    }
  void b
  batch.add(lib.solarFrame, frame.build())
  for (const g of geos) batch.add(lib.solar, g)
}
