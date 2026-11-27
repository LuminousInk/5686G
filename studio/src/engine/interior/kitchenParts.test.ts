import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { MaterialLibrary } from '../materials/library'
import {
  COUNTER_TOP, HOB, ISLAND_TOP, OVEN_H, OVEN_Y0, REVEAL, SHELF_LED, SHELF_T, TALL_D, TALL_H, TALL_W, TOE_H,
  baseCabinets, baseFronts, fridgeColumn, fridgeFronts, fridgeSurround, inductionHob, islandFronts, kitchenIsland, openShelf, ovenTower,
  ovenTowerFronts, rangeHood, type Front,
} from './kitchenParts'

/** Fake library: plain materials, and lamp() records what it was asked for so the LED spec can be checked. */
const makeLib = () => {
  const lamps = new Map<string, THREE.MeshStandardMaterial>()
  return {
    cabinet: new THREE.MeshStandardMaterial({ name: 'cabinet' }),
    counter: new THREE.MeshStandardMaterial({ name: 'counter' }),
    blackMetal: new THREE.MeshStandardMaterial({ name: 'blackMetal' }),
    fixtureMetal: new THREE.MeshStandardMaterial({ name: 'fixtureMetal' }),
    diffuser: new THREE.MeshStandardMaterial({ name: 'diffuser' }),
    lamp: (key: string, color: string, intensity: number) => {
      let m = lamps.get(key)
      if (!m) lamps.set(key, (m = new THREE.MeshStandardMaterial({ name: `lamp:${key}`, emissive: new THREE.Color(color), emissiveIntensity: intensity })))
      return m
    },
  } as unknown as MaterialLibrary
}

const bbox = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o)
const size = (o: THREE.Object3D) => bbox(o).getSize(new THREE.Vector3())

function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  g.traverse(o => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh)
  })
  return out
}

function meshOf(g: THREE.Object3D, mat: THREE.Material | string): THREE.Mesh {
  const m = meshes(g).find(x => (typeof mat === 'string' ? (x.material as THREE.Material).name === mat : x.material === mat))
  if (!m) throw new Error(`no mesh with material ${typeof mat === 'string' ? mat : mat.name}`)
  return m
}

/** Bounds of the vertices of `m` (piece-local, the pieces are not transformed) that pass `keep`. */
function extent(m: THREE.Mesh, keep: (v: THREE.Vector3) => boolean = () => true): THREE.Box3 {
  const pos = m.geometry.getAttribute('position')
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    if (keep(v)) box.expandByPoint(v)
  }
  return box
}

function triangles(g: THREE.Object3D): number {
  return meshes(g).reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0)
}

/** Fronts grouped into columns (same x), each sorted bottom to top, columns left to right. */
function columns(fronts: Front[]): Front[][] {
  const cols: Front[][] = []
  for (const f of [...fronts].sort((a, b) => a.x - b.x || a.y0 - b.y0)) {
    const col = cols.find(c => Math.abs(c[0].x - f.x) < 1e-6)
    if (col) col.push(f)
    else cols.push([f])
  }
  return cols
}

function expectPullOnFront(f: Front) {
  expect(f.pull, `${f.kind} at x=${f.x.toFixed(2)} has a pull`).toBeDefined()
  const p = f.pull!
  expect(p.length).toBeGreaterThanOrEqual(0.16)
  expect(p.length).toBeLessThanOrEqual(0.32)
  expect(p.horizontal).toBe(f.kind === 'drawer')
  // the whole bar stays on its front
  const halfW = p.horizontal ? p.length / 2 : 0.006
  const halfH = p.horizontal ? 0.006 : p.length / 2
  expect(p.x - halfW).toBeGreaterThan(f.x - f.w / 2)
  expect(p.x + halfW).toBeLessThan(f.x + f.w / 2)
  expect(p.y - halfH).toBeGreaterThan(f.y0)
  expect(p.y + halfH).toBeLessThan(f.y0 + f.h)
}

