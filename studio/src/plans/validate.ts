// Checks a plan for mistakes the 3D builder would hide instead of report: openings it skips, overlapping
// volumes, rooms outside the walls, finishes missing from the catalog. Used by the tests; an empty list means fine.
import type { HomePlan, Opening } from '../engine/house/types'
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

  for (const z of plan.zones) {
    const zone = ZONES[z]
    if (!zone) out.push(`finish zone "${z}" is not in the catalog`)
    else if (plan.finishes[z] !== undefined && !zone.options.some(o => o.id === plan.finishes[z]))
      out.push(`finish "${plan.finishes[z]}" is not an option of zone "${z}"`)
  }
  for (const b of plan.blocks)
    for (const spec of Object.values(b.cladding))
      if (spec && !ZONES[spec.zone]) out.push(`block "${b.id}" is clad in zone "${spec.zone}", which is not in the catalog`)

  // volumes may touch but not overlap
  for (let i = 0; i < plan.blocks.length; i++)
    for (let j = i + 1; j < plan.blocks.length; j++) {
      const a = plan.blocks[i].rect
      const c = plan.blocks[j].rect
      if (Math.min(a[2], c[2]) - Math.max(a[0], c[0]) > TOL && Math.min(a[3], c[3]) - Math.max(a[1], c[1]) > TOL)
        out.push(`blocks "${plan.blocks[i].id}" and "${plan.blocks[j].id}" overlap`)
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
    const { frame, intervals } = sideIntervals(b, o.side, plan.blocks)
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

  for (const r of plan.rooms) {
    const [x0, z0, x1, z1] = r.rect
    const pts: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]
    if (pts.some(([x, z]) => !blockAt(plan.blocks, x, z))) out.push(`room "${r.id}" reaches outside the house`)
  }
  return out
}
