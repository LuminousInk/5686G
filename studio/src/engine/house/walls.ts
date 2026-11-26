import * as THREE from 'three'
import { applyMatrixKeepWinding, GeoBuilder, MeshBatch, V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import {
  ceilingAt,
  roofBreaks,
  roofHeightAt,
  roofThickness,
  sideFrame,
  sideIntervals,
  sideMatrix,
  sidePoint,
  SIDES,
  WALL_T,
  type SideFrame,
} from './massing'
import type { Block, CladdingSpec, HomePlan, Opening, Side } from './types'

export interface Segment2 {
  ax: number
  az: number
  bx: number
  bz: number
  /** collision only below this height (world y); Infinity for full walls */
  top?: number
  bottom?: number
}

interface Hole {
  u0: number
  u1: number
  y0: number
  y1: number
  op: Opening
}

interface Piece {
  f: SideFrame
  block: Block
  u0: number
  u1: number
  /** extend cladding past the ends (convex corners) */
  ext0: number
  ext1: number
  bottom: (u: number) => number
  cladBottom: (u: number) => number
  top: (u: number) => number
  breaks: number[]
  clad: CladdingSpec
  holes: Hole[]
  ground: boolean
}

const BACKER = new THREE.MeshStandardMaterial({ color: '#17130f', roughness: 1, name: 'backer' })

export interface WallOutput {
  colliders: Segment2[]
  sconces: THREE.Vector3[]
  lightsAt: { pos: THREE.Vector3; dir: THREE.Vector3 }[]
}

/** Builds exterior walls, cladding, openings for all blocks into `batch`. */
export function buildExteriorWalls(plan: HomePlan, lib: MaterialLibrary, batch: MeshBatch): WallOutput {
  const out: WallOutput = { colliders: [], sconces: [], lightsAt: [] }
  const fy = plan.floorY
  const rand = rng(1234)

  for (const b of plan.blocks) {
    for (const s of SIDES) {
      const { frame: f, intervals } = sideIntervals(b, s, plan.blocks)
      const clad = b.cladding[s] ?? b.cladding.default
      const breaks = roofBreaks(b, f)
      const top = (u: number) => {
        const [x, z] = sidePoint(f, u)
        return fy + roofHeightAt(b, x, z)
      }
      const openings = plan.openings.filter(o => o.block === b.id && o.side === s)
      for (let i = 0; i < intervals.length; i++) {
        const iv = intervals[i]
        let piece: Piece
        if (!iv.neighbour) {
          const corner0 = iv.u0 < 1e-4
          const corner1 = iv.u1 > f.length - 1e-4
          const cladT = claddingDepth(clad)
          piece = {
            f, block: b, u0: iv.u0, u1: iv.u1,
            ext0: corner0 ? cladT : 0,
            ext1: corner1 ? cladT : 0,
            bottom: () => fy - 0.02,
            cladBottom: () => fy - 0.06,
            top, breaks: breaks.filter(u => u > iv.u0 && u < iv.u1), clad, holes: [], ground: true,
          }
        } else {
          const n = iv.neighbour
          const nb = (u: number) => {
            const [x, z] = sidePoint(f, u)
            return fy + ceilingAt(n, x, z)
          }
          const nTop = (u: number) => {
            const [x, z] = sidePoint(f, u)
            return fy + roofHeightAt(n, x, z) + roofThickness(n.roof)
          }
          // only the part of this wall that rises above the neighbour's roof is exterior
          const um = (iv.u0 + iv.u1) / 2
          if (top(um) <= nb(um) + 0.05) continue
          const nf = sideFrame(n.rect, opposite(s))
          piece = {
            f, block: b, u0: iv.u0, u1: iv.u1, ext0: 0, ext1: 0,
            bottom: u => Math.min(nb(u), top(u) - 0.01),
            cladBottom: u => Math.min(nTop(u), top(u) - 0.01),
            top,
            breaks: [...breaks, ...roofBreaks(n, nf).map(u => u)].filter(u => u > iv.u0 && u < iv.u1),
            clad, holes: [], ground: false,
          }
        }
        for (const op of openings) {
          const u0 = op.at - op.width / 2
          const u1 = op.at + op.width / 2
          if (u0 < piece.u0 - 1e-3 || u1 > piece.u1 + 1e-3) continue
          const y0 = fy + (op.sill ?? 0)
          piece.holes.push({ u0, u1, y0, y1: y0 + op.height, op })
        }
        buildPiece(piece, lib, batch, rand, out)
      }
    }
    // corner trims on convex exterior corners
    cornerTrims(plan, b, lib, batch)
  }
  return out
}

function opposite(s: Side): Side {
  return s === 'n' ? 's' : s === 's' ? 'n' : s === 'e' ? 'w' : 'e'
}

function claddingDepth(c: CladdingSpec) {
  switch (c.kind) {
    case 'boards': return 0.026
    case 'panel': return 0.04
    case 'batten': return 0.036
    case 'lap': return 0.032
    default: return 0.024
  }
}

/** Polygon outline of a piece in (u, y): bottom left->right, then top right->left. */
function outline(p: Piece, u0: number, u1: number, bottom: (u: number) => number) {
  const us = [u0, ...p.breaks.filter(u => u > u0 && u < u1), u1]
  const pts: [number, number][] = []
  for (const u of us) pts.push([u, bottom(u)])
  for (const u of [...us].reverse()) pts.push([u, p.top(u)])
  return pts
}

function shapeWithHoles(pts: [number, number][], holes: Hole[], pad = 0): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1])
  shape.closePath()
  for (const h of holes) {
    const path = new THREE.Path()
    path.moveTo(h.u0 - pad, h.y0 - pad)
    path.lineTo(h.u0 - pad, h.y1 + pad)
    path.lineTo(h.u1 + pad, h.y1 + pad)
    path.lineTo(h.u1 + pad, h.y0 - pad)
    path.closePath()
    shape.holes.push(path)
  }
  return shape
}

