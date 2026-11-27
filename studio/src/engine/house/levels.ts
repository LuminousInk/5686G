import * as THREE from 'three'
import { MeshBatch } from '../geo'
import type { Block, FloorLevel, HomePlan, Rect, Stair } from './types'
import type { Segment2 } from './walls'

export const MAIN_LEVEL: FloorLevel = { id: 'main', label: 'Main level', offset: 0 }

export function levelId(plan: HomePlan, id?: string) {
  return id ?? plan.levels?.[0]?.id ?? MAIN_LEVEL.id
}

export function levelFloor(plan: HomePlan, id?: string) {
  return plan.floorY + (plan.levels?.find(level => level.id === id)?.offset ?? 0)
}

export function levelAtHeight(plan: HomePlan, y: number) {
  return (plan.levels ?? [MAIN_LEVEL]).reduce((nearest, level) =>
    Math.abs(levelFloor(plan, level.id) - y) < Math.abs(levelFloor(plan, nearest) - y) ? level.id : nearest,
  levelId(plan))
}

export function framePoint(frame: Block | undefined, x: number, z: number, inverse = false): [number, number] {
  if (!frame?.yaw) return [x, z]
  const cx = (frame.rect[0] + frame.rect[2]) / 2
  const cz = (frame.rect[1] + frame.rect[3]) / 2
  const c = Math.cos(frame.yaw)
  const s = Math.sin(frame.yaw) * (inverse ? -1 : 1)
  return [cx + (x - cx) * c + (z - cz) * s, cz - (x - cx) * s + (z - cz) * c]
}

export function inRect(rect: Rect, x: number, z: number, inset = 0) {
  return x >= rect[0] + inset && x <= rect[2] - inset && z >= rect[1] + inset && z <= rect[3] - inset
}

export interface BuildingSection {
  plan: HomePlan
  level: string
  frame?: Block
}

/** Each section can use the rectangular shell and furniture builders in its own coordinate system. */
export function buildingSections(plan: HomePlan): BuildingSection[] {
  if (!plan.levels && !plan.blocks.some(b => b.yaw)) return [{ plan, level: MAIN_LEVEL.id }]
  const sections: BuildingSection[] = []
  for (const level of plan.levels ?? [MAIN_LEVEL]) {
    const blocks = plan.blocks.filter(b => levelId(plan, b.level) === level.id)
    const frames = blocks.filter(b => b.yaw)
    for (const frame of [undefined, ...frames]) {
      const localBlocks = frame ? [frame] : blocks.filter(b => !b.yaw)
      if (!localBlocks.length) continue
      const belongs = (item: { level?: string; frame?: string }) => levelId(plan, item.level) === level.id && item.frame === frame?.id
      const walls = plan.walls.filter(belongs)
      sections.push({
        level: level.id,
        frame,
        plan: {
          ...plan, floorY: levelFloor(plan, level.id), levels: undefined,
          blocks: localBlocks.map(b => ({ ...b, yaw: undefined, level: undefined })),
          rooms: plan.rooms.filter(belongs),
          walls,
          openings: plan.openings.filter(o => o.wall ? walls.some(w => w.id === o.wall) : localBlocks.some(b => b.id === o.block)),
        },
      })
    }
  }
  return sections
}

/** Rotate only new geometry, keeping the combined mesh batches and world-space lightmap coordinates. */
export function sectionBatch(batch: MeshBatch, frame?: Block) {
  if (!frame?.yaw) return batch
  const matrix = new THREE.Matrix4().makeRotationY(frame.yaw)
  const [x, z] = framePoint(frame, 0, 0)
  matrix.setPosition(x, 0, z)
  return new class extends MeshBatch {
    override add(mat: THREE.Material, geometry: THREE.BufferGeometry) {
      batch.add(mat, geometry.applyMatrix4(matrix))
    }
  }()
}

export function sectionColliders(colliders: Segment2[], section: BuildingSection, stacked: boolean) {
  const y = section.plan.floorY
  return colliders.map(segment => {
    const [ax, az] = framePoint(section.frame, segment.ax, segment.az)
    const [bx, bz] = framePoint(section.frame, segment.bx, segment.bz)
    return {
      ...segment, ax, az, bx, bz,
      bottom: segment.bottom ?? (stacked ? y - 0.25 : undefined),
      top: segment.top ?? (stacked ? y + 1.9 : undefined),
    }
  })
}

/** Direction and length to the bottom landing, and the footprint of the stair opening. */
export function stairFlight(stair: Stair) {
  const { from: [x, z], dir } = stair
  const dx = dir === 'e' ? 1 : dir === 'w' ? -1 : 0
  const dz = dir === 's' ? 1 : dir === 'n' ? -1 : 0
  const going = stair.going ?? 0.3
  const run = going * stair.steps
  const end: [number, number] = [x + dx * run, z + dz * run]
  const hx = Math.abs(dz) * stair.width / 2
  const hz = Math.abs(dx) * stair.width / 2
  const rect: Rect = [Math.min(x, end[0]) - hx, Math.min(z, end[1]) - hz, Math.max(x, end[0]) + hx, Math.max(z, end[1]) + hz]
  return { dx, dz, end, going, run, rect }
}

export function subtractRect(rect: Rect, cut: Rect): Rect[] {
  const [x0, z0, x1, z1] = rect
  const a = Math.max(x0, cut[0]), b = Math.min(x1, cut[2])
  const c = Math.max(z0, cut[1]), d = Math.min(z1, cut[3])
  if (a >= b || c >= d) return [rect]
  const pieces: Rect[] = [[x0, z0, a, z1], [b, z0, x1, z1], [a, z0, b, c], [a, d, b, z1]]
  return pieces.filter(r => r[2] > r[0] && r[3] > r[1])
}
