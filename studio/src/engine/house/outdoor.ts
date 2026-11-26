import * as THREE from 'three'
import { GeoBuilder, MeshBatch, V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import type { Deck, HomePlan, Porch, Side, Stair, Terrace } from './types'
import type { Segment2 } from './walls'

const DARK = new THREE.MeshStandardMaterial({ color: '#1a1815', roughness: 1, name: 'underdeck' })

export interface OutdoorOutput {
  colliders: Segment2[]
  downlights: THREE.Vector3[]
  /** walkable surfaces: rect + height function */
  walkables: { rect: [number, number, number, number]; height: (x: number, z: number) => number }[]
}

export function buildOutdoor(plan: HomePlan, lib: MaterialLibrary, batch: MeshBatch, roofBatch: MeshBatch): OutdoorOutput {
  const out: OutdoorOutput = { colliders: [], downlights: [], walkables: [] }
  const rand = rng(77)
  for (const d of plan.decks) deck(d, lib, batch, rand, out)
  for (const p of plan.porches) porch(plan, p, lib, batch, roofBatch, out)
  for (const s of plan.stairs) stair(s, lib, batch, rand, out)
  for (const t of plan.terraces) terrace(t, lib, batch, rand, out)
  return out
}

function deck(d: Deck, lib: MaterialLibrary, batch: MeshBatch, rand: () => number, out: OutdoorOutput) {
  const [x0, z0, x1, z1] = d.rect
  const h = d.height
  const boards = new GeoBuilder()
  const bw = 0.14
  const gap = 0.006
  const th = 0.028
  const mat = lib.zone(d.zone ?? 'deck')
  if (d.boardsAlong === 'x') {
    for (let z = z0; z < z1 - 0.01; z += bw + gap) {
      boards.color = tone(rand)
      boards.uvOffset = [rand() * 9, rand() * 9]
      boards.uvRotate = true
      boards.box(x0, h - th, z, x1, h, Math.min(z + bw, z1))
    }
  } else {
    for (let x = x0; x < x1 - 0.01; x += bw + gap) {
      boards.color = tone(rand)
      boards.uvOffset = [rand() * 9, rand() * 9]
      boards.box(x, h - th, z0, Math.min(x + bw, x1), h, z1)
    }
  }
  batch.add(mat, boards.build(true))
  // rim boards (fascia) and a dark recessed skirt underneath
  const rim = new GeoBuilder()
  rim.uvRotate = true
  const rh = Math.min(0.28, h - 0.02)
  rim.box(x0 - 0.03, h - rh, z1, x1 + 0.03, h - th, z1 + 0.03)
  rim.box(x0 - 0.03, h - rh, z0 - 0.03, x1 + 0.03, h - th, z0)
  rim.box(x0 - 0.03, h - rh, z0, x0, h - th, z1)
  rim.box(x1, h - rh, z0, x1 + 0.03, h - th, z1)
  batch.add(mat, rim.build(true))
  if (h > 0.3) {
    const skirt = new GeoBuilder()
    skirt.box(x0 + 0.12, -0.05, z0 + 0.12, x1 - 0.12, h - rh, z1 - 0.12)
    batch.add(DARK, skirt.build())
  }
  out.walkables.push({ rect: d.rect, height: () => h })
  const steel = new GeoBuilder()
  for (const s of d.rails ?? []) rail(steel, d.rect, s, h, out)
  batch.add(lib.steel, steel.build())
}

function tone(rand: () => number): [number, number, number] {
  const t = 0.84 + rand() * 0.3
  const w = (rand() - 0.5) * 0.06
  return [t * (1 + w), t, t * (1 - w)]
}

/** Horizontal slat railing along a deck side. */
function rail(gb: GeoBuilder, rect: [number, number, number, number], s: Side, h: number, out: OutdoorOutput) {
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
    gb.beam(p, p.clone().setY(h + 0.98), 0.055, 0.055)
  }
  gb.beam(a.clone().setY(h + 0.98), b.clone().setY(h + 0.98), 0.06, 0.035)
  for (let y = h + 0.12; y < h + 0.92; y += 0.095) gb.beam(a.clone().setY(y), b.clone().setY(y), 0.018, 0.045)
  out.colliders.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z })
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