function extrude(shape: THREE.Shape, w0: number, w1: number, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: w1 - w0, bevelEnabled: false, steps: 1 })
  g.translate(0, 0, w0)
  const ng = g.index ? g : g
  applyMatrixKeepWinding(ng, m)
  return ng
}

/** Remaining vertical spans of a column at u after removing holes that cover u. */
function columnSpans(p: Piece, ua: number, ub: number, bottom: (u: number) => number, margin = 0) {
  const um = (ua + ub) / 2
  const blocked = p.holes
    .filter(h => um > h.u0 - margin && um < h.u1 + margin)
    .map(h => [h.y0 - margin, h.y1 + margin] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const spans: { lo: 'base' | number; hi: 'top' | number }[] = []
  let lo: 'base' | number = 'base'
  for (const [y0, y1] of blocked) {
    spans.push({ lo, hi: y0 })
    lo = y1
  }
  spans.push({ lo, hi: 'top' })
  // drop empty spans
  return spans.filter(s => {
    const l = s.lo === 'base' ? Math.max(bottom(ua), bottom(ub)) : s.lo
    const h = s.hi === 'top' ? Math.min(p.top(ua), p.top(ub)) : s.hi
    return h - l > 0.01
  })
}

/** Sub-columns of [a,b] split at hole edges so cut boards end exactly at openings. */
function splitAtHoles(p: Piece, a: number, b: number, margin = 0) {
  const cuts = [a, b]
  for (const h of p.holes) {
    for (const e of [h.u0 - margin, h.u1 + margin]) if (e > a + 1e-4 && e < b - 1e-4) cuts.push(e)
  }
  cuts.sort((x, y) => x - y)
  const out: [number, number][] = []
  for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] > 0.004) out.push([cuts[i], cuts[i + 1]])
  return out
}

