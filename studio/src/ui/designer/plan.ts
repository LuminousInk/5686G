import { framePoint, inRect, levelFloor, levelId, MAIN_LEVEL, stairFlight } from '../../engine/house/levels'
import { neighbours, SIDES } from '../../engine/house/massing'
import type { Block, HomePlan, InteriorWall, Rect, Roof, RoomDef, RoomType, Side, Stair } from '../../engine/house/types'
import { ZONES } from '../../engine/materials/catalog'
import { planById } from '../../plans'
import { BEARING_ROOF, footprint, UPPER_OFFSET } from '../../plans/footprints'
import {
  along, area, blocksAt, blocksIntersect, center, covered, crossing, distance, edgeIndex, EPS, hullRects, levelBounds,
  openingFits, overlap, project, rectEdge, rectFrom, sameMount, segmentInHull, stairFits, wallLines,
  type Point,
} from './geometry'

export interface Design {
  source: string
  plan: HomePlan
}

export const ROOM_TYPES: { type: RoomType; label: string }[] = [
  { type: 'living', label: 'Living room' }, { type: 'kitchen', label: 'Kitchen' },
  { type: 'dining', label: 'Dining room' }, { type: 'bedroom', label: 'Bedroom' },
  { type: 'primary', label: 'Primary bedroom' }, { type: 'bath', label: 'Bathroom' },
  { type: 'powder', label: 'Powder room' }, { type: 'entry', label: 'Entry' },
  { type: 'hall', label: 'Hall' }, { type: 'laundry', label: 'Laundry' },
  { type: 'closet', label: 'Closet' }, { type: 'office', label: 'Office' },
  { type: 'garage', label: 'Garage' }, { type: 'mudroom', label: 'Mudroom' }, { type: 'gym', label: 'Gym' },
]

export const LIMITS = { blocks: 24, rooms: 72, walls: 160, openings: 180, levels: 4, decks: 20, terraces: 24, stairs: 12, porches: 16 }
export const designSource = (id: string) => footprint(id) ?? planById(id)
export const groundLevel = (p: HomePlan) => p.levels?.[0]?.id ?? MAIN_LEVEL.id
export const isBedroom = (r: RoomDef) => r.type === 'bedroom' || r.type === 'primary'
export const isBath = (r: RoomDef) => r.type === 'bath' || r.type === 'powder'
export const autoFloor = (type: RoomType) => type === 'bath' || type === 'powder' || type === 'laundry' ? 'tile' as const : undefined

export function nextId(items: { id?: string }[], prefix: string) {
  let index = 1
  while (items.some(item => item.id === `${prefix}-${index}`)) index++
  return `${prefix}-${index}`
}

export function finishPlan(p: HomePlan): HomePlan {
  const [a, b, c, d] = levelBounds(p.blocks)
  const x = (a + c) / 2, z = (b + d) / 2
  const width = c - a, depth = d - b
  const radius = Math.max(7, Math.hypot(width, depth) * 0.61)
  const levels = new Set(p.blocks.map(block => levelId(p, block.level)))
  const anchor = p.rooms.find(r => r.type === 'entry') ?? p.rooms.find(r => r.type === 'living') ?? p.rooms[0]
  const mainBlock = blocksAt(p, groundLevel(p))[0] ?? p.blocks[0]
  const frame = p.blocks.find(block => block.id === anchor?.frame)
  const walkFrame = anchor ? frame : mainBlock
  const walkRect = anchor?.rect ?? mainBlock.rect
  const fy = levelFloor(p, anchor?.level ?? mainBlock.level)
  const rise = Math.max(0, ...p.blocks.map(block => levelFloor(p, block.level) - p.floorY))
  const orbitHeight = p.floorY + 1.65 + rise * 0.55
  const dx = walkRect[2] - walkRect[0], dz = walkRect[3] - walkRect[1]
  const [px, pz] = framePoint(walkFrame, walkRect[0] + Math.min(1.04, dx * 0.27), walkRect[3] - Math.min(0.85, dz * 0.24))
  const [tx, tz] = framePoint(walkFrame, walkRect[2] - dx * 0.12, walkRect[1] + dz * 0.43)
  const cladding = p.blocks.flatMap(block => Object.values(block.cladding).flatMap(spec => spec ? [spec.zone] : []))
  const zones = [...new Set([...p.zones, ...cladding])].filter(zone => Object.hasOwn(ZONES, zone))
  const finishes = { ...p.finishes }
  for (const zone of zones) finishes[zone] ??= ZONES[zone].options[0].id
  return {
    ...p, zones, finishes,
    facts: {
      area: Math.round((p.blocks.reduce((sum, block) => sum + (block.utility ? 0 : area(block.rect)), 0)
        - p.stairs.filter(s => s.between).reduce((sum, s) => sum + area(stairFlight(s).rect), 0)) * 10.7639),
      beds: p.rooms.filter(isBedroom).length,
      baths: p.rooms.reduce((n, r) => n + (r.type === 'bath' ? 1 : r.type === 'powder' ? 0.5 : 0), 0),
      stories: levels.size, width, depth,
    },
    views: [
      { id: 'overview', label: 'Overview', kind: 'orbit', pos: [x + radius * 1.12, orbitHeight + radius * 0.93, z + radius * 1.5], target: [x, orbitHeight, z], fov: 52 },
      { id: 'interior', label: anchor?.name ?? 'Inside', kind: 'walk', room: anchor?.id, pos: [px, fy + 1.62, pz], target: [tx, fy + 1.42, tz], fov: 66 },
    ],
  }
}

