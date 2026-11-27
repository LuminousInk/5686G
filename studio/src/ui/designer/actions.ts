import { framePoint, inRect, levelFloor, levelId, stairFlight } from '../../engine/house/levels'
import type { Block, HomePlan, Opening, RoomDef, RoomType, Side } from '../../engine/house/types'
import { along, area, blocksAt, center, distance, edgeIndex, EPS, OPENING_CATALOG, overlap, project, rectFrom, mountOpening, stairFits, wallEnd, type Point } from './geometry'
import { autoFloor, enclosed, generated, groundLevel, nextId, newStair, resizeBlock, roomPartitions, ROOM_TYPES, snugRoofs } from './plan'
import { BEARING_ROOF } from '../../plans/footprints'

export type ItemKind = 'volume' | 'room' | 'wall' | 'opening' | 'stair' | 'deck' | 'terrace'
export type Selection = { kind: ItemKind; id: string }
export type Tool = 'select' | ItemKind | 'pan'
export type Gesture =
  | { kind: 'volume' | 'room' | 'wall' | 'deck' | 'terrace' | 'stair'; a: Point; b: Point }
  | { kind: 'opening'; at: Point; id?: string }
  | { kind: 'edge'; item: Selection; side: Side; at: Point }
  | { kind: 'wall-end'; id: string; endpoint: 'a' | 'b'; at: Point }

export const itemKey = {
  volume: 'blocks', room: 'rooms', wall: 'walls', opening: 'openings', stair: 'stairs', deck: 'decks', terrace: 'terraces',
} as const

export function itemOnLevel(p: HomePlan, sel: Selection, level: string) {
  if (sel.kind === 'stair') return p.stairs.some(s => s.id === sel.id && (!s.between ? level === groundLevel(p) : [s.between.lower, s.between.upper].includes(level)))
  if (sel.kind === 'deck' || sel.kind === 'terrace') return level === groundLevel(p) && p[itemKey[sel.kind]].some(o => o.id === sel.id)
  if (sel.kind === 'opening') {
    const o = p.openings.find(x => x.id === sel.id)
    if (!o) return false
    const host = o.wall ? p.walls.find(w => w.id === o.wall) : p.blocks.find(b => b.id === o.block)
    return !!host && levelId(p, host.level) === level
  }
  return p[itemKey[sel.kind]].some(o => o.id === sel.id && levelId(p, o.level) === level)
}