function stair(s: Stair, lib: MaterialLibrary, batch: MeshBatch, rand: () => number, out: OutdoorOutput) {
  const n = s.steps
  const rh = s.rise / (n + 1)
  const run = 0.3
  const dirs: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }
  const [dx, dz] = dirs[s.dir]
  const [px, pz] = [-dz, dx] // perpendicular (left of descent direction)
  const [fx, fz] = s.from
  const treads = new GeoBuilder()
  const steel = new GeoBuilder()
  const pt = (along: number, across: number, y: number) => V3(fx + dx * along + px * across, y, fz + dz * along + pz * across)
  const half = s.width / 2
  for (let i = 1; i <= n; i++) {
    const y = s.rise - i * rh
    const a0 = (i - 1) * run
    const a1 = i * run + 0.02
    const corners = [pt(a0, -half, 0), pt(a1, -half, 0), pt(a1, half, 0), pt(a0, half, 0)]
    const xs = corners.map(c => c.x)
    const zs = corners.map(c => c.z)
    treads.color = tone(rand)
    treads.uvOffset = [rand() * 5, rand() * 5]
    treads.box(Math.min(...xs), y - 0.035, Math.min(...zs), Math.max(...xs), y, Math.max(...zs))
  }
  batch.add(lib.zone('deck'), treads.build(true))
  // stringers (steel plates) on both sides
  const totalRun = n * run + 0.02
  for (const side of [-1, 1]) {
    const c = side * (half + 0.01)
    const b0 = pt(0, c, s.rise - 0.04)
    const b1 = pt(totalRun, c, 0)
    steel.beam(b0.clone().setY(b0.y - 0.12), b1.clone().setY(0.05), 0.014, 0.26)
  }
  // slat screen rails
  for (const side of s.rails ?? []) {
    const c = side === 'left' ? half + 0.04 : -(half + 0.04)
    const nose = (along: number) => s.rise - (along / totalRun) * s.rise
    // posts at top and bottom
    const top0 = pt(0.05, c, s.rise)
    const bot0 = pt(totalRun - 0.05, c, 0)
    steel.beam(top0, top0.clone().setY(s.rise + 0.98), 0.05, 0.05)
    steel.beam(bot0, bot0.clone().setY(nose(totalRun - 0.05) + 0.98), 0.05, 0.05)
    steel.beam(top0.clone().setY(s.rise + 0.98), bot0.clone().setY(nose(totalRun - 0.05) + 0.98), 0.05, 0.035)
    for (let y = 0.1; y < s.rise + 0.92; y += 0.095) {
      // along-range where nose + 0.06 <= y <= nose + 0.95 (nose falls linearly from rise to 0)
      const lo = Math.max(0.05, totalRun * (1 - (y - 0.06) / s.rise))
      const hi = Math.min(totalRun - 0.05, totalRun * (1 - (y - 0.95) / s.rise))
      if (hi - lo < 0.05) continue
      steel.beam(pt(lo, c, y), pt(hi, c, y), 0.016, 0.045)
    }
    const a = pt(0, c, 0)
    const b = pt(totalRun, c, 0)
    out.colliders.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z })
  }
  batch.add(lib.steel, steel.build())
  const corners = [pt(0, -half, 0), pt(totalRun, half, 0)]
  const rect: [number, number, number, number] = [
    Math.min(corners[0].x, corners[1].x),
    Math.min(corners[0].z, corners[1].z),
    Math.max(corners[0].x, corners[1].x),
    Math.max(corners[0].z, corners[1].z),
  ]
  out.walkables.push({
    rect,
    height: (x, z) => {
      const along = (x - fx) * dx + (z - fz) * dz
      const i = Math.min(n, Math.max(0, Math.ceil(along / run)))
      return s.rise - i * rh
    },
  })
}

function terrace(t: Terrace, lib: MaterialLibrary, batch: MeshBatch, rand: () => number, out: OutdoorOutput) {
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
  if (top > 0.2) {
    const wall = new GeoBuilder()
    wall.box(x0 - 0.05, -0.2, z0, x1 + 0.05, top - 0.045, z1 + 0.05, ['top'])
    batch.add(lib.foundation, wall.build())
  }
  out.walkables.push({ rect: t.rect, height: () => top })
}