type Range = [number, number]
const pieces: [string, () => THREE.Group, [Range, Range, Range]][] = [
  // depth: carcass + fronts, then the counter's 20 mm overhang, then the pulls (36 mm off the fronts)
  ['baseCabinets', () => baseCabinets(makeLib(), 2.4), [[2.39, 2.41], [1.49, 1.51], [0.64, 0.67]]],
  ['openShelf', () => openShelf(makeLib(), 1.15), [[1.14, 1.16], [0.03, 0.04], [0.27, 0.29]]],
  ['fridgeSurround', () => fridgeSurround(makeLib(), 2.3), [[0.90, 0.92], [2.29, 2.31], [0.77, 0.79]]],
  ['fridgeColumn', () => fridgeColumn(makeLib()), [[0.59, 0.61], [2.29, 2.31], [0.66, 0.71]]],
  ['ovenTower', () => ovenTower(makeLib()), [[0.59, 0.61], [2.29, 2.31], [0.66, 0.71]]],
  ['inductionHob', () => inductionHob(), [[0.575, 0.585], [0.005, 0.009], [0.495, 0.505]]],
  ['rangeHood', () => rangeHood(makeLib()), [[0.89, 0.91], [0.77, 0.79], [0.53, 0.55]]],
  // the pulls may stand a few mm past the counter edge on the run side
  ['kitchenIsland', () => kitchenIsland(makeLib(), 2.4), [[2.39, 2.41], [0.93, 0.95], [0.99, 1.03]]],
]

describe('procedural kitchen parts', () => {
  for (const [name, build, [sx, sy, sz]] of pieces) {
    it(`${name}: expected size, sits on its origin, one shadowed mesh per material`, () => {
      const g = build()
      const s = size(g)
      for (const [v, [lo, hi], axis] of [[s.x, sx, 'x'], [s.y, sy, 'y'], [s.z, sz, 'z']] as const) {
        expect(v, `${name} ${axis}`).toBeGreaterThanOrEqual(lo)
        expect(v, `${name} ${axis}`).toBeLessThanOrEqual(hi)
      }
      expect(Math.abs(bbox(g).min.y)).toBeLessThan(0.001)

      const ms = meshes(g)
      expect(ms.length).toBeGreaterThan(0)
      for (const m of ms) {
        expect(m.castShadow).toBe(true)
        expect(m.receiveShadow).toBe(true)
      }
      expect(new Set(ms.map(m => m.material)).size).toBe(ms.length)
    })
  }

  it('keeps the whole kitchen at a modest triangle count', () => {
    const lib = makeLib()
    const parts = [
      baseCabinets(lib, 3.6), fridgeColumn(lib), ovenTower(lib), inductionHob(), rangeHood(lib, 0.9, 1.1),
      openShelf(lib, 1.15), openShelf(lib, 1.15), kitchenIsland(lib, 2.6),
    ]
    expect(parts.reduce((n, g) => n + triangles(g), 0)).toBeLessThan(15000)
  })
})