export function newDesign(source: string, id: string): Design | undefined {
  const base = designSource(source)
  if (!base) return
  const p = structuredClone(base)
  p.id = id
  p.name = footprint(source) ? p.name : `${p.name} copy`
  p.style = 'Custom design'
  p.liveLighting = true
  delete p.tour
  p.openings = p.openings.map((o, i) => ({ ...o, id: o.id ?? `original-opening-${i + 1}` }))
  return { source, plan: finishPlan(p) }
}

export const cladOptions = [
  { name: 'Timber boards', spec: { zone: 'cedar', kind: 'boards' } },
  { name: 'Standing seam panels', spec: { zone: 'panel', kind: 'panel' } },
  { name: 'Accent panels', spec: { zone: 'panel2', kind: 'panel' } },
  { name: 'Board and batten', spec: { zone: 'siding', kind: 'batten' } },
  { name: 'Stucco', spec: { zone: 'stucco', kind: 'stucco' } },
  { name: 'Lap siding', spec: { zone: 'coastal', kind: 'lap' } },
] satisfies { name: string; spec: Block['cladding']['default'] }[]

export function roofFor(block: Block, type: Roof['type'], joined: boolean): Roof {
  const overhang = joined ? 0 : 0.26
  const ridgeAxis = block.rect[2] - block.rect[0] >= block.rect[3] - block.rect[1] ? 'x' : 'z'
  if (type === 'flat') return { type, height: 2.9, overhang, thickness: 0.24 }
  if (type === 'shed') return { type, low: 2.75, high: 3.9, rises: 's', overhang }
  if (type === 'gable') return { type, eave: 2.75, ridge: 4, ridgeAxis, overhang }
  return { type, eave: 2.75, ridge: 3.95, overhang }
}

export function underUpper(p: HomePlan, b: Block) {
  const y = levelFloor(p, b.level)
  return !b.yaw && p.blocks.some(upper => !upper.yaw && levelFloor(p, upper.level) > y && overlap(b.rect, upper.rect))
}

export function snugRoofs(p: HomePlan, level: string) {
  const blocks = blocksAt(p, level)
  const joined = new Set(blocks.filter(b => SIDES.some(s => neighbours(b, s, blocks).length)).map(b => b.id))
  if (joined.size) p.blocks = p.blocks.map(b => joined.has(b.id) ? { ...b, roof: { ...b.roof, overhang: 0 } } : b)
}

export const generated = (wall: InteriorWall) => wall.id.startsWith('room-edge-')
export const enclosed = (room: RoomDef) => room.enclosed === true

