import * as THREE from 'three'
import { GeoBuilder, MeshBatch, V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import { framePoint, levelFloor, sectionBatch, stairFlight, subtractRect } from './levels'
import type { Block, Deck, HomePlan, Porch, Rect, Side, Stair, Terrace } from './types'
import type { Segment2 } from './walls'

const DARK = new THREE.MeshStandardMaterial({ color: '#1a1815', roughness: 1, name: 'underdeck' })
const SPA_WATER = new THREE.MeshPhysicalMaterial({ color: '#32676a', metalness: 0.24, roughness: 0.17, clearcoat: 1, name: 'spa-water' })

export interface OutdoorOutput {
  colliders: Segment2[]
  downlights: THREE.Vector3[]
  /** walkable surfaces: rect + height function */
  walkables: { rect: Rect; height: (x: number, z: number) => number; between?: Stair['between']; frame?: Block }[]
}

export function buildOutdoor(plan: HomePlan, lib: MaterialLibrary, batch: MeshBatch, roofBatch: MeshBatch, setFloor?: (floor?: number) => void): OutdoorOutput {
  const out: OutdoorOutput = { colliders: [], downlights: [], walkables: [] }
  const rand = rng(77)
  for (const d of plan.decks) {
    if (plan.levels) setFloor?.(d.height)
    deck(d, lib, batch, rand, out, !!plan.levels)
  }
  setFloor?.()
  for (const p of plan.porches) {
    const frame = plan.blocks.find(b => b.id === p.frame)
    if (plan.levels) setFloor?.(plan.floorY)
    const start = out.downlights.length
    porch(plan, p, lib, sectionBatch(batch, frame), sectionBatch(roofBatch, frame), out)
    for (const light of out.downlights.slice(start)) {
      const [x, z] = framePoint(frame, light.x, light.z)
      light.set(x, light.y, z)
    }
  }
  setFloor?.()
  for (const s of plan.stairs) stair(s, s.between ? levelFloor(plan, s.between.lower) : 0, lib, batch, rand, out)
  for (const t of plan.terraces) {
    const frame = plan.blocks.find(b => b.id === t.frame)
    if (plan.levels) setFloor?.(t.height)
    terrace(t, lib, sectionBatch(batch, frame), rand)
    out.walkables.push({ rect: t.rect, height: () => t.height ?? 0.045, frame })
  }
  return out
}

function deck(d: Deck, lib: MaterialLibrary, batch: MeshBatch, rand: () => number, out: OutdoorOutput, stacked: boolean) {
  const [x0, z0, x1, z1] = d.rect
  const h = d.height
  const boards = new GeoBuilder()
  const bw = 0.14
  const gap = 0.006
  const th = 0.028
  const mat = lib.zone(d.zone ?? 'deck')
  const board = (r: Rect) => {
    for (const [a, c, b, e] of d.spa ? subtractRect(r, d.spa) : [r]) boards.box(a, h - th, c, b, h, e)
  }
  if (d.boardsAlong === 'x') {
    for (let z = z0; z < z1 - 0.01; z += bw + gap) {
      boards.color = tone(rand)
      boards.uvOffset = [rand() * 9, rand() * 9]
      boards.uvRotate = true
      board([x0, z, x1, Math.min(z + bw, z1)])
    }
  } else {
    for (let x = x0; x < x1 - 0.01; x += bw + gap) {
      boards.color = tone(rand)
      boards.uvOffset = [rand() * 9, rand() * 9]
      board([x, z0, Math.min(x + bw, x1), z1])
    }
  }
  batch.add(mat, boards.build(true))
  // rim boards (fascia) and a dark recessed skirt underneath
  const rim = new GeoBuilder()
  rim.uvRotate = true
  const rh = d.supportY === undefined ? Math.min(0.28, h - 0.02) : 0.22
  rim.box(x0 - 0.03, h - rh, z1, x1 + 0.03, h - th, z1 + 0.03)
  rim.box(x0 - 0.03, h - rh, z0 - 0.03, x1 + 0.03, h - th, z0)
  rim.box(x0 - 0.03, h - rh, z0, x0, h - th, z1)
  rim.box(x1, h - rh, z0, x1 + 0.03, h - th, z1)
  batch.add(mat, rim.build(true))
  if (h > 0.3 && d.supportY === undefined) {
    const skirt = new GeoBuilder()
    skirt.box(x0 + 0.12, -0.05, z0 + 0.12, x1 - 0.12, h - rh, z1 - 0.12)
    batch.add(DARK, skirt.build())
  }
  out.walkables.push({ rect: d.rect, height: () => h })
  const steel = new GeoBuilder()
  if (d.supportY !== undefined) {
    const z = z0 + 0.32
    for (const x of [x0 + 0.32, (x0 + x1) / 2, x1 - 0.32])
      steel.box(x - 0.07, d.supportY, z - 0.07, x + 0.07, h - rh, z + 0.07)
    steel.box(x0 + 0.24, h - rh - 0.14, z - 0.09, x1 - 0.24, h - rh, z + 0.09)
  }
  for (const s of d.rails ?? []) rail(steel, d.rect, s, h, d.railHeight ?? 0.98, out, stacked)
  if (d.spa) {
    const [a, c, b, e] = d.spa
    const rim = new GeoBuilder()
    for (const r of subtractRect([a - 0.045, c - 0.045, b + 0.045, e + 0.045], [a + 0.1, c + 0.1, b - 0.1, e - 0.1])) {
      rim.box(r[0], h - 0.2, r[1], r[2], h + 0.08, r[3])
    }
    batch.add(lib.concrete, rim.build())
    const water = new GeoBuilder()
    water.quad(V3(a, h - 0.045, e), V3(b, h - 0.045, e), V3(b, h - 0.045, c), V3(a, h - 0.045, c))
    batch.add(SPA_WATER, water.build())
    const points = [[a, c], [b, c], [b, e], [a, e], [a, c]]
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]
      const [bx, bz] = points[i]
      out.colliders.push({ ax, az, bx, bz, bottom: h - 0.25, top: h + 0.8 })
    }
  }
  batch.add(lib.steel, steel.build())
}