/** Vertical prism between u=a..b, w=w0..w1 with (possibly sloped) bottom and top. */
function vprism(gb: GeoBuilder, a: number, b: number, w0: number, w1: number, ya0: number, yb0: number, ya1: number, yb1: number, skipBack = true) {
  const bot = [V3(a, ya0, w1), V3(b, yb0, w1), V3(b, yb0, w0), V3(a, ya0, w0)]
  const top = [V3(a, ya1, w1), V3(b, yb1, w1), V3(b, yb1, w0), V3(a, ya1, w0)]
  gb.hexa(bot, top, skipBack ? ['s0'] : [])
}

function buildPiece(p: Piece, lib: MaterialLibrary, batch: MeshBatch, rand: () => number, out: WallOutput) {
  const m = sideMatrix(p.f)
  const zoneMat = lib.zone(p.clad.zone)
  // structure (interior paint on both faces; the outer face is hidden by cladding)
  const structure = extrude(shapeWithHoles(outline(p, p.u0, p.u1, p.bottom), p.holes), 0, WALL_T, m)
  batch.add(lib.wall, structure)
  if (p.ground) {
    // collision segment along the exterior face, interrupted by doors
    const doorHoles = p.holes.filter(h => h.op.kind === 'slider' || h.op.kind === 'entry' || h.op.kind === 'door' || h.op.kind === 'garage')
    let u = p.u0
    for (const h of [...doorHoles].sort((x, y) => x.u0 - y.u0)) {
      pushSeg(p.f, u, h.u0, out)
      u = h.u1
    }
    pushSeg(p.f, u, p.u1, out)
    // foundation band, recessed behind the cladding
    const fb = new GeoBuilder()
    const yTop = p.cladBottom(0) + 0.03
    vprism(fb, p.u0 - (p.ext0 ? 0 : 0), p.u1, -0.004, WALL_T, -0.3, -0.3, yTop, yTop, false)
    batch.add(lib.foundation, applyMatrixKeepWinding(fb.build(), m))
  }

  const cu0 = p.u0 - p.ext0
  const cu1 = p.u1 + p.ext1
  const cladBottom = p.cladBottom
  const cladPiece: Piece = { ...p, u0: cu0, u1: cu1 }
  const kind = p.clad.kind
  const gb = new GeoBuilder()

  if (kind === 'boards' || kind === 'batten' || kind === 'lap') {
    batch.add(BACKER, extrude(shapeWithHoles(outline(cladPiece, cu0, cu1, cladBottom), p.holes), -0.006, -0.002, m))
  }

  if (kind === 'boards') {
    const bw = 0.138
    const gap = 0.007
    const T = 0.022
    for (let u = cu0; u < cu1 - 0.01; u += bw + gap) {
      const ub = Math.min(u + bw, cu1)
      const tone = 0.86 + rand() * 0.28
      const warm = (rand() - 0.5) * 0.08
      gb.color = [tone * (1 + warm), tone, tone * (1 - warm)]
      gb.uvOffset = [rand() * 7, rand() * 11]
      for (const [a, b] of splitAtHoles(cladPiece, u, ub)) {
        for (const s of columnSpans(cladPiece, a, b, cladBottom)) {
          const ya0 = s.lo === 'base' ? cladBottom(a) : s.lo
          const yb0 = s.lo === 'base' ? cladBottom(b) : s.lo
          const ya1 = s.hi === 'top' ? p.top(a) : s.hi
          const yb1 = s.hi === 'top' ? p.top(b) : s.hi
          vprism(gb, a, b, -0.004 - T, -0.004, ya0, yb0, ya1, yb1)
        }
      }
    }
    gb.color = [1, 1, 1]
    gb.uvOffset = [0, 0]
    batch.add(zoneMat, applyMatrixKeepWinding(gb.build(true), m))
  } else if (kind === 'panel' || kind === 'stucco') {
    const T = kind === 'panel' ? 0.012 : 0.02
    batch.add(zoneMat, extrude(shapeWithHoles(outline(cladPiece, cu0, cu1, cladBottom), p.holes), -0.004 - T, -0.004, m))
    if (kind === 'panel') {
      const pitch = 0.46
      const rw = 0.024
      const rd = 0.024
      const n = Math.max(1, Math.round((cu1 - cu0) / pitch))
      const step = (cu1 - cu0) / n
      for (let i = 1; i < n; i++) {
        const uc = cu0 + i * step
        for (const [a, b] of splitAtHoles(cladPiece, uc - rw / 2, uc + rw / 2, 0.01)) {
          for (const s of columnSpans(cladPiece, a, b, cladBottom, 0.01)) {
            const ya0 = s.lo === 'base' ? cladBottom(a) : s.lo
            const yb0 = s.lo === 'base' ? cladBottom(b) : s.lo
            const ya1 = s.hi === 'top' ? p.top(a) : s.hi
            const yb1 = s.hi === 'top' ? p.top(b) : s.hi
            vprism(gb, a, b, -0.016 - rd, -0.016, ya0, yb0, ya1, yb1)
          }
        }
      }
      batch.add(zoneMat, applyMatrixKeepWinding(gb.build(true), m))
    }
  } else if (kind === 'batten') {
    batch.add(zoneMat, extrude(shapeWithHoles(outline(cladPiece, cu0, cu1, cladBottom), p.holes), -0.018, -0.004, m))
    const pitch = 0.41
    const bw = 0.055
    for (let uc = cu0 + pitch / 2; uc < cu1 - 0.05; uc += pitch) {
      for (const [a, b] of splitAtHoles(cladPiece, uc - bw / 2, uc + bw / 2, 0.01)) {
        for (const s of columnSpans(cladPiece, a, b, cladBottom, 0.01)) {
          const ya0 = s.lo === 'base' ? cladBottom(a) : s.lo
          const yb0 = s.lo === 'base' ? cladBottom(b) : s.lo
          const ya1 = s.hi === 'top' ? p.top(a) : s.hi
          const yb1 = s.hi === 'top' ? p.top(b) : s.hi
          vprism(gb, a, b, -0.036, -0.018, ya0, yb0, ya1, yb1)
        }
      }
    }
    batch.add(zoneMat, applyMatrixKeepWinding(gb.build(true), m))
  } else if (kind === 'lap') {
    // horizontal lap boards with a shadow line under each course
    const course = 0.18
    const y0 = Math.min(cladBottom(cu0), cladBottom(cu1))
    const yMax = Math.max(...[cu0, cu1, ...p.breaks].map(u => p.top(u)))
    for (let y = y0; y < yMax; y += course) {
      // u intervals of this course not blocked by holes
      const blocks = p.holes.filter(h => y + course > h.y0 && y < h.y1).map(h => [h.u0, h.u1]).sort((a, b) => a[0] - b[0])
      const ivs: [number, number][] = []
      let u = cu0
      for (const [a, b] of blocks) {
        if (a > u) ivs.push([u, a])
        u = Math.max(u, b)
      }
      if (u < cu1) ivs.push([u, cu1])
      for (const [a, b] of ivs) {
        // clip course to the outline top (sloped tops: step down in short runs)
        const step = 0.6
        for (let ua = a; ua < b - 1e-3; ua += step) {
          const ub = Math.min(b, ua + step)
          const ta = p.top(ua)
          const tb = p.top(ub)
          const lo = Math.max(y, cladBottom(ua))
          if (lo >= Math.min(ta, tb)) continue
          const ha = Math.min(y + course, ta)
          const hb = Math.min(y + course, tb)
          const bot = [V3(ua, lo, -0.004), V3(ub, lo, -0.004), V3(ub, lo, -0.034), V3(ua, lo, -0.034)]
          const top = [V3(ua, ha, -0.004), V3(ub, hb, -0.004), V3(ub, hb, -0.016), V3(ua, ha, -0.016)]
          gb.hexa(bot, top, ['s0'])
        }
      }
    }
    batch.add(zoneMat, applyMatrixKeepWinding(gb.build(true), m))
  }

  for (const h of p.holes) buildOpening(p, h, lib, batch, m, out)
}

