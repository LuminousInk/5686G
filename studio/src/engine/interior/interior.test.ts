import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PLANS } from '../../plans'
import { MeshBatch } from '../geo'
import type { HouseModel } from '../house/build'
import { buildInteriorShell } from '../house/interiorShell'
import { buildingSections } from '../house/levels'
import type { Rect, RoomDef } from '../house/types'
import type { MaterialLibrary } from '../materials/library'
import { TIERS } from '../quality'
import { Interior } from './interior'

function testMaterials() {
  const material = new THREE.MeshStandardMaterial()
  return new Proxy({ interiorExtra: new Set(), lamp: () => material }, {
    get(target, key) {
      return Reflect.get(target, key) ?? material
    },
  }) as unknown as MaterialLibrary
}

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ({ fillRect() {}, beginPath() {}, ellipse() {}, fill() {} }),
    }),
  })
  // Exercise the real model geometry and normalization. The renderer alone needs the image maps.
  vi.stubGlobal('fetch', async (url: string) => {
    const asset = JSON.parse(readFileSync(`public/${url.replace(/^\.\//, '')}`, 'utf8'))
    delete asset.images
    delete asset.textures
    asset.materials = asset.materials.map(({ name }: { name?: string }) => ({ name }))
    return Response.json(asset)
  })
})

afterAll(() => vi.unstubAllGlobals())

function overlaps(a: Rect, b: Rect) {
  return Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.001 &&
    Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.001
}

function inRoom(room: RoomDef, o: THREE.Object3D) {
  const [x0, z0, x1, z1] = room.rect
  return o.position.x > x0 && o.position.x < x1 && o.position.z > z0 && o.position.z < z1
}

const sections = PLANS.flatMap(plan => buildingSections(plan).map(section => ({
  name: [plan.name, plan.levels && section.level, section.frame?.id].filter(Boolean).join(' / '),
  plan: section.plan,
})))

