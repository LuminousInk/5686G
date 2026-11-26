// Pure plan edits used by the editor (no React, no three.js scene), so they can be unit tested.
import type { Block, HomePlan, Side } from '../engine/house/types'
import { sideFrame } from '../engine/house/massing'

export const SNAP = 0.1
export const snap = (v: number) => Math.round(v / SNAP) * SNAP
export const clone = (p: HomePlan): HomePlan => JSON.parse(JSON.stringify(p))
/** edges closer than this are treated as the same line */
export const EPS = 0.02
/** smallest block width or depth the editor allows (m) */
export const MIN_BLOCK = 2

/** Length of one side of a block. */
export function sideLen(b: Block, s: Side) {
  return sideFrame(b.rect, s).length
}

/** Resize one edge of a block; touching neighbours, rooms and wall ends on the same line move with it. */
export function moveBlockEdge(plan: HomePlan, id: string, side: Side, value: number): HomePlan {
  const p = clone(plan)
  const b = p.blocks.find(x => x.id === id)!
  const axis = side === 'w' || side === 'e' ? 0 : 1
  const idx = side === 'w' ? 0 : side === 'n' ? 1 : side === 'e' ? 2 : 3
  const old = b.rect[idx]
  const other = b.rect[idx === 0 ? 2 : idx === 2 ? 0 : idx === 1 ? 3 : 1]
  const lo = idx < 2
  const v = lo ? Math.min(value, other - MIN_BLOCK) : Math.max(value, other + MIN_BLOCK)
  const delta = v - old
  if (Math.abs(delta) < 1e-6) return plan
  for (const blk of p.blocks) {
    for (let k = axis; k < 4; k += 2) {
      if (Math.abs(blk.rect[k] - old) < EPS) {
        // keep openings where they are when the start edge (west / north) moves
        if (k === 0 || k === 1) {
          const sides: Side[] = k === 0 ? ['n', 's'] : ['e', 'w']
          for (const o of p.openings) if (o.block === blk.id && sides.includes(o.side!)) o.at -= delta
        }
        blk.rect[k] = v
      }
    }
  }
  for (const r of p.rooms) for (let k = axis; k < 4; k += 2) if (Math.abs(r.rect[k] - old) < EPS) r.rect[k] = v
  for (const w of p.walls) {
    if (Math.abs(w.a[axis] - old) < EPS) w.a[axis] = v
    if (Math.abs(w.b[axis] - old) < EPS) w.b[axis] = v
  }
  // keep openings inside their sides
  p.openings = p.openings.filter(o => {
    if (!o.block) return true
    const blk = p.blocks.find(x => x.id === o.block)
    if (!blk) return false
    const len = sideLen(blk, o.side!)
    if (o.width > len - 0.3) return false
    o.at = Math.min(Math.max(o.at, o.width / 2 + 0.15), len - o.width / 2 - 0.15)
    return true
  })
  return p
}
