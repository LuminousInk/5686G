import { framePoint, inRect, levelId, MAIN_LEVEL, stairFlight } from '../../engine/house/levels'
import type { HomePlan, Opening, RoomDef } from '../../engine/house/types'
import { along, area, blocksAt, center, crossing, distance, doorSwing, isDoor, levelBounds, overlap, project, sameMount, wallLines, type Point, type WallLine } from './geometry'
import { groundLevel, isBath, isBedroom } from './plan'

interface Connection { opening: Opening; line: WallLine }
type Barrier = [Point, Point]

function openingsAndWalls(plan: HomePlan, level: string) {
  const lines = wallLines(plan, level)
  const connections: Connection[] = plan.openings.flatMap(opening => {
    const line = lines.find(line => sameMount(line.mount, opening) && opening.at >= line.range[0] && opening.at <= line.range[1])
    return line ? [{ line, opening }] : []
  })
  const barriers: Barrier[] = []
  for (const line of lines) {
    const hosted = connections.filter(connection => connection.line === line && isDoor(connection.opening))
    if (!('wall' in line.mount) && !(line.neighbour && hosted.length)) continue
    let from = line.range[0]
    for (const { opening } of hosted.sort((a, b) => a.opening.at - b.opening.at)) {
      const to = opening.at - opening.width / 2 + 0.06
      if (to > from) barriers.push([along(line.a, line.b, from), along(line.a, line.b, to)])
      from = opening.at + opening.width / 2 - 0.06
    }
    if (from < line.range[1]) barriers.push([along(line.a, line.b, from), along(line.a, line.b, line.range[1])])
  }
  return { connections, barriers }
}

const otherSide = (line: WallLine, at: number, offset: number): Point => {
  const p = along(line.a, line.b, at), len = distance(line.a, line.b)
  return [p[0] - (line.b[1] - line.a[1]) * offset / len, p[1] + (line.b[0] - line.a[0]) * offset / len]
}
const localContains = (plan: HomePlan, room: RoomDef, point: Point) =>
  inRect(room.rect, ...framePoint(plan.blocks.find(b => b.id === room.frame), ...point, true), -0.02)

