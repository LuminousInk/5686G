import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PLANS } from '../../plans'
import { MeshBatch } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { buildInteriorShell } from './interiorShell'
import { sideFrame, sidePoint, WALL_T } from './massing'
import type { BuiltDoor, HomePlan, Opening, RoomDef } from './types'
import { buildExteriorWalls } from './walls'

const DOOR_KINDS = new Set(['door', 'entry', 'slider', 'garage'])
const PUBLIC_ROOMS = new Set(['living', 'dining', 'kitchen', 'entry', 'hall'])

function makeLib(): MaterialLibrary {
  const material = (name: string) => new THREE.MeshStandardMaterial({ name })
  return {
    wall: material('wall'),
    ceiling: material('ceiling'),
    cabinet: material('cabinet'),
    blackMetal: material('black-metal'),
    concrete: material('concrete'),
    floor: material('floor'),
    tileFloor: material('tile-floor'),
    foundation: material('foundation'),
    glass: material('glass'),
    steel: material('steel'),
    zone: (name: string) => material(`zone:${name}`),
    lamp: () => material('lamp'),
  } as unknown as MaterialLibrary
}

function roomAt(plan: HomePlan, x: number, z: number): RoomDef | undefined {
  return plan.rooms.find(r => x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3])
}

function roomsAround(plan: HomePlan, op: Opening): (RoomDef | undefined)[] {
  if (op.wall) {
    const wall = plan.walls.find(w => w.id === op.wall)
    if (!wall) return []
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1])
    const dx = (wall.b[0] - wall.a[0]) / len
    const dz = (wall.b[1] - wall.a[1]) / len
    const x = wall.a[0] + dx * op.at
    const z = wall.a[1] + dz * op.at
    return [1, -1].map(side => roomAt(plan, x - dz * side * 0.3, z + dx * side * 0.3))
  }
  const block = plan.blocks.find(b => b.id === op.block)
  if (!block || !op.side) return []
  const frame = sideFrame(block.rect, op.side)
  return [1, -1].map(side => {
    const [x, z] = sidePoint(frame, op.at, WALL_T / 2 + side * 0.3)
    return roomAt(plan, x, z)
  })
}

function openingLabel(op: Opening, index: number) {
  return op.id ?? `#${index} ${op.wall ?? `${op.block}/${op.side}`}@${op.at}`
}

function census(plan: HomePlan) {
  const exterior = buildExteriorWalls(plan, makeLib(), new MeshBatch())
  const interior = buildInteriorShell(plan, makeLib(), new MeshBatch())
  const built = [...exterior.doors, ...interior.doors]
  return plan.openings.flatMap((op, openingIndex) => {
    if (!DOOR_KINDS.has(op.kind)) return []
    const rooms = roomsAround(plan, op)
    return [{ op, openingIndex, rooms, records: built.filter(d => d.openingIndex === openingIndex) }]
  })
}

function checkCensus(plan: HomePlan) {
  const rows = census(plan)
  if (process.env.DOOR_CENSUS) {
    console.table(rows.map(({ op, openingIndex, rooms, records }) => ({
      plan: plan.id,
      opening: openingLabel(op, openingIndex),
      kind: op.kind,
      rooms: rooms.map(r => r?.name ?? 'outside').join(' / '),
      leaf: records[0]?.leaf ?? false,
      glass: records[0]?.glass ?? false,
      records: records.length,
    })))
  }
  for (const { op, openingIndex, rooms, records } of rows) {
    const label = `${plan.id}/${openingLabel(op, openingIndex)}`
    expect(records.length, `${label}: expected exactly one built opening`).toBe(1)
    const door: BuiltDoor | undefined = records[0]
    if (!door) continue
    expect(door.kind, label).toBe(op.kind)
    if (op.block) {
      if (op.kind === 'slider') expect(door.glass, `${label}: slider needs glass panels`).toBe(true)
      else expect(door.leaf, `${label}: ${op.kind} needs a door leaf/panel`).toBe(true)
      continue
    }
    const publicPassage = op.width > 1.2 && rooms.length === 2 && rooms.every(r => r && PUBLIC_ROOMS.has(r.type))
    if (publicPassage) {
      expect(door.casing, `${label}: an open public passage needs casing`).toBe(true)
    } else {
      const roomNames = rooms.map(r => r?.type ?? 'unknown').join('/')
      expect(door.leaf, `${label}: doorway into ${roomNames} needs a leaf`).toBe(true)
    }
  }
}

describe('door census', () => {
  for (const plan of PLANS) {
    it(`${plan.name}: every doorway has its required leaf, panels or casing`, () => checkCensus(plan))
  }

  it('builds an interior-style door on a side shared by two blocks', () => {
    const block = (id: string, rect: [number, number, number, number]) => ({
      id,
      rect,
      roof: { type: 'flat', height: 2.8 } as const,
      cladding: { default: { zone: 'body', kind: 'panel' } } as const,
    })
    const plan: HomePlan = {
      id: 'shared-side-test',
      name: 'Shared side test',
      style: 'Test',
      tagline: '',
      facts: { area: 32, beds: 1, baths: 0, stories: 1, width: 8, depth: 4 },
      floorY: 0,
      blocks: [block('living', [0, 0, 4, 4]), block('bed', [4, 0, 8, 4])],
      walls: [],
      openings: [{ id: 'shared-door', block: 'living', side: 'e', at: 2, width: 0.9, height: 2.1, kind: 'door' }],
      rooms: [
        { id: 'living', name: 'Living', type: 'living', rect: [0, 0, 4, 4] },
        { id: 'bed', name: 'Bedroom', type: 'bedroom', rect: [4, 0, 8, 4] },
      ],
      decks: [], porches: [], stairs: [], terraces: [], landscape: {}, views: [], finishes: {}, zones: [],
    }
    const out = buildExteriorWalls(plan, makeLib(), new MeshBatch())
    expect(out.doors).toHaveLength(1)
    expect(out.doors[0]).toMatchObject({ openingIndex: 0, kind: 'door', leaf: true, casing: true })
  })
})
