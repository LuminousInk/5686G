import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { GeoBuilder, MeshBatch, V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'

/** Teak outdoor lounge: 3-seat sofa against the wall, armchair, slatted coffee table, side table. */
export function loungeSet(lib: MaterialLibrary, seed = 3): THREE.Group {
  const g = new THREE.Group()
  const teak = new GeoBuilder()
  const rand = rng(seed)
  const plank = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const t = 0.88 + rand() * 0.24
    teak.color = [t * 1.02, t, t * 0.97]
    teak.uvOffset = [rand() * 5, rand() * 5]
    teak.box(x0, y0, z0, x1, y1, z1)
  }
  const cushions: THREE.Mesh[] = []
  const cushion = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const geo = new RoundedBoxGeometry(w, h, d, 4, Math.min(0.045, h * 0.45))
    const m = new THREE.Mesh(geo, lib.cushion)
    m.position.set(x, y, z)
    m.rotation.x = rx
    m.castShadow = true
    m.receiveShadow = true
    cushions.push(m)
  }
  // sofa (centred at origin, back toward -z), 2.1 x 0.9
  const sw = 2.1
  const sd = 0.88
  const legH = 0.12
  // base frame
  plank(-sw / 2, legH, -sd / 2, sw / 2, legH + 0.09, sd / 2)
  // slatted arms
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -sw / 2 : sw / 2 - 0.08
    plank(x0, 0, -sd / 2, x0 + 0.08, 0.62, -sd / 2 + 0.06)
    plank(x0, 0, sd / 2 - 0.06, x0 + 0.08, 0.62, sd / 2)
    plank(x0, 0.56, -sd / 2, x0 + 0.08, 0.62, sd / 2)
    for (let k = 0; k < 4; k++) plank(x0 + 0.01, 0.22 + k * 0.09, -sd / 2 + 0.06, x0 + 0.07, 0.26 + k * 0.09, sd / 2 - 0.06)
  }
  // back slats
  plank(-sw / 2 + 0.08, legH, -sd / 2, sw / 2 - 0.08, 0.72, -sd / 2 + 0.05)
  cushion(sw - 0.2, 0.16, sd - 0.12, 0, legH + 0.17, 0.04)
  for (let i = 0; i < 3; i++) cushion((sw - 0.24) / 3 - 0.02, 0.44, 0.15, -sw / 2 + 0.12 + ((i + 0.5) * (sw - 0.24)) / 3, legH + 0.45, -sd / 2 + 0.13, -0.18)
  // throw pillows
  for (const x of [-0.7, 0.68]) cushion(0.42, 0.36, 0.1, x, legH + 0.42, -sd / 2 + 0.26, -0.3)

  // armchair (left of coffee table, facing +x)
  const ac = new THREE.Group()
  const teak2 = new GeoBuilder()
  const plank2 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const t = 0.88 + rand() * 0.24
    teak2.color = [t * 1.02, t, t * 0.97]
    teak2.uvOffset = [rand() * 5, rand() * 5]
    teak2.box(x0, y0, z0, x1, y1, z1)
  }
  const aw = 0.86
  plank2(-aw / 2, legH, -aw / 2, aw / 2, legH + 0.09, aw / 2)
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -aw / 2 : aw / 2 - 0.08
    plank2(x0, 0, -aw / 2, x0 + 0.08, 0.6, aw / 2)
  }
  plank2(-aw / 2 + 0.08, legH, -aw / 2, aw / 2 - 0.08, 0.7, -aw / 2 + 0.05)
  const ac1 = new THREE.Mesh(new RoundedBoxGeometry(aw - 0.2, 0.16, aw - 0.12, 4, 0.045), lib.cushion)
  ac1.position.set(0, legH + 0.17, 0.04)
  const ac2 = new THREE.Mesh(new RoundedBoxGeometry(aw - 0.22, 0.42, 0.15, 4, 0.045), lib.cushion)
  ac2.position.set(0, legH + 0.44, -aw / 2 + 0.13)
  ac2.rotation.x = -0.18
  for (const m of [ac1, ac2]) {
    m.castShadow = m.receiveShadow = true
    ac.add(m)
  }
  const acTeak = new THREE.Mesh(teak2.build(true), lib.teak)
  acTeak.castShadow = acTeak.receiveShadow = true
  ac.add(acTeak)
  ac.position.set(-1.75, 0, 1.05)
  ac.rotation.y = Math.PI / 2 - 0.35
  g.add(ac)

  // slatted coffee table in front of the sofa
  const tbl = new GeoBuilder()
  const tw = 1.15
  const td = 0.62
  const ty = 0.36
  for (let i = 0; i < 9; i++) {
    const z0 = -td / 2 + (i * td) / 9
    const t = 0.88 + rand() * 0.24
    tbl.color = [t, t, t]
    tbl.uvOffset = [rand() * 4, 0]
    tbl.box(-tw / 2, ty - 0.03, z0 + 0.004, tw / 2, ty, z0 + td / 9 - 0.004)
  }
  for (const [x, z] of [
    [-tw / 2 + 0.03, -td / 2 + 0.03],
    [tw / 2 - 0.07, -td / 2 + 0.03],
    [-tw / 2 + 0.03, td / 2 - 0.07],
    [tw / 2 - 0.07, td / 2 - 0.07],
  ])
    tbl.box(x, 0, z, x + 0.04, ty - 0.03, z + 0.04)
  tbl.box(-tw / 2 + 0.05, 0.08, -td / 2 + 0.05, tw / 2 - 0.05, 0.1, td / 2 - 0.05)
  const table = new THREE.Mesh(tbl.build(true), lib.teak)
  table.position.set(0, 0, 1.25)
  table.castShadow = table.receiveShadow = true
  g.add(table)
  // tray with a bowl on the table
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.07, 32, 1, true), lib.steel)
  bowl.position.set(0.15, ty + 0.035, 1.22)
  bowl.castShadow = true
  g.add(bowl)

  const sofa = new THREE.Mesh(teak.build(true), lib.teak)
  sofa.castShadow = sofa.receiveShadow = true
  g.add(sofa)
  for (const c of cushions) g.add(c)
  g.name = 'lounge'
  return g
}

