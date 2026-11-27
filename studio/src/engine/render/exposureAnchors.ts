import * as THREE from 'three'
import { roomEdge, type RoomVolume } from '../env/roomVolumes'
import { framePoint, inRect, levelFloor, levelId } from '../house/levels'
import { roofHeightAt, SIDES, sideIntervals } from '../house/massing'
import type { HomePlan, RoomType } from '../house/types'

const ROOM_EV: Partial<Record<RoomType, number>> = {
  hall: 0.46, closet: 0.46, mudroom: 0.28, bath: 0.18, powder: 0.26,
  living: -0.24, dining: -0.14, primary: -0.08, kitchen: -0.12, garage: 0.08,
}

const PLAN_EV: Record<string, Record<string, number>> = {
  'cedar-ridge': { great: -0.35, primary: -0.25, kitchen: -0.1 },
  'coastal-modern': { living: -0.38, primary: -0.13, kitchen: -0.20 },
}

/** Blend room biases over the threshold, in stops. */
export function roomExposureEV(planId: string, volumes: RoomVolume[], point: THREE.Vector3) {
  let weight = 0
  let ev = 0
  for (const v of volumes) {
    if (point.y < v.floor || point.y > v.floor + v.half.y * 2) continue
    const w = THREE.MathUtils.smoothstep(roomEdge(v, point), -0.65, 0.65)
    if (!w) continue
    const bias = PLAN_EV[planId]?.[v.room.id] ?? ROOM_EV[v.room.type] ?? 0
    weight += w
    ev += w * bias
  }
  return ev / Math.max(weight, 1)
}

function exposureBlocks(plan: HomePlan) {
  return plan.blocks.map(block => ({
    block,
    floor: levelFloor(plan, levelId(plan, block.level)),
    sides: SIDES.map(side => sideIntervals(block, side, plan.blocks)),
  }))
}

const footprints = new WeakMap<HomePlan, ReturnType<typeof exposureBlocks>>()

/** Fade to the exterior along the envelope, including the distance to the ends of shared walls. */
export function interiorExposureWeight(plan: HomePlan, point: THREE.Vector3) {
  let blocks = footprints.get(plan)
  if (!blocks) {
    blocks = exposureBlocks(plan)
    footprints.set(plan, blocks)
  }
  let distance = Infinity
  let inside = false
  for (const { block, floor, sides } of blocks) {
    const [x, z] = framePoint(block, point.x, point.z, true)
    const [x0, z0, x1, z1] = block.rect
    const h = roofHeightAt(block, THREE.MathUtils.clamp(x, x0, x1), THREE.MathUtils.clamp(z, z0, z1))
    if (point.y < floor || point.y >= floor + h) continue
    inside ||= inRect(block.rect, x, z)
    for (const { frame, intervals } of sides) {
      const dx = x - frame.sx
      const dz = z - frame.sz
      const along = dx * frame.dx + dz * frame.dz
      for (const { u0, u1, neighbour } of intervals) {
        const u = THREE.MathUtils.clamp(along, u0, u1)
        const ex = frame.sx + frame.dx * u
        const ez = frame.sz + frame.dz * u
        if (neighbour && point.y < floor + roofHeightAt(neighbour, ex, ez)) continue
        const d2 = (x - ex) ** 2 + (z - ez) ** 2
        distance = Math.min(distance, d2)
      }
    }
  }
  return THREE.MathUtils.smoothstep(Math.sqrt(distance) * (inside ? 1 : -1), -0.65, 0.65)
}

/** A mostly metered exposure, bounded around the room anchor and blended in exposure stops. */
export function anchoredExposure(meter: number, base: number, biasEV: number, interiorWeight: number) {
  const anchor = Math.log2(base) + biasEV
  const metered = meter > 0 ? Math.log2(meter) + biasEV : anchor
  const blended = THREE.MathUtils.lerp(anchor, THREE.MathUtils.clamp(metered, anchor - 1.8, anchor + 2.5), 0.83)
  return 2 ** (blended * interiorWeight)
}