function tone(rand: () => number): [number, number, number] {
  const t = 0.84 + rand() * 0.3
  const w = (rand() - 0.5) * 0.06
  return [t * (1 + w), t, t * (1 - w)]
}

/** Horizontal slat railing along a deck side. */
function rail(gb: GeoBuilder, rect: Rect, s: Side, h: number, height: number, out: OutdoorOutput, stacked: boolean) {
  const [x0, z0, x1, z1] = rect
  const inset = 0.04
  let a: THREE.Vector3
  let b: THREE.Vector3
  if (s === 's') { a = V3(x0 + inset, h, z1 - inset); b = V3(x1 - inset, h, z1 - inset) }
  else if (s === 'n') { a = V3(x0 + inset, h, z0 + inset); b = V3(x1 - inset, h, z0 + inset) }
  else if (s === 'e') { a = V3(x1 - inset, h, z0 + inset); b = V3(x1 - inset, h, z1 - inset) }
  else { a = V3(x0 + inset, h, z0 + inset); b = V3(x0 + inset, h, z1 - inset) }
  const len = a.distanceTo(b)
  const dir = new THREE.Vector3().subVectors(b, a).normalize()
  const posts = Math.max(2, Math.round(len / 1.6) + 1)
  for (let i = 0; i < posts; i++) {
    const p = a.clone().addScaledVector(dir, (i / (posts - 1)) * len)
    gb.beam(p, p.clone().setY(h + height), 0.055, 0.055)
  }
  gb.beam(a.clone().setY(h + height), b.clone().setY(h + height), 0.06, 0.035)
  for (let y = h + 0.12; y < h + height - 0.06; y += 0.095) gb.beam(a.clone().setY(y), b.clone().setY(y), 0.018, 0.045)
  out.colliders.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, bottom: stacked ? h - 0.25 : undefined, top: stacked ? h + height : undefined })
}