/** Outdoor dining table with six chairs (teak), centred at the origin, long side along x. */
export function diningSet(lib: MaterialLibrary, seed = 9): THREE.Group {
  const gb = new GeoBuilder()
  const rand = rng(seed)
  const p = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const t = 0.86 + rand() * 0.26
    gb.color = [t, t, t]
    gb.uvOffset = [rand() * 5, rand() * 5]
    gb.box(x0, y0, z0, x1, y1, z1)
  }
  const L = 2.0
  const D = 0.95
  const H = 0.75
  for (let i = 0; i < 8; i++) {
    const z0 = -D / 2 + (i * D) / 8
    p(-L / 2, H - 0.035, z0 + 0.004, L / 2, H, z0 + D / 8 - 0.004)
  }
  for (const [x, z] of [
    [-L / 2 + 0.08, -D / 2 + 0.08],
    [L / 2 - 0.14, -D / 2 + 0.08],
    [-L / 2 + 0.08, D / 2 - 0.14],
    [L / 2 - 0.14, D / 2 - 0.14],
  ])
    p(x, 0, z, x + 0.06, H - 0.035, z + 0.06)
  p(-L / 2 + 0.1, H - 0.12, -D / 2 + 0.1, L / 2 - 0.1, H - 0.06, -D / 2 + 0.14)
  p(-L / 2 + 0.1, H - 0.12, D / 2 - 0.14, L / 2 - 0.1, H - 0.06, D / 2 - 0.1)
  const chair = (cx: number, cz: number, face: number) => {
    const c = new GeoBuilder()
    const w = 0.48
    c.box(-w / 2, 0.44, -w / 2, w / 2, 0.47, w / 2)
    for (const [x, z] of [
      [-w / 2, -w / 2],
      [w / 2 - 0.04, -w / 2],
      [-w / 2, w / 2 - 0.04],
      [w / 2 - 0.04, w / 2 - 0.04],
    ])
      c.box(x, 0, z, x + 0.04, 0.44, z + 0.04)
    c.box(-w / 2, 0.47, -w / 2, -w / 2 + 0.04, 0.88, -w / 2 + 0.04)
    c.box(w / 2 - 0.04, 0.47, -w / 2, w / 2, 0.88, -w / 2 + 0.04)
    for (let k = 0; k < 3; k++) c.box(-w / 2 + 0.04, 0.6 + k * 0.1, -w / 2, w / 2 - 0.04, 0.66 + k * 0.1, -w / 2 + 0.03)
    const g = c.build(true)
    const m = new THREE.Matrix4().makeRotationY(face).setPosition(cx, 0, cz)
    g.applyMatrix4(m)
    return g
  }
  const batch = new MeshBatch()
  batch.add(lib.teak, gb.build(true))
  for (const x of [-0.6, 0, 0.6]) {
    batch.add(lib.teak, chair(x, -0.75, 0))
    batch.add(lib.teak, chair(x, 0.75, Math.PI))
  }
  const g = batch.toGroup('dining-set')
  // a few things on the table
  const vase = new THREE.Mesh(new THREE.LatheGeometry(vaseProfile(0.07, 0.24), 32), lib.ceramic)
  vase.position.set(0.1, H, 0)
  vase.castShadow = true
  g.add(vase)
  return g
}

