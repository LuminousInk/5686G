import { framePoint, inRect, levelId, stairFlight, subtractRect } from '../../engine/house/levels'
import { ceilingAt, roofHeightAt, sideFrame, sideIntervals, SIDES } from '../../engine/house/massing'
import type { Block, HomePlan, InteriorWall, Opening, OpeningKind, Rect, Side, Stair } from '../../engine/house/types'

export type Point = [number, number]
export type Units = 'ft' | 'm'
export const EPS = 0.001
export const ACROSS = 0.3048
export const stepFor = (units: Units) => units === 'ft' ? ACROSS : 0.1
export const snapValue = (value: number, step: number) => Math.round(Math.round(value / step) * step * 10000) / 10000
export const snapPoint = ([x, z]: Point, step: number): Point => [snapValue(x, step), snapValue(z, step)]
export const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1])
export const rectFrom = (a: Point, b: Point): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
export const center = ([x, z, x1, z1]: Rect): Point => [(x + x1) / 2, (z + z1) / 2]
export const area = ([x, z, x1, z1]: Rect) => (x1 - x) * (z1 - z)
export const overlap = (a: Rect, b: Rect) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > EPS && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > EPS
export const inset = ([a, b, c, d]: Rect, gap: number): Rect => [a + gap, b + gap, c - gap, d - gap]
export const rectEdge = (rect: Rect, side: Side): [Point, Point] => {
  const f = sideFrame(rect, side)
  return [[f.sx, f.sz], [f.sx + f.dx * f.length, f.sz + f.dz * f.length]]
}
export const edgeIndex = (side: Side) => side === 'w' ? 0 : side === 'n' ? 1 : side === 'e' ? 2 : 3
export const blocksAt = (plan: HomePlan, level: string) => plan.blocks.filter(b => levelId(plan, b.level) === level)
export const isDoor = (o: Opening) => o.kind === 'door' || o.kind === 'entry' || o.kind === 'slider' || o.kind === 'garage'

export function wallEnd(a: Point, b: Point, step: number): Point {
  const x = b[0] - a[0], z = b[1] - a[1]
  const angle = Math.round(Math.atan2(z, x) / (Math.PI / 4)) * Math.PI / 4
  const dx = Math.round(Math.cos(angle)), dz = Math.round(Math.sin(angle))
  const run = snapValue((x * dx + z * dz) / (dx * dx + dz * dz), step)
  return [a[0] + dx * run, a[1] + dz * run]
}

export function blocksIntersect(a: Block, b: Block) {
  if (!a.yaw && !b.yaw) return overlap(a.rect, b.rect)
  const points = (block: Block) => SIDES.flatMap(side => rectEdge(block.rect, side)).map(point => framePoint(block, ...point))
  const left = points(a), right = points(b)
  for (const yaw of [a.yaw ?? 0, b.yaw ?? 0]) {
    for (const axis of [yaw, yaw + Math.PI / 2]) {
      const u = Math.cos(axis), v = Math.sin(axis)
      const l = left.map(([x, z]) => x * u - z * v)
      const r = right.map(([x, z]) => x * u - z * v)
      if (Math.min(Math.max(...l), Math.max(...r)) - Math.max(Math.min(...l), Math.min(...r)) <= EPS) return false
    }
  }
  return true
}

export function levelBounds(blocks: Block[]): Rect {
  const points = blocks.flatMap(b => SIDES.flatMap(s => rectEdge(b.rect, s)).map(([x, z]) => framePoint(b, x, z)))
  const xs = points.map(p => p[0]), zs = points.map(p => p[1])
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
}

export function covered(rect: Rect, cover: Rect[]) {
  return cover.reduce((pieces, cut) => pieces.flatMap(piece => subtractRect(piece, inset(cut, -EPS))), [rect])
    .every(piece => area(piece) < EPS * EPS)
}

export function hullRects(plan: HomePlan, level: string, frame?: string) {
  return blocksAt(plan, level).filter(b => b.yaw ? b.id === frame : !frame).map(b => b.rect)
}

export function segmentInHull(a: Point, b: Point, rects: Rect[]) {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]]
  const breaks = [0, 1]
  for (const r of rects) {
    if (Math.abs(dx) > EPS) breaks.push((r[0] - a[0]) / dx, (r[2] - a[0]) / dx)
    if (Math.abs(dz) > EPS) breaks.push((r[1] - a[1]) / dz, (r[3] - a[1]) / dz)
  }
  const cuts = breaks.filter(t => t >= 0 && t <= 1).sort((x, y) => x - y)
  return cuts.every((t, i) => {
    const m = (t + (cuts[i + 1] ?? t)) / 2
    return rects.some(r => inRect(r, a[0] + dx * m, a[1] + dz * m, -EPS))
  })
}

