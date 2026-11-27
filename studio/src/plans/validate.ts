// Checks a plan for mistakes the 3D builder would hide instead of report: openings it skips, overlapping
// volumes, rooms outside the walls, finishes missing from the catalog. Used by the tests; an empty list means fine.
import type { Block, HomePlan, Opening } from '../engine/house/types'
import { buildingSections, framePoint, levelFloor, levelId, stairFlight } from '../engine/house/levels'
import { blockAt, roofHeightAt, roofThickness, sideIntervals, sidePoint } from '../engine/house/massing'
import { ZONES } from '../engine/materials/catalog'

const TOL = 1e-3

function label(o: Opening) {
  return o.id ?? `${o.kind} at ${o.at} on ${o.block ?? o.wall}${o.side ? `/${o.side}` : ''}`
}

/** Problems that would make part of a plan disappear or look wrong in 3D (empty = fine). */
export function planProblems(plan: HomePlan): string[] {
  const out: string[] = []
  const unique = (kind: string, ids: string[]) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) out.push(`${kind} id "${id}" is used twice`)
      seen.add(id)
    }
  }
  unique('block', plan.blocks.map(b => b.id))
  unique('wall', plan.walls.map(w => w.id))
  unique('room', plan.rooms.map(r => r.id))
  unique('view', plan.views.map(v => v.id))
  unique('level', plan.levels?.map(l => l.id) ?? [])
  unique('stair', plan.stairs.map(s => s.id))

  for (const z of plan.zones) {
    const zone = ZONES[z]
    if (!zone) out.push(`finish zone "${z}" is not in the catalog`)
    else if (plan.finishes[z] !== undefined && !zone.options.some(o => o.id === plan.finishes[z]))
      out.push(`finish "${plan.finishes[z]}" is not an option of zone "${z}"`)
  }
  for (const b of plan.blocks)
    for (const spec of Object.values(b.cladding))
      if (spec && !ZONES[spec.zone]) out.push(`block "${b.id}" is clad in zone "${spec.zone}", which is not in the catalog`)

  const levels = plan.levels ?? [{ id: levelId(plan), offset: 0 }]
  if (levels[0]?.offset !== 0) out.push('The main level must have a zero floor offset')
  if (new Set(levels.map(l => l.offset)).size !== levels.length || !levels.every(l => Number.isFinite(l.offset)))
    out.push('Floor levels need distinct, finite floor offsets')
  const knownLevel = (id?: string) => levels.some(l => l.id === levelId(plan, id))
  for (const b of plan.blocks) {
    if (!knownLevel(b.level)) out.push(`block "${b.id}" has an unknown level`)
    if (!Number.isFinite(b.yaw ?? 0)) out.push(`block "${b.id}" has an invalid rotation`)
  }
  for (const item of [...plan.rooms, ...plan.walls]) {
    if (!knownLevel(item.level)) out.push(`"${item.id}" has an unknown level`)
    if (item.frame && !plan.blocks.some(b => b.id === item.frame && b.yaw && levelId(plan, b.level) === levelId(plan, item.level)))
      out.push(`"${item.id}" has no rotated block on its level`)
  }
  // Volumes may touch on one level and stack on separate levels.
  for (let i = 0; i < plan.blocks.length; i++)
    for (let j = i + 1; j < plan.blocks.length; j++) {
      const a = plan.blocks[i], b = plan.blocks[j]
      if (levelId(plan, a.level) === levelId(plan, b.level) && overlap(a, b))
        out.push(`blocks "${a.id}" and "${b.id}" overlap`)
    }
  for (const s of plan.stairs) {
    const pair = s.between
    if (!pair) continue
    if (!knownLevel(pair.upper) || !knownLevel(pair.lower) || !pair.upper || !pair.lower) {
      out.push(`stair "${s.id}" has an unknown level`)
      continue
    }
    if (s.rise <= 0 || Math.abs(levelFloor(plan, pair.upper) - levelFloor(plan, pair.lower) - s.rise) > TOL)
      out.push(`stair "${s.id}" rise does not match its levels`)
    if (!Number.isInteger(s.steps) || s.steps < 1 || !(s.width > 0 && (s.going ?? 0.3) > 0)) {
      out.push(`stair "${s.id}" has invalid dimensions`)
      continue
    }
    const { dx, dz, end } = stairFlight(s)
    const atLevel = (id: string, x: number, z: number) => blockAt(plan.blocks.filter(b => levelId(plan, b.level) === id && !b.yaw), x, z)
    if (!atLevel(pair.upper, s.from[0] - dx * 0.25, s.from[1] - dz * 0.25) ||
        !atLevel(pair.lower, end[0] + dx * 0.25, end[1] + dz * 0.25))
      out.push(`stair "${s.id}" has a landing outside its level`)
  }
  const sections = buildingSections(plan)

  // Intersecting holes on one face can make the wall triangulator fill the openings.
  for (let i = 0; i < plan.openings.length; i++) {
    const a = plan.openings[i]
    for (const b of plan.openings.slice(i + 1)) {
      if (a.wall ? a.wall !== b.wall : a.block !== b.block || a.side !== b.side) continue
      const ay = a.sill ?? 0
      const by = b.sill ?? 0
      if (Math.abs(a.at - b.at) < (a.width + b.width) / 2 - TOL &&
          Math.min(ay + a.height, by + b.height) - Math.max(ay, by) > TOL)
        out.push(`${label(a)} overlaps ${label(b)}`)
    }
  }

  for (const o of plan.openings) {
    const name = label(o)
    if (o.wall) {
      const w = plan.walls.find(x => x.id === o.wall)
      if (!w) {
        out.push(`${name}: wall "${o.wall}" does not exist`)
        continue
      }
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
      if (o.at - o.width / 2 < -TOL || o.at + o.width / 2 > len + TOL)
        out.push(`${name}: runs past the ends of wall "${w.id}" (${len.toFixed(2)} m long)`)
      continue
    }
    const b = plan.blocks.find(x => x.id === o.block)
    if (!b || !o.side) {
      out.push(`${name}: block "${o.block}" or its side is missing`)
      continue
    }
    // walls.ts cuts an opening only when it fits one wall piece; anything else is silently left out
    const section = sections.find(s => s.plan.blocks.some(other => other.id === b.id))
    if (!section) continue
    const { frame, intervals } = sideIntervals(b, o.side, section.plan.blocks)
    const u0 = o.at - o.width / 2
    const u1 = o.at + o.width / 2
    const piece = intervals.find(iv => u0 >= iv.u0 - TOL && u1 <= iv.u1 + TOL)
    if (!piece) {
      out.push(`${name}: does not fit one stretch of wall (side is ${frame.length.toFixed(2)} m, joins at ${intervals.map(iv => iv.u1.toFixed(2)).join(', ')})`)
      continue
    }
    const sill = o.sill ?? 0
    for (const u of [u0, u1]) {
      const [x, z] = sidePoint(frame, u)
      const top = roofHeightAt(b, x, z)
      if (sill + o.height > top + TOL) {
        out.push(`${name}: its top (${(sill + o.height).toFixed(2)} m) is above the roof (${top.toFixed(2)} m)`)
        break
      }
      if (piece.neighbour) {
        const roof = roofHeightAt(piece.neighbour, x, z) + roofThickness(piece.neighbour.roof)
        if (sill < roof - TOL) {
          out.push(`${name}: sits on the wall shared with "${piece.neighbour.id}", below its roof`)
          break
        }
      }
    }
  }

  for (const section of sections) for (const r of section.plan.rooms) {
    const [x0, z0, x1, z1] = r.rect
    const pts: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]
    if (pts.some(([x, z]) => !blockAt(section.plan.blocks, x, z))) out.push(`room "${r.id}" reaches outside its level or block`)
  }
  return out
}

function overlap(a: Block, b: Block) {
  const corners = (block: Block) => {
    const [x0, z0, x1, z1] = block.rect
    return [framePoint(block, x0, z0), framePoint(block, x1, z0), framePoint(block, x1, z1), framePoint(block, x0, z1)]
  }
  const p = corners(a), q = corners(b)
  return [a.yaw ?? 0, (a.yaw ?? 0) + Math.PI / 2, b.yaw ?? 0, (b.yaw ?? 0) + Math.PI / 2].every(angle => {
    const project = ([x, z]: [number, number]) => x * Math.cos(angle) - z * Math.sin(angle)
    const u = p.map(project), v = q.map(project)
    return Math.min(Math.max(...u), Math.max(...v)) - Math.max(Math.min(...u), Math.min(...v)) > TOL
  })
}