describe.each(sections)('$name interior', ({ plan }) => {
  let interior: Interior

  beforeAll(async () => {
    const lib = testMaterials()
    interior = new Interior(lib, TIERS.low)
    const { colliders } = buildInteriorShell(plan, lib, new MeshBatch())
    await interior.build(plan, { plan, colliders } as HouseModel)
  })

  it('keeps occupied footprints inside rooms, apart, and clear of door swings and landings', () => {
    for (const room of plan.rooms) {
      const layout = interior['layouts'].get(room.id)
      if (!layout) continue
      const [x0, z0, x1, z1] = room.rect
      const bounds = layout.pieces.map(piece => interior['bounds'](piece))
      for (const [i, box] of bounds.entries()) {
        expect(box[0], room.id).toBeGreaterThanOrEqual(x0)
        expect(box[1], room.id).toBeGreaterThanOrEqual(z0)
        expect(box[2], room.id).toBeLessThanOrEqual(x1)
        expect(box[3], room.id).toBeLessThanOrEqual(z1)
        expect(layout.keepOuts.some(k => overlaps(box, k)), room.id).toBe(false)
        expect(layout.glazing.some(k => overlaps(box, k)), room.id).toBe(false)
        expect(bounds.slice(i + 1).some(b => overlaps(box, b)), room.id).toBe(false)
      }
    }
  })

  it('furnishes every bedroom with a wall-backed bed, paired nightstands, a lamp and a rug', () => {
    for (const room of plan.rooms.filter(r => r.type === 'bedroom' || r.type === 'primary')) {
      const objects = interior.group.children.filter(o => inRoom(room, o))
      const bed = objects.find(o => o.name === 'platformBed' || o.name === 'bed_dark_headboard')
      const layout = interior['layouts'].get(room.id)
      expect(bed, room.id).toBeDefined()
      expect(layout, room.id).toBeDefined()
      const footprint = layout!.pieces[0]
      const nx = Math.sin(footprint.yaw)
      const nz = Math.cos(footprint.yaw)
      const headX = footprint.x - nx * footprint.d / 2
      const headZ = footprint.z - nz * footprint.d / 2
      expect(interior['anchors'](room, 0.78).some(w => {
        const back = (headX - w.x) * nx + (headZ - w.z) * nz
        const offset = (headX - w.x) * nz - (headZ - w.z) * nx
        return Math.abs(nx - w.inX) < 1e-5 && Math.abs(nz - w.inZ) < 1e-5 && back >= 0 && back < 0.02 &&
          Math.abs(offset) + footprint.w / 2 <= w.len / 2
      }), room.id).toBe(true)
      const stands = objects.filter(o => o.name === 'nightstand')
      expect(stands, room.id).toHaveLength(2)
      const [left, right] = stands.map(o => (o.position.x - footprint.x) * nz - (o.position.z - footprint.z) * nx)
      expect(left * right, room.id).toBeLessThan(0)
      expect(Math.abs(left + right), room.id).toBeLessThan(0.001)
      expect(stands.some(o => o.getObjectByName('tableLamp')), room.id).toBe(true)
      expect(objects.some(o => o.name === 'areaRug'), room.id).toBe(true)
      const measured = new THREE.Box3().setFromObject(bed!, true)
      expect(measured.min.y, room.id).toBeCloseTo(plan.floorY, 3)
      // The tallest upholstered points belong at the wall end of the bed.
      const top = new THREE.Vector3()
      let frontmost = -Infinity
      bed!.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return
        const positions = o.geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) {
          top.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld)
          if (top.y < measured.max.y - 0.023) continue
          frontmost = Math.max(frontmost, (top.x - footprint.x) * nx + (top.z - footprint.z) * nz)
        }
      })
      expect(frontmost, room.id).toBeLessThan(-0.2)
      expect(measured.max.x - measured.min.x, room.id).toBeLessThanOrEqual(interior['bounds'](footprint)[2] - interior['bounds'](footprint)[0] + 0.001)
      expect(measured.max.z - measured.min.z, room.id).toBeLessThanOrEqual(interior['bounds'](footprint)[3] - interior['bounds'](footprint)[1] + 0.001)
    }
  })

  it('ships the complete living, dining, kitchen, bath, office, and entry groups', () => {
    for (const room of plan.rooms) {
      const objects = interior.group.children.filter(o => inRoom(room, o))
      const byName = (name: string) => objects.filter(o => o.name === name)
      if (room.type === 'living') {
        expect(objects.some(o => ['GlamVelvetSofa', 'sectional_grey', 'sofa_beige'].includes(o.name)), room.id).toBe(true)
        expect(byName('areaRug'), room.id).toHaveLength(1)
        expect(byName('coffee_table_round_01'), room.id).toHaveLength(1)
      }
      if (room.type === 'dining') {
        const [table] = byName('diningTable')
        const [pendant] = byName('pendant')
        expect(table, room.id).toBeDefined()
        expect(pendant, room.id).toBeDefined()
        expect(pendant.position.x).toBeCloseTo(table.position.x)
        expect(pendant.position.z).toBeCloseTo(table.position.z)
        const chairs = byName('dining_chair_bentwood')
        expect([4, 6]).toContain(chairs.length)
        const inverse = table.quaternion.clone().invert()
        const positions = chairs.map(chair => chair.position.clone().sub(table.position).applyQuaternion(inverse))
        const row = (sign: number) => positions.filter(p => p.z * sign > 0).sort((a, b) => a.x - b.x)
        const [near, far] = [row(-1), row(1)]
        expect(near).toHaveLength(chairs.length / 2)
        expect(far).toHaveLength(near.length)
        for (const [i, seat] of near.entries()) {
          expect(seat.x).toBeCloseTo(far[i].x, 4)
          expect(seat.z).toBeCloseTo(-far[i].z, 4)
          if (i > 1) expect(seat.x - near[i - 1].x).toBeCloseTo(near[1].x - near[0].x, 4)
        }
        for (const chair of chairs) {
          const chairBounds = new THREE.Box3().setFromObject(chair, true)
          expect(chairBounds.min.y).toBeCloseTo(plan.floorY, 3)
          expect(chairBounds.intersectsBox(new THREE.Box3().setFromObject(table, true))).toBe(false)
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(chair.quaternion)
          expect(forward.dot(table.position.clone().sub(chair.position))).toBeGreaterThan(0.4)
        }
      }
      if (room.type === 'kitchen') {
        expect(byName('kitchen-base'), room.id).toHaveLength(1)
        expect(byName('fridge_steel'), room.id).toHaveLength(1)
        const [island] = byName('kitchen-island')
        const stools = byName('bar_stool_wood')
        if (room.id === 'adu-kitchen') {
          expect(island, room.id).toBeUndefined()
          expect(stools, room.id).toHaveLength(0)
          continue
        }
        expect(island, room.id).toBeDefined()
        expect([2, 3], room.id).toContain(stools.length)
        const islandBounds = new THREE.Box3().setFromObject(island, true)
        for (const stool of stools) {
          expect(new THREE.Box3().setFromObject(stool, true).intersectsBox(islandBounds), room.id).toBe(false)
        }
      }
      if (room.type === 'bath' || room.type === 'powder') {
        const fixture = room.furnish?.bath
        expect(byName('bathVanity'), room.id).toHaveLength(!fixture || fixture === 'vanity' ? 1 : 0)
        expect(byName('toilet_modern'), room.id).toHaveLength(!fixture || fixture === 'toilet' ? 1 : 0)
        if (fixture !== 'toilet') expect(byName('towelRail'), room.id).toHaveLength(1)
        expect(byName('shower_black'), room.id).toHaveLength(room.type === 'bath' && (!fixture || fixture === 'shower') ? 1 : 0)
        const floor = plan.floorY + (room.floor === 'tile' ? 0.004 : 0)
        for (const fixture of [...byName('bathVanity'), ...byName('toilet_modern')]) {
          expect(new THREE.Box3().setFromObject(fixture, true).min.y, room.id).toBeCloseTo(floor, 3)
        }
      }
      if (room.type === 'office') {
        expect(byName('officeDesk'), room.id).toHaveLength(1)
        expect(byName('dining_chair_bentwood'), room.id).toHaveLength(1)
      }
      if (room.type === 'entry') {
        expect(objects.some(o => o.name === 'entryBench' || o.name === 'sideboard_midcentury'), room.id).toBe(true)
      }
    }
  })
})