/** Regenerate shared boundaries once. Doors keep their host whenever the new topology still supports it. */
export function roomPartitions(p: HomePlan, level: string, frame?: string) {
  const old = p.walls.filter(w => generated(w) && levelId(p, w.level) === level && w.frame === frame)
  const oldById = new Map(old.map(w => [w.id, w]))
  const keep = p.walls.filter(w => !oldById.has(w.id))
  const rooms = p.rooms.filter(r => enclosed(r) && levelId(p, r.level) === level && r.frame === frame)
  const rects = hullRects(p, level, frame)
  const roomEdges = rooms.flatMap(r => SIDES.map(side => rectEdge(r.rect, side)))
  const unique = new Map<string, InteriorWall>()
  for (const [a, b] of roomEdges) {
    const axis = a[0] !== b[0] ? 0 : 1, cross = axis === 0 ? 1 : 0
    const fixed = a[cross], start = a[axis], end = b[axis]
    const relevant = [...roomEdges, ...keep.filter(w => levelId(p, w.level) === level && w.frame === frame).map(w => [w.a, w.b])]
    const cuts = [start, end]
    for (const [c, d] of relevant) {
      if (Math.abs(c[cross] - fixed) < EPS && Math.abs(d[cross] - fixed) < EPS) cuts.push(c[axis], d[axis])
      else {
        const hit = crossing(a, b, c, d)
        if (hit && hit.u >= 0 && hit.u <= 1) cuts.push(along(a, b, distance(a, b) * hit.t)[axis])
      }
    }
    for (const r of rects) cuts.push(r[axis], r[axis + 2])
    const ordered = [...new Set(cuts)].filter(t => t >= start - EPS && t <= end + EPS).sort((x, y) => x - y)
    const point = (value: number, offset = 0): Point => axis === 0 ? [value, fixed + offset] : [fixed + offset, value]
    for (let i = 1; i < ordered.length; i++) {
      const lo = ordered[i - 1], hi = ordered[i]
      if (hi - lo < 0.055) continue
      const mid = (lo + hi) / 2
      if (![-0.12, 0.12].every(offset => rects.some(rect => inRect(rect, ...point(mid, offset), 0.01)))) continue
      if (keep.some(w => levelId(p, w.level) === level && w.frame === frame
          && project(w.a, w.b, point(mid)).d < EPS && project(w.a, w.b, point(lo)).d < EPS && project(w.a, w.b, point(hi)).d < EPS)) continue
      const id = `room-edge-${level}-${frame ?? 'shell'}-${axis}-${fixed.toFixed(4)}-${lo.toFixed(4)}-${hi.toFixed(4)}`
      unique.set(id, { id, a: point(lo), b: point(hi), level, frame })
    }
  }
  p.walls = [...keep, ...unique.values()]
  const existing = p.openings.filter(o => !o.wall || !oldById.has(o.wall))
  const lines = wallLines(p, level)
  for (const o of p.openings) {
    const w = o.wall && oldById.get(o.wall)
    if (!w) continue
    const center = along(w.a, w.b, o.at)
    const block = p.blocks.find(b => b.id === frame)
    const world = framePoint(block, ...center)
    for (const line of lines) {
      if (!('wall' in line.mount)) continue
      const hit = project(line.a, line.b, world)
      const wx = w.b[0] - w.a[0], wz = w.b[1] - w.a[1]
      const wall = p.walls.find(other => 'wall' in line.mount && other.id === line.mount.wall)!
      const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1]
      if (wall.frame !== frame || Math.abs(wx * dz - wz * dx) > EPS || hit.d > EPS) continue
      const next = { ...o, wall: line.mount.wall, at: hit.at }
      if (openingFits({ ...p, openings: existing }, line, next)) {
        existing.push(next)
        break
      }
    }
  }
  p.openings = existing
}