describe('base cabinets', () => {
  const widths = [1.2, 1.8, 2.4, 3.0, 3.6, 4.0, 4.6]

  it('splits the run into ~0.6 m modules: 3-drawer stacks (one under the hob) and doors', () => {
    for (const w of widths) {
      const cols = columns(baseFronts(w))
      const stacks = cols.filter(c => c[0].kind === 'drawer')
      for (const c of cols) {
        expect(c[0].w).toBeGreaterThan(0.5)
        expect(c[0].w).toBeLessThan(0.7)
        if (c[0].kind === 'drawer') expect(c.map(f => f.kind)).toEqual(['drawer', 'drawer', 'drawer'])
        else expect(c).toHaveLength(1)
      }
      expect(stacks.length, `stacks on ${w} m`).toBeGreaterThanOrEqual(Math.max(1, Math.floor(w / 1.8)))
      // the hob (centred on the run) sits over drawers, not over a door
      for (const x of [-0.2, -0.1, 0.1, 0.2]) {
        const under = cols.find(c => Math.abs(c[0].x - x) <= c[0].w / 2)
        expect(under?.[0].kind, `front under the hob at x=${x} on ${w} m`).toBe('drawer')
      }
    }
  })

  it('separates every front by a 3 mm reveal and fills the run between toe kick and counter', () => {
    for (const w of widths) {
      const cols = columns(baseFronts(w))
      expect(cols[0][0].x - cols[0][0].w / 2).toBeCloseTo(-w / 2 + REVEAL / 2, 6)
      const last = cols[cols.length - 1][0]
      expect(last.x + last.w / 2).toBeCloseTo(w / 2 - REVEAL / 2, 6)
      for (let i = 1; i < cols.length; i++) {
        const a = cols[i - 1][0]
        const b = cols[i][0]
        expect(b.x - b.w / 2 - (a.x + a.w / 2)).toBeCloseTo(REVEAL, 6)
      }
      for (const c of cols) {
        expect(c[0].y0).toBeCloseTo(TOE_H + REVEAL, 6)
        const top = c[c.length - 1]
        expect(top.y0 + top.h).toBeCloseTo(COUNTER_TOP - 0.04 - REVEAL, 6)
        for (let i = 1; i < c.length; i++) expect(c[i].y0 - (c[i - 1].y0 + c[i - 1].h)).toBeCloseTo(REVEAL, 6)
      }
    }
  })

  it('puts a slim bar pull on every front, horizontal on drawers, and paired doors pull from their shared edge', () => {
    for (const w of widths) for (const f of baseFronts(w)) expectPullOnFront(f)
    // 3.6 m: door door | drawers drawers | door door
    const doors = baseFronts(3.6).filter(f => f.kind === 'door')
    expect(doors).toHaveLength(4)
    for (const d of doors) {
      expect(Math.abs(Math.abs(d.pull!.x - d.x) - (d.w / 2 - 0.045))).toBeLessThan(1e-6)
      const partner = doors.find(o => o !== d && Math.abs(o.pull!.x - d.pull!.x) < 0.1)
      expect(partner, `door at x=${d.x.toFixed(2)} has a partner pull beside its own`).toBeDefined()
    }
  })

  it('builds a recessed toe kick, dark reveals behind the fronts, a 40 mm top with overhang and an upstand', () => {
    const lib = makeLib()
    const w = 2.4
    const d = 0.62
    const g = baseCabinets(lib, w, d)
    const black = meshOf(g, lib.blackMetal)
    const toe = extent(black, v => v.y < TOE_H - 1e-4)
    expect(toe.min.y).toBeCloseTo(0, 4)
    expect(toe.max.z).toBeLessThanOrEqual(d / 2 - 0.05)
    // the black backer sits directly behind the 22 mm fronts across the whole run
    const backer = extent(black, v => v.y > TOE_H + 0.01 && v.z < d / 2 - 0.02 && v.z > d / 2 - 0.03)
    expect(backer.max.x - backer.min.x).toBeGreaterThan(w - 0.02)
    // pulls stand proud of the fronts and past the counter edge, but only by a few centimetres
    const pullFront = extent(black).max.z
    expect(pullFront).toBeGreaterThan(d / 2 + 0.02)
    expect(pullFront).toBeLessThan(d / 2 + 0.05)
    const fronts = extent(meshOf(g, lib.cabinet))
    expect(fronts.max.z).toBeCloseTo(d / 2, 3)
    const top = extent(meshOf(g, lib.counter), v => v.y < COUNTER_TOP + 1e-4)
    expect(top.min.y).toBeCloseTo(COUNTER_TOP - 0.04, 3)
    expect(top.max.y).toBeCloseTo(COUNTER_TOP, 3)
    expect(top.max.z - d / 2).toBeCloseTo(0.02, 3)
    const upstand = extent(meshOf(g, lib.counter), v => v.y > COUNTER_TOP + 1e-4)
    expect(upstand.max.z).toBeLessThan(-d / 2 + 0.02)
    expect(upstand.max.y).toBeCloseTo(1.5, 2)
  })
})