export function removeItem(p: HomePlan, item: Selection) {
  const key = itemKey[item.kind]
  switch (key) {
    case 'blocks': {
      const b = p.blocks.find(b => b.id === item.id)!
      const level = levelId(p, b.level)
      p.blocks = p.blocks.filter(b => b.id !== item.id)
      p.openings = p.openings.filter(o => o.block !== item.id)
      p.rooms = p.rooms.filter(r => r.frame !== item.id && (levelId(p, r.level) !== level || !center(r.rect).every((v, i) => v >= b.rect[i] && v <= b.rect[i + 2])))
      p.terraces = p.terraces.filter(t => t.frame !== item.id)
      p.porches = p.porches.filter(t => t.frame !== item.id)
      const removed = p.walls.filter(w => w.frame === item.id || (levelId(p, w.level) === level && inRect(b.rect, (w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2, EPS)))
      p.walls = p.walls.filter(w => !removed.includes(w))
      p.openings = p.openings.filter(o => !removed.some(w => w.id === o.wall))
      p.stairs = p.stairs.filter(s => !s.between || stairFits({ ...p, walls: [] }, s))
      if (p.levels && level !== groundLevel(p) && !p.blocks.some(b => levelId(p, b.level) === level)) p.levels = p.levels.filter(l => l.id !== level)
      roomPartitions(p, level)
      break
    }
    case 'rooms': {
      const r = p.rooms.find(r => r.id === item.id)!
      p.rooms = p.rooms.filter(r => r.id !== item.id)
      roomPartitions(p, levelId(p, r.level), r.frame)
      break
    }
    case 'walls':
      p.walls = p.walls.filter(w => w.id !== item.id)
      p.openings = p.openings.filter(o => o.wall !== item.id)
      break
    case 'openings': p.openings = p.openings.filter(o => o.id !== item.id); break
    case 'stairs': p.stairs = p.stairs.filter(o => o.id !== item.id); break
    case 'decks': p.decks = p.decks.filter(o => o.id !== item.id); break
    case 'terraces': p.terraces = p.terraces.filter(o => o.id !== item.id); break
  }
}

export function resizeItem(p: HomePlan, item: Selection, side: Side, value: number) {
  if (item.kind === 'volume') {
    const level = resizeBlock(p, item.id, side, value)
    if (level) snugRoofs(p, level)
    return
  }
  if (item.kind === 'room' || item.kind === 'deck' || item.kind === 'terrace') {
    const entry = p[itemKey[item.kind]].find(o => o.id === item.id)!
    entry.rect[edgeIndex(side)] = value
    if (item.kind === 'room') {
      const r = entry as RoomDef
      if (enclosed(r)) roomPartitions(p, levelId(p, r.level), r.frame)
    }
  }
}

export function moveWallEnd(p: HomePlan, id: string, endpoint: 'a' | 'b', point: Point) {
  const wall = p.walls.find(w => w.id === id)!
  if (generated(wall)) return
  const openings = p.openings.filter(o => o.wall === id).map(o => ({ o, point: along(wall.a, wall.b, o.at) }))
  wall[endpoint] = point
  for (const { o, point } of openings) o.at = project(wall.a, wall.b, point).at
  roomPartitions(p, levelId(p, wall.level), wall.frame)
}

export function splitRoom(p: HomePlan, room: RoomDef, axis: 0 | 1, at: number) {
  if (at - room.rect[axis] < 0.9 - EPS || room.rect[axis + 2] - at < 0.9 - EPS) return
  const one = { ...room, rect: [...room.rect] as RoomDef['rect'], enclosed: true }
  const two = { ...one, id: nextId(p.rooms, 'room'), rect: [...room.rect] as RoomDef['rect'], name: 'New room', type: 'hall' as const, floor: undefined, furnish: undefined }
  one.rect[axis + 2] = at
  two.rect[axis] = at
  p.rooms = p.rooms.map(r => r.id === room.id ? one : r)
  p.rooms.push(two)
  roomPartitions(p, levelId(p, room.level), room.frame)
  return { kind: 'room', id: two.id } satisfies Selection
}

export function applyGesture(p: HomePlan, g: Gesture, level: string, roomType: RoomType, catalog: number, step: number, radius: number): Selection | string {
  const active = blocksAt(p, level)
  if (g.kind === 'opening') {
    const moving = p.openings.find(o => o.id === g.id)
    const item: Opening = moving ?? { ...OPENING_CATALOG[catalog].item, id: nextId(p.openings, 'opening'), at: 0 }
    const placed = mountOpening(p, level, g.at, item, step, radius, moving)
    if (!placed) return 'Choose a compatible wall with room for the opening and its trim.'
    p.openings = moving ? p.openings.map(o => o === moving ? placed : o) : [...p.openings, placed]
    return { kind: g.kind, id: placed.id! }
  }
  if (g.kind === 'edge') {
    const block = g.item.kind === 'volume' ? p.blocks.find(b => b.id === g.item.id) : undefined
    const framed = g.item.kind === 'room' || g.item.kind === 'terrace' ? p[itemKey[g.item.kind]].find(o => o.id === g.item.id)?.frame : undefined
    const frame = block ?? p.blocks.find(b => b.id === framed)
    resizeItem(p, g.item, g.side, framePoint(frame, ...g.at, true)[edgeIndex(g.side) % 2])
    return g.item
  }
  if (g.kind === 'wall-end') {
    const wall = p.walls.find(w => w.id === g.id)!
    const frame = p.blocks.find(b => b.id === wall.frame)
    const anchor = g.endpoint === 'a' ? wall.b : wall.a
    moveWallEnd(p, g.id, g.endpoint, wallEnd(anchor, framePoint(frame, ...g.at, true), step))
    return { kind: 'wall', id: g.id }
  }
  if (g.kind === 'stair') {
    if (distance(g.a, g.b) < 0.7) return 'Drag from the upper landing toward the bottom of the stair.'
    const [dx, dz] = [g.b[0] - g.a[0], g.b[1] - g.a[1]]
    const dir: Side = Math.abs(dx) > Math.abs(dz) ? dx > 0 ? 'e' : 'w' : dz > 0 ? 's' : 'n'
    const stair = newStair(p, level, g.a, dir)
    if (!stair) return 'Place the stair on an upper floor with clear landings on both levels.'
    p.stairs.push(stair)
    return { kind: g.kind, id: stair.id }
  }
  const frame = (g.kind === 'wall' || g.kind === 'room')
    ? active.find(b => b.yaw && inRect(b.rect, ...framePoint(b, ...g.a, true), -EPS)) : undefined
  const a = framePoint(frame, ...g.a, true), b = framePoint(frame, ...g.b, true)
  const rect = rectFrom(a, b)
  if (g.kind === 'wall') {
    if (distance(a, b) < 0.55) return 'Draw a wall at least 0.55 m long.'
    const id = nextId(p.walls, 'wall')
    p.walls.push({ id, a, b, level, frame: frame?.id })
    roomPartitions(p, level, frame?.id)
    return { kind: g.kind, id }
  }
  if (area(rect) <= EPS) return 'Drag to draw a rectangle.'
  if (g.kind === 'volume') {
    const id = nextId(p.blocks, 'volume')
    const block: Block = {
      id, rect, level,
      roof: { type: 'flat', height: 2.9, overhang: 0.24, thickness: 0.26 },
      cladding: { default: { zone: 'cedar', kind: 'boards' } }, ceiling: 2.65,
    }
    const currentY = levelFloor(p, level)
    const lower = p.blocks.filter(b => levelFloor(p, b.level) < currentY && levelFloor(p, b.level) >= currentY - 3.1)
    for (const base of lower) if (!base.yaw && overlap(base.rect, rect)) {
      const depth = currentY - levelFloor(p, base.level)
      if (depth > 2.55) {
        base.roof = { ...BEARING_ROOF, height: depth - 0.25 }
        base.ceiling = Math.min(depth - 0.27, 2.65)
      }
    }
    p.blocks.push(block)
    snugRoofs(p, level)
    return { kind: g.kind, id }
  }
  if (g.kind === 'room') {
    const id = nextId(p.rooms, 'room')
    const name = ROOM_TYPES.find(r => r.type === roomType)!.label
    const count = p.rooms.filter(r => r.name === name || r.name.startsWith(`${name} `)).length
    const room: RoomDef = {
      id, rect, level, frame: frame?.id, type: roomType, name: count ? `${name} ${count + 1}` : name, floor: autoFloor(roomType),
      enclosed: !['living', 'kitchen', 'dining', 'hall', 'entry'].includes(roomType),
    }
    p.rooms.push(room)
    if (enclosed(room)) roomPartitions(p, level, frame?.id)
    return { kind: g.kind, id }
  }
  if (level !== groundLevel(p)) return 'Draw decks and terraces on the ground floor.'
  if (g.kind === 'deck') {
    const id = nextId(p.decks, 'deck')
    p.decks.push({ id, rect, height: p.floorY, boardsAlong: 'x', rails: [] })
    return { kind: g.kind, id }
  }
  const id = nextId(p.terraces, 'terrace')
  p.terraces.push({ id, rect, kind: 'pavers', height: 0.05 })
  return { kind: 'terrace', id }
}

export function stairDirection(p: HomePlan, stairId: string, side: Side) {
  const s = p.stairs.find(s => s.id === stairId)!
  const flight = stairFlight(s)
  if (!s.between) return
  const run = flight.run / 2
  const [x, z] = center(flight.rect)
  s.dir = side
  s.from = [x + (side === 'w' ? run : side === 'e' ? -run : 0), z + (side === 'n' ? run : side === 's' ? -run : 0)]
}