function pushSeg(f: SideFrame, u0: number, u1: number, out: WallOutput) {
  if (u1 - u0 < 0.02) return
  const [ax, az] = sidePoint(f, u0, WALL_T / 2)
  const [bx, bz] = sidePoint(f, u1, WALL_T / 2)
  out.colliders.push({ ax, az, bx, bz })
}

/** Frames, glass, doors, flashing and sconces for one opening (local side space, then transformed). */
function buildOpening(p: Piece, h: Hole, lib: MaterialLibrary, batch: MeshBatch, m: THREE.Matrix4, out: WallOutput) {
  const trim = new GeoBuilder()
  const glass = new GeoBuilder()
  const door = new GeoBuilder()
  const steel = new GeoBuilder()
  const op = h.op
  const fw = op.kind === 'garage' ? 0.03 : 0.055
  const w0 = 0.02 // frame front (inside the wall thickness, set back from the face)
  const w1 = 0.13
  const { u0, u1, y0, y1 } = h
  // outer frame: jambs, head, sill
  if (op.kind !== 'garage') {
    vprism(trim, u0, u0 + fw, w0, w1, y0, y0, y1, y1, false)
    vprism(trim, u1 - fw, u1, w0, w1, y0, y0, y1, y1, false)
    vprism(trim, u0 + fw, u1 - fw, w0, w1, y1 - fw, y1 - fw, y1, y1, false)
    vprism(trim, u0 + fw, u1 - fw, w0, w1, y0, y0, y0 + fw, y0 + fw, false)
    // reveal liner (black metal wrap from the cladding face to the frame)
    vprism(trim, u0 - 0.012, u0, -0.04, w0 + 0.01, y0 - 0.012, y0 - 0.012, y1 + 0.012, y1 + 0.012, false)
    vprism(trim, u1, u1 + 0.012, -0.04, w0 + 0.01, y0 - 0.012, y0 - 0.012, y1 + 0.012, y1 + 0.012, false)
    vprism(trim, u0, u1, -0.04, w0 + 0.01, y1, y1, y1 + 0.012, y1 + 0.012, false)
    if ((op.sill ?? 0) > 0.05) {
      // sill flashing, slightly proud of the cladding
      vprism(trim, u0 - 0.025, u1 + 0.025, -0.06, w0 + 0.01, y0 - 0.014, y0 - 0.014, y0, y0, false)
    } else {
      vprism(trim, u0, u1, -0.04, w0 + 0.01, y0 - 0.012, y0 - 0.012, y0, y0, false)
    }
  }
  const ix0 = u0 + fw
  const ix1 = u1 - fw
  const iy0 = y0 + (op.kind === 'garage' ? 0 : fw)
  const iy1 = y1 - fw
  const gw = 0.075 // glass plane depth
  const pane = (a: number, b: number, c: number, d: number, w = gw) => {
    glass.quad(V3(a, c, w), V3(b, c, w), V3(b, d, w), V3(a, d, w))
  }
  switch (op.kind) {
    case 'window':
    case 'fixed':
    case 'clerestory': {
      const panes = op.panes ?? (ix1 - ix0 > 1.6 ? 2 : 1)
      const pw = (ix1 - ix0) / panes
      for (let i = 1; i < panes; i++) {
        const c = ix0 + i * pw
        vprism(trim, c - fw * 0.45, c + fw * 0.45, w0 + 0.01, w1 - 0.01, iy0, iy0, iy1, iy1, false)
      }
      let ty = iy1
      if (op.transom && op.transom < op.height - 0.3) {
        ty = y0 + op.transom
        vprism(trim, ix0, ix1, w0 + 0.01, w1 - 0.01, ty - fw * 0.45, ty - fw * 0.45, ty + fw * 0.45, ty + fw * 0.45, false)
      }
      pane(ix0, ix1, iy0, iy1)
      break
    }
    case 'slider': {
      // two leaves on two tracks; the right leaf is slid open behind the left one
      const half = (ix1 - ix0) / 2
      const lf = 0.05
      const leaf = (a: number, b: number, wa: number, wb: number) => {
        vprism(trim, a, a + lf, wa, wb, iy0, iy0, iy1, iy1, false)
        vprism(trim, b - lf, b, wa, wb, iy0, iy0, iy1, iy1, false)
        vprism(trim, a + lf, b - lf, wa, wb, iy1 - lf, iy1 - lf, iy1, iy1, false)
        vprism(trim, a + lf, b - lf, wa, wb, iy0, iy0, iy0 + lf * 1.4, iy0 + lf * 1.4, false)
        pane(a + lf, b - lf, iy0 + lf * 1.4, iy1 - lf, (wa + wb) / 2)
      }
      leaf(ix0, ix0 + half + 0.02, 0.03, 0.07)
      const open = h.op.id?.includes('open') ? 0.92 : 0
      leaf(ix0 + half - 0.02 - open * half, ix1 - open * half, 0.08, 0.12)
      // pull handle
      steel.box(ix0 + half - 0.09, iy0 + 0.85, 0.0, ix0 + half - 0.075, iy0 + 1.25, 0.03)
      break
    }
    case 'door': {
      const lf = 0.06
      vprism(trim, ix0, ix0 + lf, 0.05, 0.1, iy0, iy0, iy1, iy1, false)
      vprism(trim, ix1 - lf, ix1, 0.05, 0.1, iy0, iy0, iy1, iy1, false)
      vprism(trim, ix0 + lf, ix1 - lf, 0.05, 0.1, iy1 - lf, iy1 - lf, iy1, iy1, false)
      vprism(trim, ix0 + lf, ix1 - lf, 0.05, 0.1, iy0, iy0, iy0 + 0.12, iy0 + 0.12, false)
      pane(ix0 + lf, ix1 - lf, iy0 + 0.12, iy1 - lf)
      steel.box(ix1 - 0.16, iy0 + 0.9, 0.0, ix1 - 0.14, iy0 + 1.15, 0.05)
      break
    }
    case 'entry': {
      // solid door leaf + optional sidelite
      const doorW = Math.min(1.05, ix1 - ix0)
      const lite = ix1 - ix0 - doorW
      const d0 = ix0
      const d1 = ix0 + doorW
      door.color = [1, 1, 1]
      vprism(door, d0, d1, 0.05, 0.1, iy0, iy0, iy1, iy1, false)
      if (lite > 0.15) {
        vprism(trim, d1, d1 + fw * 0.8, w0 + 0.01, w1 - 0.01, iy0, iy0, iy1, iy1, false)
        pane(d1 + fw * 0.8, ix1, iy0, iy1)
      }
      // long vertical pull
      steel.box(d1 - 0.12, iy0 + 0.55, -0.02, d1 - 0.1, iy0 + 1.75, 0.05)
      steel.box(d1 - 0.12, iy0 + 0.6, 0.0, d1 - 0.1, iy0 + 0.64, 0.05)
      steel.box(d1 - 0.12, iy0 + 1.66, 0.0, d1 - 0.1, iy0 + 1.7, 0.05)
      break
    }
    case 'garage': {
      const panels = 4
      const ph = (y1 - y0) / panels
      for (let i = 0; i < panels; i++) {
        const a = y0 + i * ph + 0.006
        const b = y0 + (i + 1) * ph - 0.006
        vprism(door, u0, u1, 0.04, 0.09, a, a, b, b, false)
      }
      vprism(trim, u0 - 0.01, u1 + 0.01, -0.04, 0.03, y1, y1, y1 + 0.03, y1 + 0.03, false)
      break
    }
  }
  batch.add(lib.zone('trim'), applyMatrixKeepWinding(trim.build(), m))
  if (glass.vertexCount) {
    const g = applyMatrixKeepWinding(glass.build(), m)
    batch.add(lib.glass, g)
  }
  if (door.vertexCount) batch.add(lib.zone('door'), applyMatrixKeepWinding(door.build(true), m))
  if (steel.vertexCount) batch.add(lib.steel, applyMatrixKeepWinding(steel.build(), m))

  // sconces beside ground-floor doors
  if (p.ground && (op.kind === 'slider' || op.kind === 'entry' || op.kind === 'door')) {
    const sc = new GeoBuilder()
    const glow = new GeoBuilder()
    const yy = Math.min(y1 + 0.25, p.top(op.at) - 0.3)
    for (const uc of [u0 - 0.32, u1 + 0.32]) {
      if (uc < p.u0 + 0.1 || uc > p.u1 - 0.1) continue
      vprism(sc, uc - 0.045, uc + 0.045, -0.13, -0.03, yy - 0.12, yy - 0.12, yy + 0.12, yy + 0.12, false)
      glow.quad(V3(uc - 0.035, yy - 0.121, -0.12), V3(uc + 0.035, yy - 0.121, -0.12), V3(uc + 0.035, yy - 0.121, -0.04), V3(uc - 0.035, yy - 0.121, -0.04))
      glow.quad(V3(uc - 0.035, yy - 0.121, -0.04), V3(uc + 0.035, yy - 0.121, -0.04), V3(uc + 0.035, yy - 0.121, -0.12), V3(uc - 0.035, yy - 0.121, -0.12))
      const wp = V3(uc, yy - 0.2, -0.3).applyMatrix4(m)
      out.sconces.push(wp)
    }
    batch.add(lib.steel, applyMatrixKeepWinding(sc.build(), m))
    batch.add(lib.lamp('sconce', '#ffcf9a', 30), applyMatrixKeepWinding(glow.build(), m))
  }
}