export function resizeBlock(p: HomePlan, id: string, side: Side, value: number) {
  const block = p.blocks.find(b => b.id === id)!
  const level = levelId(p, block.level)
  const k = edgeIndex(side), axis = k % 2
  const old = block.rect[k]
  if (Math.abs(value - old) < EPS) return
  const touching = new Set<Block>([block])
  if (!block.yaw) {
    // Propagate only across shared wall seams. Disconnected or other-storey objects stay put.
    const active = blocksAt(p, level)
    for (const b of touching) for (const s of SIDES) {
      for (const { block: other } of neighbours(b, s, active)) {
        if ([other.rect[axis], other.rect[axis + 2]].some(v => Math.abs(v - old) < EPS)) touching.add(other)
      }
    }
  }
  const onAffected = (pt: Point) => [...touching].some(b => inRect(b.rect, ...pt, -0.27))
  const moved = (v: number, pt: Point) => Math.abs(v - old) < EPS && onAffected(pt) ? value : v
  for (const r of p.rooms) {
    if (levelId(p, r.level) !== level || r.frame !== (block.yaw ? block.id : undefined)) continue
    const mid = center(r.rect)
    for (let i = axis; i < 4; i += 2) {
      const pt: Point = [...mid]
      pt[axis] = r.rect[i]
      const gap = r.rect[i] - old
      if (Math.abs(gap) < 0.25 && onAffected(pt) && (i < 2 ? gap >= -EPS : gap <= EPS))
        r.rect[i] += value - old
      else r.rect[i] = moved(r.rect[i], pt)
    }
  }
  for (const w of p.walls) {
    if (levelId(p, w.level) !== level || w.frame !== (block.yaw ? block.id : undefined)) continue
    const oldA: Point = [...w.a], oldB: Point = [...w.b]
    w.a[axis] = moved(w.a[axis], oldA)
    w.b[axis] = moved(w.b[axis], oldB)
    for (const o of p.openings.filter(o => o.wall === w.id)) {
      const p0 = along(oldA, oldB, o.at)
      if (Math.abs(oldA[axis] - oldB[axis]) < EPS && distance(oldA, w.a) > EPS) p0[axis] += value - old
      o.at = project(w.a, w.b, p0).at
    }
  }
  for (const b of touching) {
    if (Math.abs(b.rect[axis] - old) < EPS) {
      for (const o of p.openings) if (o.block === b.id && o.side && edgeIndex(o.side) % 2 !== axis) o.at += old - value
      b.rect[axis] = value
    }
    if (Math.abs(b.rect[axis + 2] - old) < EPS) b.rect[axis + 2] = value
  }
  return level
}

export function canRotate(p: HomePlan, b: Block) {
  const level = levelId(p, b.level)
  return level === groundLevel(p) && !underUpper(p, b)
    && !SIDES.some(side => neighbours(b, side, blocksAt(p, level)).length)
}

/** A detached volume and the rooms and partitions it contains share one local coordinate frame. */
export function orientVolume(p: HomePlan, id: string, yaw: number) {
  const block = p.blocks.find(b => b.id === id)!
  if (!canRotate(p, block)) return
  const frame = yaw ? id : undefined
  const level = levelId(p, block.level)
  for (const room of p.rooms) {
    if (levelId(p, room.level) !== level) continue
    if (room.frame === id || (!room.frame && !block.yaw && covered(room.rect, [block.rect]))) room.frame = frame
  }
  for (const wall of p.walls) {
    if (levelId(p, wall.level) !== level) continue
    if (wall.frame === id || (!wall.frame && !block.yaw && segmentInHull(wall.a, wall.b, [block.rect]))) wall.frame = frame
  }
  block.yaw = yaw || undefined
}

export function addUpper(p: HomePlan, id: string) {
  const selected = p.blocks.find(b => b.id === id)!
  const level = levelId(p, selected.level)
  const levels = p.levels ?? [{ ...MAIN_LEVEL, label: 'Ground floor' }]
  const offset = (levels.find(item => item.id === level)?.offset ?? 0) + UPPER_OFFSET
  if (selected.yaw || levels.length >= LIMITS.levels || levels.some(item => item.offset >= offset - EPS)) return
  const roof = selected.roof
  const upper = { id: nextId(levels, 'level'), offset, label: `Level ${levels.length + 1}` }
  p.levels = [...levels, upper]
  selected.roof = { ...BEARING_ROOF }
  selected.ceiling = Math.min(typeof selected.ceiling === 'number' ? selected.ceiling : 2.65, 2.78)
  const block = { ...selected, id: nextId(p.blocks, 'volume'), rect: [...selected.rect] as Rect, roof, level: upper.id }
  p.blocks.push(block)
  return { block, level: upper.id, lower: level }
}

export function newStair(p: HomePlan, upper: string, from: Point, dir: Side) {
  const levels = [...p.levels ?? []].sort((a, b) => a.offset - b.offset)
  const index = levels.findIndex(l => l.id === upper)
  if (index < 1) return
  const lower = levels[index - 1]
  const rise = levels[index].offset - lower.offset
  const stair: Stair = {
    id: nextId(p.stairs, 'stair'), from, dir, width: 1.1, rise, steps: Math.ceil(rise / 0.18), going: 0.28,
    between: { upper, lower: lower.id }, rails: ['left', 'right'],
  }
  return stairFits(p, stair) ? stair : undefined
}

