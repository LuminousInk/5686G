import * as THREE from 'three'
import { MeshBatch } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { buildInteriorShell } from './interiorShell'
import { blockAt } from './massing'
import { buildOutdoor } from './outdoor'
import { buildRoofs } from './roofs'
import type { HomePlan } from './types'
import { buildExteriorWalls, type Segment2 } from './walls'

export interface HouseModel {
  plan: HomePlan
  group: THREE.Group
  /** sub-groups toggled by view modes (dollhouse hides roof + ceilings) */
  roof: THREE.Group
  ceilings: THREE.Group
  shell: THREE.Group
  outdoor: THREE.Group
  interior: THREE.Group
  colliders: Segment2[]
  /** height of walkable floor at x,z, or null when on open ground */
  floorAt(x: number, z: number): number | null
  sconces: THREE.Vector3[]
  downlights: THREE.Vector3[]
  bounds: THREE.Box3
  dispose(): void
}

export function buildHouse(plan: HomePlan, lib: MaterialLibrary): HouseModel {
  const shellBatch = new MeshBatch()
  const roofBatch = new MeshBatch()
  const ceilBatch = new MeshBatch()
  const outBatch = new MeshBatch()
  const intBatch = new MeshBatch()

  const walls = buildExteriorWalls(plan, lib, shellBatch)
  const roofs = buildRoofs(plan, lib, roofBatch, ceilBatch)
  const outdoor = buildOutdoor(plan, lib, outBatch, roofBatch)
  const interior = buildInteriorShell(plan, lib, intBatch)

  const group = new THREE.Group()
  group.name = `house:${plan.id}`
  const shell = shellBatch.toGroup('shell', { tag: { nav: 'wall' } })
  const roof = roofBatch.toGroup('roof')
  const ceilings = ceilBatch.toGroup('ceilings', { cast: true })
  const out = outBatch.toGroup('outdoor')
  const inner = intBatch.toGroup('interior')
  group.add(shell, roof, ceilings, out, inner)
  // glass never casts shadows (sun streams through windows); shadow-only blockers never draw or receive
  group.traverse(o => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const name = (m.material as THREE.Material).name
    if (name === 'glass') {
      m.castShadow = false
      m.renderOrder = 2
    } else if (name === 'shadow-only') {
      m.receiveShadow = false
      m.userData.shadowOnly = true
    }
  })

  const walkables = outdoor.walkables
  const floorAt = (x: number, z: number): number | null => {
    if (blockAt(plan.blocks, x, z)) return plan.floorY
    for (const w of walkables) {
      const [x0, z0, x1, z1] = w.rect
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return w.height(x, z)
    }
    return null
  }

  const bounds = new THREE.Box3().setFromObject(group)
  return {
    plan,
    group,
    roof,
    ceilings,
    shell,
    outdoor: out,
    interior: inner,
    colliders: [...walls.colliders, ...interior.colliders, ...outdoor.colliders],
    floorAt,
    sconces: walls.sconces,
    downlights: [...roofs.downlights, ...outdoor.downlights],
    bounds,
    dispose() {
      group.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) m.geometry.dispose()
      })
    },
  }
}