describe('open shelves', () => {
  it('is a 30 mm oak slab on a hidden bracket with a warm 6 W LED strip under the front edge', () => {
    const lib = makeLib()
    const w = 1.15
    const shelf = openShelf(lib, w)
    const slab = extent(meshOf(shelf, lib.cabinet))
    expect(slab.max.y - slab.min.y).toBeCloseTo(SHELF_T, 3)
    expect(slab.min.y).toBeCloseTo(SHELF_LED, 4)
    // nothing but the slab and the LED: no visible bracket
    expect(meshes(shelf)).toHaveLength(2)

    const led = meshOf(shelf, 'lamp:strip')
    const mat = led.material as THREE.MeshStandardMaterial
    expect(mat).toBe(lib.lamp('strip', '#000000', 0))
    expect(mat.emissive.getHexString()).toBe('ffd9a8')
    expect(mat.emissiveIntensity).toBe(6)
    const strip = extent(led)
    expect(strip.max.y).toBeLessThanOrEqual(slab.min.y + 1e-6)
    expect(strip.max.y - strip.min.y).toBeLessThan(0.01)
    expect(strip.max.x - strip.min.x).toBeGreaterThan(w - 0.1)
    // tucked back from the front edge so it reads as a glow rather than a fitting
    expect(strip.max.z).toBeLessThan(slab.max.z - 0.01)
    expect(strip.min.z).toBeGreaterThan(0)
  })
})

describe('tall column', () => {
  it('fridge: a tall flush door over a freezer drawer, 0.6 m wide with a 3 mm reveal between', () => {
    const [freezer, door] = fridgeFronts()
    expect(freezer.kind).toBe('drawer')
    expect(door.kind).toBe('door')
    for (const f of [freezer, door]) {
      expect(f.w).toBeCloseTo(TALL_W - REVEAL, 6)
      expect(f.x).toBe(0)
      expectPullOnFront(f)
    }
    expect(door.y0 - (freezer.y0 + freezer.h)).toBeCloseTo(REVEAL, 6)
    expect(door.h).toBeGreaterThan(1.4)
    expect(door.y0 + door.h).toBeCloseTo(TALL_H - REVEAL, 6)
    // the door pull sits at hand height, on the edge that opens towards the rest of the run
    expect(door.pull!.y).toBeGreaterThan(0.8)
    expect(door.pull!.y).toBeLessThan(1.3)
    expect(door.pull!.x).toBeLessThan(0)
    expect(fridgeFronts(1)[1].pull!.x).toBeGreaterThan(0)

    const lib = makeLib()
    const g = fridgeColumn(lib)
    // both fronts flush in one plane
    expect(extent(meshOf(g, lib.cabinet)).max.z).toBeCloseTo(TALL_D / 2, 3)
  })

  it('oven tower: dark glass oven window and a thin stainless control strip, push-to-open door above', () => {
    const lib = makeLib()
    const g = ovenTower(lib)
    const glassMesh = meshOf(g, 'kitchen-dark-glass')
    const glass = glassMesh.material as THREE.MeshPhysicalMaterial
    expect(Math.max(glass.color.r, glass.color.g, glass.color.b)).toBeLessThan(0.01)
    expect(glass.roughness).toBeLessThan(0.25)
    expect(glass.specularIntensity).toBeLessThan(0.25)

    const window = extent(glassMesh, v => v.y < OVEN_Y0 + 0.45)
    expect(window.min.y).toBeGreaterThan(OVEN_Y0)
    expect(window.max.x - window.min.x).toBeGreaterThan(0.4)
    expect(window.max.y - window.min.y).toBeGreaterThan(0.25)
    // the oven at a comfortable height, between the drawer and the upper door
    expect(OVEN_Y0).toBeGreaterThan(0.5)
    expect(OVEN_Y0 + OVEN_H).toBeLessThan(1.25)
    const steel = extent(meshOf(g, lib.fixtureMetal), v => v.y > OVEN_Y0 + 0.5)
    expect(steel.min.y).toBeGreaterThan(window.max.y)
    expect(steel.max.y).toBeLessThanOrEqual(OVEN_Y0 + OVEN_H)
    expect(steel.max.y - steel.min.y).toBeLessThan(0.08)
    expect(steel.max.x - steel.min.x).toBeGreaterThan(0.5)

    const [drawer, upper] = ovenTowerFronts()
    expectPullOnFront(drawer)
    expect(upper.kind).toBe('door')
    expect(upper.pull).toBeUndefined()
    expect(upper.y0 - (OVEN_Y0 + OVEN_H)).toBeCloseTo(REVEAL, 6)
    expect(OVEN_Y0 - (drawer.y0 + drawer.h)).toBeCloseTo(REVEAL, 6)
  })
})

