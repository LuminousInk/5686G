import * as THREE from 'three'
import { describe, it, expect, vi } from 'vitest'
import { buildHouse } from '../../engine/house/build'
import { levelFloor, stairFlight } from '../../engine/house/levels'
import { roofHeightAt } from '../../engine/house/massing'
import type { HomePlan, Side } from '../../engine/house/types'
import type { MaterialLibrary } from '../../engine/materials/library'
import { PLANS } from '../../plans'
import { FOOTPRINTS } from '../../plans/footprints'
import { isStudioRoute } from '../routes'
import { applyGesture, moveWallEnd, splitRoom } from './actions'
import { decodeDocument, encodeDocument, historyReducer, MAX_LINK, readDocuments, saveDocument, startHistory } from './documents'
import { isDoor, mountOpening, OPENING_CATALOG, wallEnd, stepFor, type Point } from './geometry'
import { guidance } from './guidance'
import { addUpper, applyPlanEdit, editIssues, findStair, newDesign, orientVolume, resizeBlock, roofFor, roomPartitions } from './plan'

const makeDesign = (source: string) => newDesign(source, 'draft-test')!

function makeLib(): MaterialLibrary {
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const use = (name: string) => {
    let material = materials.get(name)
    if (!material) {
      material = new THREE.MeshStandardMaterial({ name })
      materials.set(name, material)
    }
    return material
  }
  return new Proxy({}, {
    get: (_, name: string) => name === 'zone' || name === 'lamp' ? use : use(name),
  }) as MaterialLibrary
}

function change(p: HomePlan, edit: Parameters<typeof applyPlanEdit>[1]) {
  const result = applyPlanEdit(p, edit)
  expect(result.issue).toBeUndefined()
  expect(result.plan).toBeDefined()
  return result.plan!
}

function editGesture(p: HomePlan, gesture: Parameters<typeof applyGesture>[1], catalog = 0) {
  return change(p, next => {
    expect(typeof applyGesture(next, gesture, 'main', 'bedroom', catalog, 0.1, 0.35)).toBe('object')
  })
}

function bedroomPlan() {
  let p = makeDesign('ell').plan
  p = editGesture(p, { kind: 'room', a: [-7, 2.5], b: [-1, 7] })
  p = editGesture(p, { kind: 'opening', at: [-3, 7] })
  p = editGesture(p, { kind: 'opening', at: [-4.6, 2.5] }, 2)
  return p
}