export function project(a: Point, b: Point, point: Point) {
  const length = distance(a, b)
  if (length < EPS) return { at: 0, d: distance(a, point), length }
  const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length
  const at = (point[0] - a[0]) * dx + (point[1] - a[1]) * dz
  const u = Math.max(0, Math.min(length, at))
  return { at, d: Math.hypot(point[0] - a[0] - u * dx, point[1] - a[1] - u * dz), length }
}

export function along(a: Point, b: Point, at: number): Point {
  const t = at / distance(a, b)
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export type Mount = { wall: string } | { block: string; side: Side }
export interface WallLine {
  mount: Mount
  a: Point
  b: Point
  level: string
  range: [number, number]
  neighbour?: string
  height(at: number): number
}
export function sameMount(a: Opening | Mount, b: Opening | Mount) {
  if ('wall' in a && a.wall) return 'wall' in b && a.wall === b.wall
  return 'block' in a && 'block' in b && a.block === b.block && a.side === b.side
}
export function wallLines(plan: HomePlan, level: string): WallLine[] {
  const blocks = blocksAt(plan, level)
  const comparable = blocks.map(block => block.level === undefined ? block : { ...block, level: undefined })
  const lines = comparable.flatMap(block => SIDES.flatMap(side => {
    const [a, b] = rectEdge(block.rect, side)
    return sideIntervals(block, side, comparable).intervals.map(iv => ({
      mount: { block: block.id, side },
      a: framePoint(block, ...a), b: framePoint(block, ...b), level, range: [iv.u0, iv.u1] as [number, number],
      neighbour: iv.neighbour?.id,
      height: (at: number) => {
        const point = along(a, b, at)
        return iv.neighbour
          ? Math.min(ceilingAt(block, ...point), ceilingAt(iv.neighbour, ...point))
          : roofHeightAt(block, ...point)
      },
    }))
  }))
  const partitions = plan.walls.filter(wall => levelId(plan, wall.level) === level).map(wall => {
    const frame = blocks.find(b => b.id === wall.frame)
    const local = blocks.filter(b => b.yaw ? b === frame : !frame)
    const length = distance(wall.a, wall.b)
    return {
      mount: { wall: wall.id }, a: framePoint(frame, ...wall.a), b: framePoint(frame, ...wall.b), level,
      range: [0, length] as [number, number],
      height: (at: number) => {
        const p = along(wall.a, wall.b, at)
        const cover = local.find(b => inRect(b.rect, ...p, -EPS))
        return cover ? ceilingAt(cover, ...p) : 2.65
      },
    }
  })
  return [...partitions, ...lines]
}

export const OPENING_CATALOG: { name: string; item: Pick<Opening, 'kind' | 'width' | 'height' | 'sill' | 'panes' | 'slide'> }[] = [
  { name: 'Egress-size window', item: { kind: 'window', width: 1.25, height: 1.25, sill: 0.85, panes: 1 } },
  { name: 'Picture window', item: { kind: 'fixed', width: 2.1, height: 1.55, sill: 0.65, panes: 2 } },
  { name: 'Swing door', item: { kind: 'door', width: 0.91, height: 2.08, sill: 0 } },
  { name: 'Entry door', item: { kind: 'entry', width: 1.05, height: 2.15, sill: 0 } },
  { name: 'Sliding glass door', item: { kind: 'slider', width: 2.4, height: 2.15, sill: 0, panes: 2, slide: 'right' } },
  { name: 'Garage door', item: { kind: 'garage', width: 2.75, height: 2.17, sill: 0 } },
]

export function supports(line: WallLine, kind: OpeningKind) {
  if ('wall' in line.mount) return kind === 'door'
  if (line.neighbour) return kind === 'door' || kind === 'entry'
  return true
}

export function doorSwing(plan: HomePlan, line: WallLine, at: number) {
  const [x, z] = along(line.a, line.b, at)
  const scale = 0.6 / distance(line.a, line.b)
  const dx = (line.b[0] - line.a[0]) * scale, dz = (line.b[1] - line.a[1]) * scale
  const roomAt = (side: number) => plan.rooms.find(room => levelId(plan, room.level) === line.level
    && inRect(room.rect, ...framePoint(plan.blocks.find(block => block.id === room.frame), x - dz * side, z + dx * side, true)))
  const front = roomAt(1), back = roomAt(-1)
  return front && back && area(back.rect) > area(front.rect) ? -1 : 1
}

export function openingFits(plan: HomePlan, line: WallLine, item: Opening, ignored?: Opening) {
  const margin = 'wall' in line.mount ? 0.12 : 0.18
  const lo = item.at - item.width / 2, hi = item.at + item.width / 2
  if (!supports(line, item.kind) || lo < line.range[0] + margin - EPS || hi > line.range[1] - margin + EPS) return false
  if ((item.sill ?? 0) + item.height > Math.min(line.height(lo), line.height(item.at), line.height(hi)) - 0.08) return false
  if (plan.walls.some(wall => {
    if (levelId(plan, wall.level) !== line.level || ('wall' in line.mount && wall.id === line.mount.wall)) return false
    const frame = plan.blocks.find(b => b.id === wall.frame)
    const a = framePoint(frame, ...wall.a), b = framePoint(frame, ...wall.b)
    const hit = crossing(line.a, line.b, a, b)
    const len = distance(line.a, line.b)
    return !!hit && hit.u >= -EPS && hit.u <= 1 + EPS && hit.t * len > lo - 0.07 && hit.t * len < hi + 0.07
  })) return false
  // Opposite sides of a party wall are the same physical opening host.
  const oppositeSide: Record<Side, Side> = { n: 's', s: 'n', w: 'e', e: 'w' }
  const reverse = 'side' in line.mount && line.neighbour ? blocksAt(plan, line.level).find(b => b.id === line.neighbour) : undefined
  const reverseSide = 'side' in line.mount ? oppositeSide[line.mount.side] : undefined
  const reverseAt = (o: Opening) => reverse && reverseSide
    ? project(line.a, line.b, along(...rectEdge(reverse.rect, reverseSide), o.at)).at : NaN
  return !plan.openings.some(o => {
    if (o === ignored) return false
    const at = sameMount(o, line.mount) ? o.at : reverse && o.block === reverse.id && o.side === reverseSide ? reverseAt(o) : NaN
    const mayCross = hi + 0.12 > at - o.width / 2 && lo - 0.12 < at + o.width / 2
    const vertical = (item.sill ?? 0) < (o.sill ?? 0) + o.height + 0.08 && (item.sill ?? 0) + item.height + 0.08 > (o.sill ?? 0)
    return mayCross && vertical
  })
}

export function mountOpening(plan: HomePlan, level: string, point: Point, item: Opening, step: number, radius: number, moving?: Opening) {
  const hits = wallLines(plan, level).filter(line => supports(line, item.kind) && (!moving || sameMount(moving, line.mount)))
    .map(line => ({ line, ...project(line.a, line.b, point) }))
    .filter(hit => (moving || hit.d <= radius) && hit.at >= hit.line.range[0] - radius && hit.at <= hit.line.range[1] + radius)
    .sort((a, b) => a.d - b.d)
  const next = hits[0]
  if (!next) return
  const margin = 'wall' in next.line.mount ? 0.12 : 0.18
  const min = Math.ceil((next.line.range[0] + margin + item.width / 2 - EPS) / step) * step
  const max = Math.floor((next.line.range[1] - margin - item.width / 2 + EPS) / step) * step
  if (min > max) return
  const candidate = { ...item, ...next.line.mount, at: snapValue(Math.min(max, Math.max(min, next.at)), step) }
  return openingFits(plan, next.line, candidate, moving) ? candidate : undefined
}

export function crossing(a: Point, b: Point, c: Point, d: Point) {
  const dx = b[0] - a[0], dz = b[1] - a[1], ex = d[0] - c[0], ez = d[1] - c[1]
  const den = dx * ez - dz * ex
  if (Math.abs(den) < 1e-8) return
  const x = c[0] - a[0], z = c[1] - a[1]
  return { t: (x * ez - z * ex) / den, u: (x * dz - z * dx) / den }
}

export function wallHitsRect(wall: InteriorWall, rect: Rect) {
  if (inRect(rect, ...wall.a) || inRect(rect, ...wall.b)) return true
  return SIDES.some(side => {
    const hit = crossing(wall.a, wall.b, ...rectEdge(rect, side))
    return hit && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1
  })
}

export function stairFits(plan: HomePlan, stair: Stair) {
  if (!stair.between) return true
  const flight = stairFlight(stair)
  const envelope = inset(flight.rect, -0.17)
  const { lower, upper } = stair.between
  const land = (p: Point) => [p[0] - 0.2, p[1] - 0.2, p[0] + 0.2, p[1] + 0.2] satisfies Rect
  const at = (x: number, level: string) => covered(land([stair.from[0] + flight.dx * x, stair.from[1] + flight.dz * x]), hullRects(plan, level))
  return covered(envelope, hullRects(plan, lower)) && covered(envelope, hullRects(plan, upper))
    && at(-0.7, upper) && at(flight.run + 0.65, lower)
    && !plan.walls.some(w => [lower, upper].includes(levelId(plan, w.level)) && !w.frame && wallHitsRect(w, envelope))
    && !plan.stairs.some(s => s.id !== stair.id && !!s.between && overlap(flight.rect, stairFlight(s).rect))
}
