import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PLANS } from '../../plans'
import type { MaterialLibrary } from '../materials/library'
import { buildHouse } from './build'
import { framePoint, levelFloor } from './levels'
import { sideFrame, sidePoint, WALL_T } from './massing'
import type { HomePlan, Opening } from './types'

const DOOR_KINDS = new Set(['door', 'entry', 'slider', 'garage'])
const DOOR_MATERIALS = new Set(['ceiling', 'cabinet', 'blackMetal', 'trim', 'door', 'glass', 'steel'])
const HALF_DEPTH = 0.4

function testMaterials() {
  const materials = new Map<string, THREE.Material>()
  const material = (name: string) => {
    if (!materials.has(name)) materials.set(name, new THREE.MeshStandardMaterial({ name }))
    return materials.get(name)!
  }
  const lib = new Proxy({ zone: material, lamp: material }, {
    get: (target, key) => Reflect.get(target, key) ?? material(String(key)),
  }) as unknown as MaterialLibrary
  return { lib, materials }
}

function doorwayRays(plan: HomePlan, op: Opening) {
  const wall = plan.walls.find(w => w.id === op.wall)
  const block = plan.blocks.find(b => b.id === (op.block ?? wall?.frame))
  const floor = levelFloor(plan, wall?.level ?? block?.level)
  const centerline = (u: number, depth: number) => {
    if (wall) {
      const dx = wall.b[0] - wall.a[0]
      const dz = wall.b[1] - wall.a[1]
      const length = Math.hypot(dx, dz)
      return framePoint(block, wall.a[0] + (u * dx - depth * dz) / length, wall.a[1] + (u * dz + depth * dx) / length)
    }
    if (!block || !op.side) throw new Error('Doorway must have a host wall or block side')
    const [x, z] = sidePoint(sideFrame(block.rect, op.side), u, WALL_T / 2 + depth)
    return framePoint(block, x, z)
  }
  const nearJamb = 0.03 / op.width
  const widths = [nearJamb, 0.1, 0.3, 0.5, 0.7, 0.9, 1 - nearJamb]
  return [0.3, 1, 1.8].flatMap(height => widths.flatMap(width => {
    const u = op.at + (width - 0.5) * op.width
    return [-1, 1].map(side => {
      const [ax, az] = centerline(u, side * HALF_DEPTH)
      const [bx, bz] = centerline(u, -side * HALF_DEPTH)
      const origin = new THREE.Vector3(ax, floor + height, az)
      const direction = new THREE.Vector3(bx - ax, 0, bz - az).normalize()
      return { height, width, side, ray: new THREE.Raycaster(origin, direction, 0, 2 * HALF_DEPTH) }
    })
  }))
}

describe('doorway clearance through the built house and interior shell', () => {
  for (const plan of PLANS) {
    it(`${plan.name}: every doorway is clear of structure`, () => {
      const { lib, materials } = testMaterials()
      const house = buildHouse(plan, lib)
      const blocked: string[] = []
      try {
        for (const [index, op] of plan.openings.entries()) {
          if (!DOOR_KINDS.has(op.kind)) continue
          const label = op.id ?? `${op.wall ?? `${op.block}/${op.side}`}@${op.at}`
          expect(house.doors.filter(door => door.openingIndex === index), label).toHaveLength(1)

          // Batches share materials across openings. Check ambiguous hits against a build
          // with this opening removed so only this door's components can be ignored.
          let withoutDoor: ReturnType<typeof buildHouse> | undefined
          try {
            const obstructions = new Map<string, string>()
            for (const { height, width, side, ray } of doorwayRays(plan, op)) {
              const hits = ray.intersectObject(house.group, true)
              const ambiguous = hits.filter(hit => DOOR_MATERIALS.has(hit.object.userData.material))
              const solid = hits.filter(hit => !DOOR_MATERIALS.has(hit.object.userData.material))
              if (ambiguous.length) {
                withoutDoor ??= buildHouse({ ...plan, openings: plan.openings.filter(other => other !== op) }, lib)
                const otherHits = ray.intersectObject(withoutDoor.group, true)
                solid.push(...ambiguous.filter(hit => otherHits.some(other =>
                  other.object.name === hit.object.name && Math.abs(other.distance - hit.distance) < 1e-5)))
              }
              for (const hit of solid) {
                if (obstructions.has(hit.object.name)) continue
                const depth = (hit.distance - HALF_DEPTH) * -side
                obstructions.set(hit.object.name, `${hit.object.name} at ${height} m, ${(width * 100).toFixed(1)}% width, depth ${depth.toFixed(3)} m`)
              }
            }
            if (obstructions.size) blocked.push(`${label} (${op.kind}): ${[...obstructions.values()].join('; ')}`)
          } finally {
            withoutDoor?.dispose()
          }
        }
      } finally {
        house.dispose()
        for (const material of materials.values()) material.dispose()
      }
      expect(blocked).toEqual([])
    }, 30_000)
  }
})