function porch(plan: HomePlan, p: Porch, lib: MaterialLibrary, batch: MeshBatch, roofBatch: MeshBatch, out: OutdoorOutput) {
  const [x0, z0, x1, z1] = p.rect
  const T = p.roofThickness ?? 0.22
  const rise = 0.12
  const H = (x: number, z: number) => {
    let t = 0
    switch (p.rises ?? 'n') {
      case 'n': t = (z1 - z) / (z1 - z0); break
      case 's': t = (z - z0) / (z1 - z0); break
      case 'e': t = (x - x0) / (x1 - x0); break
      case 'w': t = (x1 - x) / (x1 - x0); break
    }
    return p.height + rise * t
  }
  const top = new GeoBuilder()
  const fascia = new GeoBuilder()
  const soffit = new GeoBuilder()
  const P = (x: number, z: number, up: number) => V3(x, H(x, z) + up, z)
  const bt = [P(x0, z1, 0), P(x1, z1, 0), P(x1, z0, 0), P(x0, z0, 0)]
  const tp = [P(x0, z1, T), P(x1, z1, T), P(x1, z0, T), P(x0, z0, T)]
  top.quad(tp[0], tp[1], tp[2], tp[3])
  for (let i = 0; i < 4; i++) fascia.quad(bt[i], bt[(i + 1) % 4], tp[(i + 1) % 4], tp[i])
  soffit.quad(bt[3], bt[2], bt[1], bt[0])
  roofBatch.add(lib.zone('roof'), top.build())
  roofBatch.add(lib.zone('trim'), fascia.build())
  roofBatch.add(lib.soffit, soffit.build())
  // steel posts and a beam under the free edges
  const steel = new GeoBuilder()
  const floorUnder = (x: number, z: number) => {
    const d = plan.decks.find(dd => x >= dd.rect[0] && x <= dd.rect[2] && z >= dd.rect[1] && z <= dd.rect[3])
    return d ? d.height : 0
  }
  for (const [px, pz] of p.posts) {
    const y0 = floorUnder(px, pz)
    steel.box(px - 0.055, y0, pz - 0.055, px + 0.055, H(px, pz) - 0.18, pz + 0.055)
  }
  // beams between consecutive posts
  for (let i = 0; i < p.posts.length - 1; i++) {
    const [ax, az] = p.posts[i]
    const [bx, bz] = p.posts[i + 1]
    const ya = H(ax, az) - 0.18
    const yb = H(bx, bz) - 0.18
    steel.beam(V3(ax, (ya + H(ax, az)) / 2, az), V3(bx, (yb + H(bx, bz)) / 2, bz), 0.11, 0.18)
  }
  batch.add(lib.steel, steel.build())
  // recessed downlights in the soffit
  const nx = Math.max(1, Math.round((x1 - x0) / 2))
  const nz = Math.max(1, Math.round((z1 - z0) / 2.2))
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = x0 + ((i + 0.5) / nx) * (x1 - x0)
      const z = z0 + ((j + 0.5) / nz) * (z1 - z0)
      out.downlights.push(V3(x, H(x, z) - 0.005, z))
    }
}