function reachability(plan: HomePlan) {
  const levels = [...plan.levels ?? [MAIN_LEVEL]].sort((a, b) => a.offset - b.offset)
  const accessible = new Set<string>()
  const data = new Map(levels.map(level => [level.id, openingsAndWalls(plan, level.id)]))
  const queries = new Map<string, FloorQuery>()
  const floors = new Map<string, (point: Point) => Uint8Array>()
  const resolutions = new Map<string, number>()
  // Grid cells accelerate reachability. Wall intersections are tested in real plan coordinates.
  for (const level of levels) {
    const blocks = blocksAt(plan, level.id)
    if (!blocks.length) continue
    const [x0, z0, x1, z1] = levelBounds(blocks)
    const step = Math.max(0.32, (Math.max(x1 - x0, z1 - z0) / 175))
    resolutions.set(level.id, step)
    const cols = Math.max(1, Math.ceil((x1 - x0) / step)), rows = Math.max(1, Math.ceil((z1 - z0) / step))
    const solid = new Uint8Array(cols * rows), cells = new Uint8Array(cols * rows)
    const barriers = data.get(level.id)!.barriers
    const buckets = new Map<number, Barrier[]>()
    for (const barrier of barriers) {
      const [[x, z], [u, v]] = barrier
      const loX = Math.max(0, Math.floor((Math.min(x, u) - x0) / step) - 1)
      const hiX = Math.min(cols - 1, Math.floor((Math.max(x, u) - x0) / step) + 1)
      const loZ = Math.max(0, Math.floor((Math.min(z, v) - z0) / step) - 1)
      const hiZ = Math.min(rows - 1, Math.floor((Math.max(z, v) - z0) / step) + 1)
      for (let j = loZ; j <= hiZ; j++) for (let i = loX; i <= hiX; i++) {
        const key = j * cols + i
        const items = buckets.get(key)
        if (items) items.push(barrier)
        else buckets.set(key, [barrier])
      }
    }
    const point = (i: number): Point => [x0 + (i % cols + 0.5) * step, z0 + (Math.floor(i / cols) + 0.5) * step]
    const keyAt = ([x, z]: Point) => {
      const i = Math.floor((x - x0) / step), j = Math.floor((z - z0) / step)
      return i >= 0 && i < cols && j >= 0 && j < rows ? j * cols + i : -1
    }
    const crosses = (a: Point, b: Point, key: number) => buckets.get(key)?.some(([c, d]) => {
      const hit = crossing(a, b, c, d)
      return hit && hit.t >= -1e-5 && hit.t <= 1.00001 && hit.u >= -1e-5 && hit.u <= 1.00001
    })
    const holes = plan.stairs.filter(s => s.between?.upper === level.id).map(s => stairFlight(s).rect)
    for (let i = 0; i < solid.length; i++) {
      const p = point(i)
      const clearance: Point[] = [[p[0] - 0.085, p[1]], [p[0] + 0.085, p[1]], [p[0], p[1] - 0.085], [p[0], p[1] + 0.085]]
      solid[i] = Number(!holes.some(rect => inRect(rect, ...p))
        && clearance.every(point => blocks.some(b => inRect(b.rect, ...framePoint(b, ...point, true), -0.001))))
    }
    const flood = (p: Point) => {
      const queue: number[] = []
      for (const u of [-step * 0.55, 0, step * 0.55]) for (const v of [-step * 0.55, 0, step * 0.55]) {
        const k = keyAt([p[0] + u, p[1] + v])
        if (solid[k] && !cells[k] && !crosses(p, point(k), k)) {
          cells[k] = 1
          queue.push(k)
        }
      }
      for (let i = 0; i < queue.length; i++) {
        const k = queue[i], a = point(k)
        const neighbours = [k - cols, k + cols]
        if (k % cols > 0) neighbours.push(k - 1)
        if (k % cols < cols - 1) neighbours.push(k + 1)
        for (const n of neighbours) if (solid[n] && !cells[n] && !crosses(a, point(n), k)) {
          cells[n] = 1
          queue.push(n)
        }
      }
      return cells
    }
    floors.set(level.id, p => { flood(p); return cells })
    const nearby = (p: Point) => [-step * 0.55, 0, step * 0.55].some(u =>
      [-step * 0.55, 0, step * 0.55].some(v => {
        const k = keyAt([p[0] + u, p[1] + v])
        return cells[k] && !crosses(p, point(k), k)
      }))
    // Store the query separately so landing checks never seed a disconnected floor.
    queries.set(level.id, { nearby, cells, point })
  }
  function seed(level: string, p: Point) { floors.get(level)?.(p) }
  const ground = groundLevel(plan)
  for (const { opening, line } of data.get(ground)?.connections ?? []) {
    if (!('block' in line.mount) || line.neighbour || !isDoor(opening)) continue
    const offset = Math.max(0.27, (resolutions.get(ground) ?? 0.32) * 0.7)
    seed(ground, otherSide(line, opening.at, offset))
    seed(ground, otherSide(line, opening.at, -offset))
  }
  for (let i = 0; i < levels.length; i++) {
    for (const stair of plan.stairs) {
      if (!stair.between) continue
      const { upper, lower } = stair.between
      const { dx, dz, end } = stairFlight(stair)
      const bottom: Point = [end[0] + dx * 0.45, end[1] + dz * 0.45]
      const top: Point = [stair.from[0] - dx * 0.45, stair.from[1] - dz * 0.45]
      if (queries.get(lower)?.nearby(bottom)) seed(upper, top)
      if (queries.get(upper)?.nearby(top)) seed(lower, bottom)
    }
  }
  for (const room of plan.rooms) {
    const q = queries.get(levelId(plan, room.level))
    if (!q) continue
    const frame = plan.blocks.find(b => b.id === room.frame)
    const mid = framePoint(frame, ...center(room.rect))
    if (q.nearby(mid) || q.cells.some((cell, i) => !!cell && localContains(plan, room, q.point(i)))) accessible.add(room.id)
  }
  return { accessible, data }
}