describe('cooking', () => {
  it('hob is a 580 x 500 x 6 mm sheet of the same dark glass as the oven', () => {
    const hob = inductionHob()
    const glassMesh = meshOf(hob, 'kitchen-dark-glass')
    expect(glassMesh.material).toBe(meshOf(ovenTower(makeLib()), 'kitchen-dark-glass').material)
    const glass = extent(glassMesh)
    expect(glass.max.x - glass.min.x).toBeCloseTo(HOB.w, 3)
    expect(glass.max.z - glass.min.z).toBeCloseTo(HOB.d, 3)
    expect(glass.max.y - glass.min.y).toBeCloseTo(0.006, 4)
  })

  it('hood is a slim 0.9 m stainless canopy whose chimney reaches the requested height against the wall', () => {
    const lib = makeLib()
    const hood = rangeHood(lib, 0.9, 1.1)
    expect(size(hood).y).toBeCloseTo(1.1, 3)
    const steel = meshOf(hood, lib.fixtureMetal)
    const all = extent(steel)
    expect(all.max.x - all.min.x).toBeCloseTo(0.9, 3)
    const canopy = extent(steel, v => Math.abs(v.x) > 0.2)
    expect(canopy.max.y - canopy.min.y).toBeLessThan(0.07)
    const chimney = extent(steel, v => v.y > 0.1)
    expect(chimney.min.z).toBeCloseTo(all.min.z, 4)
    expect(chimney.max.x - chimney.min.x).toBeLessThan(0.4)
  })
})

describe('island', () => {
  it('recesses the sink below the stone and mounts the faucet on the remaining deck', () => {
    const island = kitchenIsland(makeLib(), 2.5, 0.9, true)
    island.updateMatrixWorld(true)
    const surfaceAt = (x: number, z: number) => {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0))
      return ray.intersectObject(island)[0]?.point.y
    }
    expect(surfaceAt(0.4, 0)).toBeCloseTo(ISLAND_TOP, 3)
    expect(surfaceAt(-0.5, 0)).toBeCloseTo(0.807, 3)
    expect(surfaceAt(-0.5, -0.303)).toBeGreaterThan(ISLAND_TOP + 0.2)
  })

  it('faces the run with drawer stacks behind 3 mm reveals', () => {
    for (const w of [1.6, 2.4, 2.52]) {
      const cols = columns(islandFronts(w))
      for (const c of cols) {
        expect(c.map(f => f.kind)).toEqual(['drawer', 'drawer', 'drawer'])
        expect(c[0].w).toBeGreaterThan(0.5)
        expect(c[0].w).toBeLessThan(0.7)
        for (const f of c) expectPullOnFront(f)
        for (let i = 1; i < c.length; i++) expect(c[i].y0 - (c[i - 1].y0 + c[i - 1].h)).toBeCloseTo(REVEAL, 6)
        const top = c[c.length - 1]
        expect(top.y0 + top.h).toBeCloseTo(ISLAND_TOP - 0.04 - REVEAL, 6)
      }
    }
  })

  it('keeps the waterfall counter, pulls only on the run side (-z) and knee space at the stools (+z)', () => {
    const lib = makeLib()
    const w = 2.4
    const d = 1
    const g = kitchenIsland(lib, w, d)
    const pulls = extent(meshOf(g, lib.blackMetal), v => v.y > TOE_H + 0.05 && v.z < -d / 2 + 0.03)
    expect(pulls.isEmpty()).toBe(false)
    expect(pulls.min.z).toBeLessThan(-d / 2 + 0.01)
    expect(extent(meshOf(g, lib.blackMetal)).max.z).toBeLessThan(d / 2 - 0.2)
    expect(extent(meshOf(g, lib.cabinet)).max.z).toBeLessThan(d / 2 - 0.2)
    // waterfall ends run the full depth from the floor to the top
    const counter = meshOf(g, lib.counter)
    for (const s of [-1, 1]) {
      const end = extent(counter, v => s * v.x > w / 2 - 0.039)
      expect(end.min.y).toBeCloseTo(0, 4)
      expect(end.max.y).toBeCloseTo(ISLAND_TOP, 4)
      expect(end.max.z - end.min.z).toBeCloseTo(d, 3)
    }
  })
})
