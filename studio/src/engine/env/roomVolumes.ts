import * as THREE from 'three'
import { framePoint, levelFloor, levelId } from '../house/levels'
import { ceilingAt } from '../house/massing'
import type { HomePlan, RoomDef } from '../house/types'

export interface RoomVolume {
  room: RoomDef
  center: THREE.Vector3
  half: THREE.Vector3
  rotation: THREE.Vector2
  floor: number
}

export function roomVolumes(plan: HomePlan, fitVaults = false): RoomVolume[] {
  return plan.rooms.map(room => {
    const [x0, z0, x1, z1] = room.rect
    const x = (x0 + x1) / 2
    const z = (z0 + z1) / 2
    const frame = plan.blocks.find(b => b.id === room.frame)
    const block = frame ?? plan.blocks.find(b => !b.yaw && levelId(plan, b.level) === levelId(plan, room.level)
      && x >= b.rect[0] && x <= b.rect[2] && z >= b.rect[1] && z <= b.rect[3])
    const [wx, wz] = framePoint(frame, x, z)
    const floor = levelFloor(plan, levelId(plan, room.level))
    let h = block ? ceilingAt(block, x, z) : 2.7
    if (block && fitVaults) {
      for (const rx of [x0, x1]) for (const rz of [z0, z1]) {
        h = Math.max(h, ceilingAt(block, THREE.MathUtils.clamp(rx, block.rect[0], block.rect[2]),
          THREE.MathUtils.clamp(rz, block.rect[1], block.rect[3])))
      }
    }
    const yaw = frame?.yaw ?? 0
    return {
      room, floor,
      center: new THREE.Vector3(wx, floor + h / 2, wz),
      half: new THREE.Vector3((x1 - x0) / 2, h / 2, (z1 - z0) / 2),
      rotation: new THREE.Vector2(Math.cos(yaw), Math.sin(yaw)),
    }
  })
}

export function roomEdge(volume: RoomVolume, point: THREE.Vector3): number {
  const x = point.x - volume.center.x
  const z = point.z - volume.center.z
  const { x: c, y: s } = volume.rotation
  return Math.min(volume.half.x - Math.abs(c * x - s * z), volume.half.z - Math.abs(s * x + c * z))
}
