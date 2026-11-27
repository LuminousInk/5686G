import type * as THREE from 'three'
import { buildingSections, framePoint, sectionColliders } from './levels'
import type { HomePlan } from './types'
import type { Segment2 } from './walls'

interface FurnishedSection {
  group: THREE.Group
  colliders: Segment2[]
  lightSpots: THREE.Vector3[]
}

export async function buildInteriorLevels(
  plan: HomePlan,
  interior: FurnishedSection,
  colliders: readonly Segment2[],
  furnish: (local: HomePlan, barriers: readonly Segment2[]) => Promise<FurnishedSection>,
) {
  for (const section of buildingSections(plan)) {
    const floor = section.plan.floorY
    const barriers = colliders.filter(s => floor >= (s.bottom ?? -Infinity) && floor < (s.top ?? Infinity))
    const child = await furnish(section.plan, barriers.map(s => {
      const [ax, az] = framePoint(section.frame, s.ax, s.az, true)
      const [bx, bz] = framePoint(section.frame, s.bx, s.bz, true)
      return { ...s, ax, az, bx, bz }
    }))
    const [x, z] = framePoint(section.frame, 0, 0)
    child.group.position.set(x, 0, z)
    child.group.rotation.y = section.frame?.yaw ?? 0
    child.group.userData.cutawayFloor = floor
    interior.group.add(child.group)
    interior.colliders.push(...sectionColliders(child.colliders, section, !!plan.levels))
    interior.lightSpots.push(...child.lightSpots.map(p => child.group.localToWorld(p)))
  }
}