describe('designer documents', () => {
  it('round-trips each template and presentation home through host-safe codes', () => {
    for (const source of [...FOOTPRINTS, ...PLANS]) {
      const design = makeDesign(source.id)
      const code = encodeDocument(design)
      expect(code).toMatch(/^[A-Za-z0-9-]+$/)
      expect(isStudioRoute('#' + code, '')).toBe(true)
      const next = decodeDocument('https://example.test/#' + code, 'draft-import')
      expect(next?.plan.name, source.id).toBe(design.plan.name)
      expect(next?.plan.blocks, source.id).toEqual(design.plan.blocks)
      expect(next?.plan.openings, source.id).toEqual(design.plan.openings)
      expect(next?.plan.rooms, source.id).toEqual(design.plan.rooms)
      expect(next?.plan.liveLighting).toBe(true)
    }
  })

  it('reopens a furnished room, its walls and openings, and a new storey', () => {
    const p = change(bedroomPlan(), plan => {
      const upper = addUpper(plan, plan.blocks[0].id)!
      plan.stairs.push(findStair(plan, upper.level, upper.block.rect)!)
      upper.block.roof = roofFor(upper.block, 'hip', false)
      plan.name = 'Hillside · test'
    })
    const code = encodeDocument({ source: 'ell', plan: p })
    expect(code.length).toBeLessThan(1500)
    const imported = decodeDocument(code, 'draft-new')?.plan
    expect(imported?.facts).toEqual(p.facts)
    expect(imported?.name).toBe(p.name)
    expect(imported?.walls).toEqual(p.walls)
    expect(imported?.stairs).toEqual(p.stairs)
    expect(imported?.blocks).toEqual(p.blocks)
  })

  it('rejects broken codes, unsupported sources, and unsafe assignments', () => {
    const design = makeDesign('bar')
    const encoded = encodeDocument(design)
    expect(decodeDocument(encoded.slice(0, encoded.length / 2), 'bad')).toBeUndefined()
    expect(decodeDocument('d1-zzzzzz-abc', 'bad')).toBeUndefined()
    expect(decodeDocument(encodeDocument({ ...design, source: '../etc' }), 'bad')).toBeUndefined()
    design.plan.blocks[0].rect[0] = -1e6
    expect(decodeDocument(encodeDocument(design), 'bad')).toBeUndefined()
  })

  it('keeps long codes importable and autosaves named designs when storage is available', () => {
    const cedar = makeDesign('cedar-ridge')
    const code = encodeDocument(cedar)
    expect(code.length).toBeGreaterThan(MAX_LINK)
    expect(decodeDocument(code, 'draft-fallback')?.plan.rooms).toEqual(cedar.plan.rooms)
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
    })
    try {
      expect(saveDocument(cedar)).toBe(true)
      const another = newDesign('court', 'draft-second')!
      expect(saveDocument(another)).toBe(true)
      expect(readDocuments().map(d => d.plan.name)).toEqual([another.plan.name, cedar.plan.name])
      vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage disabled') } })
      expect(saveDocument(cedar)).toBe(false)
      expect(readDocuments().map(d => d.plan.name)).toEqual([cedar.plan.name, another.plan.name])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('records one state per edit and clears the redo stack when branching', () => {
    const original = makeDesign('bar').plan
    const b = { ...original, name: 'B' }, c = { ...original, name: 'C' }
    const start = startHistory(original)
    const edited = historyReducer(start, { type: 'edit', plan: b })
    const undone = historyReducer(edited, { type: 'undo' })
    expect(undone.plan).toBe(original)
    expect(historyReducer(undone, { type: 'redo' }).plan).toBe(b)
    const branched = historyReducer(undone, { type: 'edit', plan: c })
    expect(branched.future).toEqual([])
    expect(start.past).toEqual([])
  })
})

describe('designer geometry and checks', () => {
  it('creates valid templates and removes access / egress warnings when the openings are added', () => {
    for (const t of FOOTPRINTS) expect([...editIssues(makeDesign(t.id).plan)], t.id).toEqual([])
    const p = editGesture(makeDesign('ell').plan, { kind: 'room', a: [-7, 2.5], b: [-1, 7] })
    expect(guidance(p)).toContain('Bedroom has no clear route from the entry.')
    expect(guidance(p)).toContain('Bedroom needs an egress-size window.')
    expect(guidance(bedroomPlan())).not.toContain('Bedroom has no clear route from the entry.')
    expect(guidance(bedroomPlan())).not.toContain('Bedroom needs an egress-size window.')
  })

  it('rejects openings across a shared seam and openings overlapping in both dimensions', () => {
    const p = makeDesign('ell').plan
    const spec = { ...OPENING_CATALOG[0].item, at: 0 }
    expect(mountOpening(p, 'main', [-3, 1], spec, 0.1, 0.35)).toBeUndefined()
    expect(mountOpening(p, 'main', [-4.6, -5], spec, 0.1, 0.35)).toBeUndefined()
    expect(mountOpening(p, 'main', [3.85, 1], spec, 0.1, 0.35)).toBeDefined()
  })

  it('splits and rejoins partitions without retaining a ghost door', () => {
    let p = makeDesign('bar').plan
    const old = p.rooms[0]
    p = change(p, next => {
      expect(splitRoom(next, old, 0, -3)).toBeDefined()
    })
    const wall = p.walls.find(w => w.a[0] === -3 && w.b[0] === -3)!
    expect(wall).toBeDefined()
    p = editGesture(p, { kind: 'opening', at: [-3, 0] }, 2)
    const doorId = p.openings.at(-1)?.id
    p = change(p, next => {
      next.rooms = next.rooms.filter(r => r.id !== 'room-1')
      next.rooms[0].rect = old.rect
      next.rooms[0].enclosed = false
      roomPartitions(next, 'main')
    })
    expect(p.openings.some(o => o.id === doorId)).toBe(false)
    expect(p.walls.some(w => w.id === wall.id)).toBe(false)
  })

  it('snaps partitions to octilinear axes on both grids', () => {
    expect(wallEnd([0, 0], [1.08, 0.92], stepFor('m'))).toEqual([1, 1])
    const end = wallEnd([0.3048, 0.3048], [3, 1], stepFor('ft'))
    expect(end).toEqual([3.048, 0.3048])
  })

  it('keeps a detached volume, rooms and door on the same 45-degree frame', () => {
    let p = makeDesign('bar').plan
    p = editGesture(p, { kind: 'wall', a: [-3, 1], b: [0, -2] })
    p = editGesture(p, { kind: 'opening', at: [-1.5, -0.5] }, 2)
    p = change(p, next => moveWallEnd(next, next.walls[0].id, 'b', [1, -3]))
    p = change(p, next => orientVolume(next, next.blocks[0].id, Math.PI / 4))
    expect(p.rooms.every(r => r.frame === p.blocks[0].id)).toBe(true)
    expect(p.walls[0].frame).toBe(p.blocks[0].id)
    const h = buildHouse(p, makeLib())
    expect(h.doors.some(d => d.openingIndex === p.openings.length - 1)).toBe(true)
    h.dispose()
    p = change(p, next => orientVolume(next, next.blocks[0].id, 0))
    expect(p.rooms.every(r => r.frame === undefined)).toBe(true)
  })

  it('builds a deck and a changeable terrace while rejecting coincident surfaces', () => {
    let p = makeDesign('bar').plan
    p = editGesture(p, { kind: 'deck', a: [-7, 4], b: [-2, 6] })
    p = editGesture(p, { kind: 'terrace', a: [-2, 4], b: [2, 7] })
    p = change(p, next => { next.terraces[0].kind = 'gravel' })
    const h = buildHouse(p, makeLib())
    expect(h.floorAt(-4, 5)).toBe(p.floorY)
    expect(h.floorAt(0, 5)).toBeCloseTo(0.05)
    h.dispose()
    expect(applyPlanEdit(p, next => { next.terraces[0].rect[0] = -4 }).issue).toMatch(/overlaps another surface/)
  })

  it('fits equal-pitch hip planes to squares and rectangles', () => {
    const p = makeDesign('ell').plan
    const b = p.blocks[0]
    b.roof = roofFor(b, 'hip', true)
    expect(roofHeightAt(b, 0, 1)).toBeCloseTo(2.75)
    expect(roofHeightAt(b, 0, -2)).toBeCloseTo(3.95)
    expect(roofHeightAt(b, 5.5, -2)).toBeCloseTo(3.35)
  })
})

describe('designer builder fuzz', () => {
  it('builds randomized valid multi-volume houses, roofs, rooms, doors and stairs', () => {
    let state = 142507
    const rand = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0
      return state / 2 ** 32
    }
    const lib = makeLib()
    const sides: Side[] = ['n', 'e', 's', 'w']
    const roofs = ['flat', 'shed', 'gable', 'hip'] as const
    for (let i = 0; i < 35; i++) {
      let p = (i % 2 ? bedroomPlan() : makeDesign(FOOTPRINTS[i % FOOTPRINTS.length].id).plan)
      p = change(p, next => {
        if (!next.levels) resizeBlock(next, next.blocks[0].id, 'e', next.blocks[0].rect[2] + 0.1 + rand() * 2)
        for (const b of next.blocks) {
          if (next.levels && b === next.blocks[0]) continue
          b.roof = roofFor(b, roofs[Math.floor(rand() * roofs.length)], next.blocks.length > 1)
          if (b.roof.type === 'shed') b.roof.rises = sides[Math.floor(rand() * sides.length)]
          if (b.roof.type === 'gable') b.roof.ridge += rand() * 0.55
        }
        if (i % 3 === 0 && !next.levels) {
          const u = addUpper(next, next.blocks[0].id)!
          const s = findStair(next, u.level, u.block.rect)
          if (s) next.stairs.push(s)
        }
      })
      const a: Point = [13 + rand() * 2, -13 + rand() * 2]
      p = editGesture(p, { kind: 'volume', a, b: [a[0] + 3 + rand() * 3, a[1] + 3 + rand() * 3] })
      const house = buildHouse(p, lib)
      try {
        expect(house.bounds.isEmpty()).toBe(false)
        expect(house.bounds.min.toArray().every(Number.isFinite)).toBe(true)
        for (const [j, opening] of p.openings.entries()) {
          if (isDoor(opening)) expect(house.doors.some(door => door.openingIndex === j), opening.id).toBe(true)
        }
        for (const s of p.stairs) {
          if (!s.between) continue
          const { dx, dz, run } = stairFlight(s)
          const mid: Point = [s.from[0] + dx * run / 2, s.from[1] + dz * run / 2]
          const y = house.floorAt(...mid, levelFloor(p, s.between.lower))!
          expect(y).toBeGreaterThan(levelFloor(p, s.between.lower))
          expect(y).toBeLessThan(levelFloor(p, s.between.upper))
        }
        house.group.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return
          // An empty cutaway variant has no position attribute and draws nothing.
          const position = object.geometry.getAttribute('position')
          if (!position) return
          const verts = position.array
          for (const v of verts) if (!Number.isFinite(v)) throw new Error(`Non-finite vertex for ${object.name}`)
        })
      } finally {
        house.dispose()
      }
    }
  })
})