function vaseProfile(r: number, h: number) {
  const pts: THREE.Vector2[] = []
  const n = 16
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const y = t * h
    const rr = r * (0.55 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.8) * (t > 0.9 ? 0.85 : 1)
    pts.push(new THREE.Vector2(rr, y))
  }
  pts.unshift(new THREE.Vector2(0, 0))
  return pts
}

/** Ceramic planters: tall urn, wide bowl or low cylinder. Returns the mesh and the soil height. */
export function planter(lib: MaterialLibrary, kind: 'tall' | 'bowl' | 'low'): { group: THREE.Group; soil: number; radius: number } {
  const pts: THREE.Vector2[] = []
  let soil = 0.5
  let radius = 0.25
  if (kind === 'tall') {
    // tapered urn ~0.95 m
    const H = 0.95
    pts.push(new THREE.Vector2(0, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0.18, 0.04))
    for (let i = 1; i <= 12; i++) {
      const t = i / 12
      pts.push(new THREE.Vector2(0.18 + 0.12 * Math.sin(Math.PI * 0.5 * t) - 0.02 * t * t, 0.04 + t * (H - 0.08)))
    }
    pts.push(new THREE.Vector2(0.27, H), new THREE.Vector2(0.25, H), new THREE.Vector2(0.24, H - 0.05))
    soil = H - 0.06
    radius = 0.24
  } else if (kind === 'bowl') {
    const H = 0.45
    pts.push(new THREE.Vector2(0, 0), new THREE.Vector2(0.14, 0))
    for (let i = 1; i <= 10; i++) {
      const t = i / 10
      pts.push(new THREE.Vector2(0.14 + 0.22 * Math.sin((Math.PI / 2) * t), t * H))
    }
    pts.push(new THREE.Vector2(0.34, H), new THREE.Vector2(0.32, H - 0.04))
    soil = H - 0.05
    radius = 0.31
  } else {
    const H = 0.38
    pts.push(new THREE.Vector2(0, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.32, 0.02), new THREE.Vector2(0.32, H), new THREE.Vector2(0.29, H), new THREE.Vector2(0.29, H - 0.04))
    soil = H - 0.04
    radius = 0.29
  }
  const g = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), lib.ceramic)
  pot.castShadow = pot.receiveShadow = true
  g.add(pot)
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), lib.soil)
  dirt.rotation.x = -Math.PI / 2
  dirt.position.y = soil
  dirt.receiveShadow = true
  g.add(dirt)
  return { group: g, soil, radius }
}

/** Board fence (dark stained) along a polyline. */
export function fence(lib: MaterialLibrary, pts: [number, number][], heightAt: (x: number, z: number) => number): THREE.Mesh {
  const gb = new GeoBuilder()
  const rand = rng(21)
  const H = 1.85
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const dx = (bx - ax) / len
    const dz = (bz - az) / len
    const bw = 0.14
    for (let u = 0; u < len; u += bw + 0.012) {
      const x = ax + dx * u
      const z = az + dz * u
      const y = heightAt(x, z)
      const t = 0.85 + rand() * 0.3
      gb.color = [t, t, t]
      gb.uvOffset = [rand() * 5, rand() * 5]
      const c = V3(x + dx * bw * 0.5, y - 0.1 + (H + 0.1) / 2, z + dz * bw * 0.5)
      gb.orientedBox(c, bw / 2, (H + 0.1) / 2, 0.012, -Math.atan2(dz, dx))
    }
    // rails
    for (const ry of [0.35, H - 0.3]) {
      const y0 = heightAt(ax, az) + ry
      const y1 = heightAt(bx, bz) + ry
      gb.beam(V3(ax - dz * 0.05, y0, az + dx * 0.05), V3(bx - dz * 0.05, y1, bz + dx * 0.05), 0.04, 0.09)
    }
  }
  const m = new THREE.Mesh(gb.build(true), lib.fence)
  m.castShadow = true
  m.receiveShadow = true
  m.name = 'fence'
  return m
}
