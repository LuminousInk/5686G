import * as THREE from 'three'
import { roomEdge, roomVolumes } from '../env/roomVolumes'
import { framePoint, inRect, levelFloor, levelId } from '../house/levels'
import { sideFrame } from '../house/massing'
import type { HomePlan } from '../house/types'
import type { SurfaceBudget } from './lightmapUV'

export const FLOOR_RECEIVERS = new Set(['floor', 'tileFloor', 'concrete'])

export function surfaceBudgets(plan: HomePlan) {
  const rooms = roomVolumes(plan)
  const quiet = rooms.filter(v => v.room.type === 'closet' || v.room.type === 'garage')
  const floorYs = [...new Set(plan.blocks.map(b => levelFloor(plan, levelId(plan, b.level))))]
  const wallCuts = floorYs.flatMap(y => [y + 0.55, y + 2.15].map(h => new THREE.Plane(new THREE.Vector3(0, 1, 0), -h)))
  const blocks = plan.blocks.map(block => {
    const floor = levelFloor(plan, levelId(plan, block.level))
    const glazing = plan.openings.filter(o => o.block === block.id && o.side && ['fixed', 'slider', 'window'].includes(o.kind))
    const frame = (x: number, z: number) => framePoint(block, x, z)
    const plane = (x: number, z: number, nx: number, nz: number) => {
      const [wx, wz] = frame(x, z)
      const [ex, ez] = frame(x + nx, z + nz)
      return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(ex - wx, 0, ez - wz), new THREE.Vector3(wx, 0, wz))
    }
    // A strip across each glazed side avoids cutting a new lightmap seam for every window mullion.
    const bands = [...new Set(glazing.map(o => o.side!))].map(side => {
      const f = sideFrame(block.rect, side)
      return plane(f.sx - f.ox * 1.8, f.sz - f.oz * 1.8, f.ox, f.oz)
    })
    const closetCuts = quiet.filter(v => v.room.type === 'closet' && v.floor === floor
      && inRect(block.rect, ...framePoint(block, v.center.x, v.center.z, true)))
      .flatMap(v => {
        const [x0, z0, x1, z1] = v.room.rect
        return [plane(x0, z0, 1, 0), plane(x1, z1, 1, 0), plane(x0, z0, 0, 1), plane(x1, z1, 0, 1)]
      })
    return { block, floor, bands, cuts: [...bands, ...closetCuts] }
  })
  const floorBlock = (p: THREE.Vector3) => blocks.find(({ block, floor }) => Math.abs(p.y - floor) < 0.08
    && inRect(block.rect, ...framePoint(block, p.x, p.z, true), -0.02))
  const insideQuiet = (p: THREE.Vector3) => quiet.some(v => p.y >= v.floor - 0.02 && p.y <= v.floor + v.half.y * 2
    && roomEdge(v, p) >= -0.035)

  return (mesh: THREE.Mesh): SurfaceBudget => {
    const name = (mesh.material as THREE.Material).name
    if (name === 'ceiling' || name === 'ceilingWood') return { weight: () => 0.23 }
    if (FLOOR_RECEIVERS.has(name)) return {
      cuts: p => floorBlock(p)?.cuts ?? [],
      weight: (p, n) => {
        const block = floorBlock(p)
        if (n.y < 0.8 || block?.block.utility || insideQuiet(p)) return 0.23
        return block?.bands.some(plane => plane.distanceToPoint(p) > 0) ? 1 : 0.56
      },
    }
    if (name === 'zone:walls' || name === 'tileWall') {
      const face = new THREE.Vector3()
      return {
        cuts: () => wallCuts,
        weight: (p, n) => {
          face.copy(p).addScaledVector(n, 0.08)
          if (Math.abs(n.y) > 0.65 || insideQuiet(face)) return 0.23
          const floor = Math.max(...floorYs.filter(y => y <= p.y + 0.02))
          const h = p.y - floor
          return h > 2.15 ? 0.32 : h < 0.55 ? 0.65 : 1
        },
      }
    }
    // Countertops, cabinet fronts, bath built-ins. Shave texels from undersides and deeply recessed faces.
    return { weight: (_, n) => n.y < -0.65 ? 0.3 : 1 }
  }
}