function stair(s: Stair, base: number, lib: MaterialLibrary, batch: MeshBatch, rand: () => number, out: OutdoorOutput) {
  const n = s.steps
  const rh = s.rise / (n + 1)
  const { dx, dz, going: run, rect } = stairFlight(s)
  const [px, pz] = [-dz, dx] // perpendicular (left of descent direction)
  const [fx, fz] = s.from
  const treads = new GeoBuilder()
  const steel = new GeoBuilder()
  const pt = (along: number, across: number, y: number) => V3(fx + dx * along + px * across, base + y, fz + dz * along + pz * across)
  const half = s.width / 2
  for (let i = 1; i <= n; i++) {
    const y = base + s.rise - i * rh
    const a0 = (i - 1) * run
    const a1 = i * run + 0.02
    const corners = [pt(a0, -half, 0), pt(a1, -half, 0), pt(a1, half, 0), pt(a0, half, 0)]
    const xs = corners.map(c => c.x)
    const zs = corners.map(c => c.z)
    treads.color = tone(rand)
    treads.uvOffset = [rand() * 5, rand() * 5]
    treads.box(Math.min(...xs), y - (s.between ? rh + 0.015 : 0.035), Math.min(...zs), Math.max(...xs), y, Math.max(...zs))
  }
  batch.add(s.between ? lib.floor : lib.zone('deck'), treads.build(true))
  // stringers (steel plates) on both sides
  const totalRun = n * run + 0.02
  for (const side of [-1, 1]) {
    const c = side * (half + 0.01)
    const b0 = pt(0, c, s.rise - 0.04)
    const b1 = pt(totalRun, c, 0)
    steel.beam(b0.clone().setY(b0.y - 0.12), b1.clone().setY(base + 0.05), 0.014, 0.26)
  }
  // slat screen rails
  for (const side of s.rails ?? []) {
    const c = side === 'left' ? half + 0.04 : -(half + 0.04)
    const nose = (along: number) => s.rise - (along / totalRun) * s.rise
    // posts at top and bottom
    const top0 = pt(0.05, c, s.rise)
    const bot0 = pt(totalRun - 0.05, c, 0)
    steel.beam(top0, top0.clone().setY(base + s.rise + 0.98), 0.05, 0.05)
    steel.beam(bot0, bot0.clone().setY(base + nose(totalRun - 0.05) + 0.98), 0.05, 0.05)
    steel.beam(top0.clone().setY(base + s.rise + 0.98), bot0.clone().setY(base + nose(totalRun - 0.05) + 0.98), 0.05, 0.035)
    for (let y = 0.1; y < s.rise + 0.92; y += 0.095) {
      // along-range where nose + 0.06 <= y <= nose + 0.95 (nose falls linearly from rise to 0)
      const lo = Math.max(0.05, totalRun * (1 - (y - 0.06) / s.rise))
      const hi = Math.min(totalRun - 0.05, totalRun * (1 - (y - 0.95) / s.rise))
      if (hi - lo < 0.05) continue
      steel.beam(pt(lo, c, y), pt(hi, c, y), 0.016, 0.045)
    }
    const a = pt(0, c, 0)
    const b = pt(totalRun, c, 0)
    out.colliders.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, bottom: s.between ? base - 0.2 : undefined, top: s.between ? base + s.rise + 0.98 : undefined })
  }
  batch.add(lib.steel, steel.build())
  out.walkables.push({
    rect: !s.between ? [rect[0] - (dx < 0 ? 0.02 : 0), rect[1] - (dz < 0 ? 0.02 : 0), rect[2] + (dx > 0 ? 0.02 : 0), rect[3] + (dz > 0 ? 0.02 : 0)] : rect,
    between: s.between,
    height: (x, z) => {
      const along = (x - fx) * dx + (z - fz) * dz
      const i = Math.min(n, Math.max(0, Math.ceil(along / run)))
      return base + s.rise - i * rh
    },
  })
}

function terrace(t: Terrace, lib: MaterialLibrary, batch: MeshBatch, rand: () => number) {
  const [x0, z0, x1, z1] = t.rect
  const top = t.height ?? 0.045
  const gb = new GeoBuilder()
  const size = 0.6
  const joint = 0.012
  for (let x = x0; x < x1 - 0.05; x += size + joint)
    for (let z = z0; z < z1 - 0.05; z += size + joint) {
      const tn = 0.9 + rand() * 0.18
      gb.color = [tn, tn, tn * 0.98]
      gb.uvOffset = [rand() * 4, rand() * 4]
      gb.box(x, top - 0.045, z, Math.min(x + size, x1), top, Math.min(z + size, z1))
    }
  batch.add(lib.pavers, gb.build(true))
  // setting bed (dark joints) and, for raised terraces, a concrete retaining edge
  const base = new GeoBuilder()
  base.box(x0 - 0.02, top - 0.07, z0 - 0.02, x1 + 0.02, top - 0.03, z1 + 0.02, ['bottom'])
  batch.add(DARK, base.build())
  const support = t.supportY ?? (top > 0.2 ? -0.2 : undefined)
  if (support !== undefined) {
    const wall = new GeoBuilder()
    wall.box(x0 - 0.05, support, z0, x1 + 0.05, top - 0.045, z1 + 0.05, ['top'])
    batch.add(lib.foundation, wall.build())
  }
}