interface FloorQuery { nearby(p: Point): boolean; cells: Uint8Array; point(key: number): Point }

export function guidance(plan: HomePlan): string[] {
  const notes: string[] = []
  if (!plan.rooms.some(r => r.type === 'kitchen')) notes.push('Add a kitchen.')
  if (!plan.rooms.some(isBath)) notes.push('Add a bathroom.')
  const { accessible, data } = reachability(plan)
  const rooms = plan.rooms
  for (const [i, room] of rooms.entries()) {
    const level = levelId(plan, room.level)
    if (rooms.slice(0, i).some(r => levelId(plan, r.level) === level && r.frame === room.frame && overlap(r.rect, room.rect))) notes.push(`${room.name} overlaps another room.`)
    const min = isBedroom(room) ? 7 : isBath(room) ? 2.2 : room.type === 'living' || room.type === 'kitchen' ? 5.5 : 1.5
    if (area(room.rect) < min || (isBedroom(room) && Math.min(room.rect[2] - room.rect[0], room.rect[3] - room.rect[1]) < 2.05))
      notes.push(`${room.name} may be too small for its use.`)
    if (!accessible.has(room.id)) notes.push(`${room.name} has no clear route from the entry.`)
    if (!isBedroom(room)) continue
    const egress = data.get(level)?.connections.some(({ opening: o, line }) => {
      if (!('block' in line.mount) || line.neighbour || o.kind !== 'window' || o.width < 0.66 || o.height < 0.66
          || o.width * o.height < 0.7 || (o.sill ?? 0) > 1.1 || (o.panes ?? 1) > 1) return false
      return [0.38, -0.38].some(offset => localContains(plan, room, otherSide(line, o.at, offset)))
    })
    if (!egress) notes.push(`${room.name} needs an egress-size window.`)
  }
  for (const { connections, barriers } of data.values()) {
    const swings = connections.filter(({ opening, line }) => opening.kind === 'door' && ('wall' in line.mount || line.neighbour))
      .map(({ opening, line }) => {
        const at = opening.at - opening.width / 2 + 0.025
        const swing = doorSwing(plan, line, opening.at)
        const hinge = along(line.a, line.b, at)
        const samples = [30, 60, 90].map(angle => {
          const rad = angle * Math.PI / 180
          return otherSide(line, at + opening.width * Math.cos(rad), swing * opening.width * Math.sin(rad))
        })
        return { opening, line, hinge, samples }
      })
    for (const [i, swing] of swings.entries()) {
      const { hinge, samples, opening, line } = swing
      const hitsWall = samples.some(p => barriers.some(([a, b]) => {
        const hit = crossing(hinge, p, a, b)
        return hit && hit.t > 0.12 && hit.t < 0.98 && hit.u >= 0 && hit.u <= 1
      }))
      const hitsDoor = swings.slice(0, i).some(other => samples.some(p => other.samples.some(q => {
        const hit = crossing(hinge, p, other.hinge, q)
        return (hit && hit.t > 0.08 && hit.t < 1 && hit.u > 0.08 && hit.u < 1)
          || (project(other.hinge, q, p).d < 0.13 && distance(p, other.hinge) > 0.12)
      })))
      if (hitsWall || hitsDoor) {
        const room = rooms.find(r => levelId(plan, r.level) === line.level && localContains(plan, r, samples[2]))
        notes.push(room ? `Check the door swing in ${room.name}.` : `Check the swing of ${opening.id?.replace(/-/g, ' ') ?? 'an interior door'}.`)
      }
    }
  }
  return [...new Set(notes)]
}