/** Vertical corner trims where two exterior faces meet (hides the cladding seam). */
function cornerTrims(plan: HomePlan, b: Block, lib: MaterialLibrary, batch: MeshBatch) {
  const [x0, z0, x1, z1] = b.rect
  const corners: { x: number; z: number; sx: number; sz: number; a: Side; c: Side }[] = [
    { x: x0, z: z1, sx: -1, sz: 1, a: 'w', c: 's' },
    { x: x1, z: z1, sx: 1, sz: 1, a: 'e', c: 's' },
    { x: x1, z: z0, sx: 1, sz: -1, a: 'e', c: 'n' },
    { x: x0, z: z0, sx: -1, sz: -1, a: 'w', c: 'n' },
  ]
  const gb = new GeoBuilder()
  for (const k of corners) {
    // both sides must be exterior at this corner
    const ext = (s: Side) => {
      const { intervals, frame } = sideIntervals(b, s, plan.blocks)
      const u = s === 'n' || s === 's' ? k.x - x0 : k.z - z0
      return intervals.some(iv => !iv.neighbour && u >= iv.u0 - 1e-3 && u <= iv.u1 + 1e-3) && frame.length > 0
    }
    if (!ext(k.a) || !ext(k.c)) continue
    const ca = claddingDepth(b.cladding[k.a] ?? b.cladding.default)
    const cc = claddingDepth(b.cladding[k.c] ?? b.cladding.default)
    const t = Math.max(ca, cc) + 0.008
    const yTop = plan.floorY + roofHeightAt(b, k.x, k.z)
    const yBot = plan.floorY - 0.06
    const xa = Math.min(k.x - k.sx * 0.03, k.x + k.sx * t)
    const xb = Math.max(k.x - k.sx * 0.03, k.x + k.sx * t)
    const za = Math.min(k.z - k.sz * 0.03, k.z + k.sz * t)
    const zb = Math.max(k.z - k.sz * 0.03, k.z + k.sz * t)
    gb.box(xa, yBot, za, xb, yTop, zb)
  }
  if (gb.vertexCount) batch.add(lib.zone('trim'), gb.build())
}
