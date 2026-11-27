import * as THREE from 'three'
import { MeshBatch } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { Cutaway } from './cutaway'
import { buildInteriorShell } from './interiorShell'
import { buildingSections, framePoint, inRect, levelFloor, sectionBatch, sectionColliders, stairFlight } from './levels'
import { blockAt } from './massing'
import { buildOutdoor } from './outdoor'
import { buildRoofs } from './roofs'
import type { BuiltDoor, HomePlan } from './types'
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
  cutaway: Cutaway
  colliders: Segment2[]
  /** height of walkable floor at x,z, or null when on open ground */
  floorAt(x: number, z: number, nearY?: number): number | null
  doors: BuiltDoor[]
  sconces: THREE.Vector3[]
  downlights: THREE.Vector3[]
  bounds: THREE.Box3
  dispose(): void
}

export function buildHouse(plan: HomePlan, lib: MaterialLibrary): HouseModel {
  const cutaway = new Cutaway()
  const shellBatch = cutaway.batch()
  const roofBatch = new MeshBatch()
  const ceilBatch = new MeshBatch()
  const outBatch = cutaway.batch()
  const intBatch = cutaway.batch()

  const colliders: Segment2[] = []
  const sconces: THREE.Vector3[] = []
  const downlights: THREE.Vector3[] = []
  const doors: BuiltDoor[] = []
  const stairs = plan.stairs.filter(s => s.between)
  for (const section of buildingSections(plan)) {
    const local = section.plan
    const floorCuts = section.frame ? [] : stairs.filter(s => s.between?.upper === section.level).map(s => stairFlight(s).rect)
    const roofCuts = section.frame ? [] : stairs.filter(s => s.between?.lower === section.level).map(s => stairFlight(s).rect)
    const walls = buildExteriorWalls(local, lib, sectionBatch(shellBatch, section.frame), !!plan.levels, cutaway.section(shellBatch, local.floorY, section.frame))
    const roofs = buildRoofs(local, lib, sectionBatch(roofBatch, section.frame), sectionBatch(ceilBatch, section.frame), roofCuts)
    const interior = buildInteriorShell(local, lib, sectionBatch(intBatch, section.frame), floorCuts, cutaway.section(intBatch, local.floorY, section.frame))
    colliders.push(...sectionColliders([...walls.colliders, ...interior.colliders], section, !!plan.levels))
    doors.push(...[...walls.doors, ...interior.doors].map(d => ({ ...d, openingIndex: plan.openings.indexOf(local.openings[d.openingIndex]) })))
    for (const [from, to] of [[walls.sconces, sconces], [roofs.downlights, downlights]])
      for (const p of from) {
        const [x, z] = framePoint(section.frame, p.x, p.z)
        to.push(p.set(x, p.y, z))
      }
  }
  const outdoor = buildOutdoor(plan, lib, outBatch, roofBatch, height => {
    outBatch.section = height === undefined ? undefined : cutaway.floor(height)
  })

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

  const simple = !plan.levels && !plan.blocks.some(b => b.yaw)
  const blockFloors = plan.blocks.map(block => ({ block, y: levelFloor(plan, block.level) }))
  const floorAt = (x: number, z: number, nearY = plan.floorY): number | null => {
    if (simple) {
      if (blockAt(plan.blocks, x, z)) return plan.floorY
      return outdoor.walkables.find(w => inRect(w.rect, x, z))?.height(x, z) ?? null
    }
    let best: number | null = null
    const consider = (y: number) => { if (best === null || Math.abs(y - nearY) < Math.abs(best - nearY)) best = y }
    for (const { block: b, y } of blockFloors) {
      const [px, pz] = framePoint(b, x, z, true)
      if (inRect(b.rect, px, pz, -1e-6)) consider(y)
    }
    for (const w of outdoor.walkables) {
      const [px, pz] = framePoint(w.frame, x, z, true)
      if (!inRect(w.rect, px, pz)) continue
      const y = w.height(px, pz)
      if (w.between) return y
      consider(y)
    }
    return best
  }

  const bounds = new THREE.Box3().setFromObject(group)
  for (const [batch, meshGroup] of [[shellBatch, shell], [intBatch, inner], [outBatch, out]] as const) batch.tag(meshGroup)
  cutaway.attach(shell, inner, out)
  group.add(cutaway.group)
  return {
    plan,
    group,
    roof,
    ceilings,
    shell,
    outdoor: out,
    interior: inner,
    cutaway,
    colliders: [...colliders, ...outdoor.colliders],
    doors,
    floorAt,
    sconces,
    downlights: [...downlights, ...outdoor.downlights],
    bounds,
    dispose() {
      cutaway.dispose()
      for (const root of [shell, roof, ceilings, out, inner]) root.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) m.geometry.dispose()
      })
    },
  }
}