export function findStair(p: HomePlan, upper: string, rect: Rect) {
  // Start near an outside wall and try flights parallel to each wall before moving inward.
  for (const inset of [0.85, 1.25, 1.65, 2.05, 2.45]) {
    for (const side of SIDES) {
      const x = side === 'n' || side === 'e' ? rect[0] + inset : rect[2] - inset
      const z = side === 'n' || side === 'w' ? rect[3] - 1.12 : rect[1] + 1.12
      const from: Point = side === 'w' ? [rect[2] - 1.12, z] : side === 'e' ? [rect[0] + 1.12, z] : [x, z]
      const s = newStair(p, upper, from, side)
      if (s) return s
    }
  }
}

const goodRect = (r: Rect, min: number) => r.every(v => Number.isFinite(v) && Math.abs(v) <= 64)
  && r[2] - r[0] >= min - EPS && r[3] - r[1] >= min - EPS

export function editIssues(p: HomePlan): Set<string> {
  const issues = new Set<string>()
  const levels = p.levels ?? [MAIN_LEVEL]
  if (!p.blocks.length || !blocksAt(p, groundLevel(p)).length) issues.add('Keep at least one ground-floor volume.')
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    if ((p[key]?.length ?? 0) > LIMITS[key]) issues.add(`This design has reached the ${LIMITS[key]} ${key} limit.`)
  }
  for (const b of p.blocks) {
    const level = levelId(p, b.level)
    if (!goodRect(b.rect, 2)) issues.add(`Volume ${b.id} needs at least 2 × 2 m and must stay within the drawing limits.`)
    if (p.blocks.some(other => other.id !== b.id && levelId(p, other.level) === level && blocksIntersect(b, other)))
      issues.add(`Volume ${b.id} overlaps another volume on this floor.`)
    const y = levelFloor(p, b.level)
    const below = levels.filter(item => item.offset + p.floorY < y - EPS).sort((a, b) => b.offset - a.offset)[0]
    if (below && !b.yaw && !covered(b.rect, hullRects(p, below.id))) issues.add(`Volume ${b.id} needs a footprint to support it below.`)
  }
  for (const r of p.rooms) {
    if (!goodRect(r.rect, 0.9) || !covered(r.rect, hullRects(p, levelId(p, r.level), r.frame)))
      issues.add(`Room “${r.name}” must fit inside the footprint and be at least 0.9 m wide.`)
  }
  for (const w of p.walls) {
    if (distance(w.a, w.b) < (generated(w) ? 0.05 : 0.55) || !segmentInHull(w.a, w.b, hullRects(p, levelId(p, w.level), w.frame)))
      issues.add(`Wall ${w.id} must stay inside the footprint.`)
  }
  const hosts = levels.flatMap(l => wallLines(p, l.id))
  for (const [i, o] of p.openings.entries()) {
    if (!hosts.some(line => sameMount(line.mount, o) && openingFits(p, line, o, o))) issues.add(`Opening ${o.id ?? i + 1} needs more wall clearance.`)
  }
  for (const s of p.stairs) if (!stairFits(p, s)) issues.add(`Stair ${s.id} needs clear landings and floor space on both levels.`)
  const out = [...p.decks, ...p.terraces]
  for (const [i, outdoor] of out.entries()) {
    const frame = 'frame' in outdoor ? p.blocks.find(b => b.id === outdoor.frame) : undefined
    if (!goodRect(outdoor.rect, 0.9) || blocksAt(p, groundLevel(p)).some(b =>
      frame ? b.id === frame.id && overlap(outdoor.rect, b.rect) : blocksIntersect(b, { ...b, rect: outdoor.rect, yaw: undefined })))
      issues.add(`Outdoor surface ${outdoor.id} must stay outside the ground-floor footprint.`)
    if (!frame && out.slice(0, i).some(other => !('frame' in other && other.frame) && overlap(outdoor.rect, other.rect)))
      issues.add(`Outdoor surface ${outdoor.id} overlaps another surface.`)
  }
  return issues
}

export function applyPlanEdit(previous: HomePlan, edit: (draft: HomePlan) => void) {
  const next = structuredClone(previous)
  edit(next)
  const before = editIssues(previous)
  const issue = [...editIssues(next)].find(message => !before.has(message))
  if (issue) return { issue }
  if (JSON.stringify(next) === JSON.stringify(previous)) return {}
  return { plan: finishPlan(next) }
}

export function mergeRect(a: Rect, b: Rect): Rect | undefined {
  const merged = rectFrom([Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[2], b[2]), Math.max(a[3], b[3])])
  // The union must be rectangular and rooms must touch along a whole edge.
  if (Math.abs(area(a) + area(b) - area(merged)) < EPS && !overlap(a, b)) return merged
}

