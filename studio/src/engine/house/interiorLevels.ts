import type * as THREE from 'three'
import type { MeshBatch } from '../geo'
import { buildingSections, framePoint, sectionBatch, sectionColliders } from './levels'
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
  batch: MeshBatch,
  furnish: (local: HomePlan, batch: MeshBatch) => Promise<FurnishedSection>,
) {
  // Build in section order so the shared built-in mesh layout is stable for lightmap baking.
  for (const section of buildingSections(plan)) {
    const child = await furnish(section.plan, sectionBatch(batch, section.frame))
    const [x, z] = framePoint(section.frame, 0, 0)
    child.group.position.set(x, 0, z)
    child.group.rotation.y = section.frame?.yaw ?? 0
    interior.group.add(child.group)
    interior.colliders.push(...sectionColliders(child.colliders, section, !!plan.levels))
    interior.lightSpots.push(...child.lightSpots.map(p => child.group.localToWorld(p)))
  }
  interior.group.add(batch.toGroup('built-ins'))
}
