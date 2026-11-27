import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aspenCustom } from '../../plans/aspenCustom'
import type { Engine } from '../Engine'
import { Interior } from '../interior/interior'
import type { MaterialLibrary } from '../materials/library'
import { Navigator } from '../nav/navigator'
import { TIERS } from '../quality'
import { buildHouse } from './build'
import { framePoint, inRect, levelFloor, stairFlight } from './levels'

vi.mock('../models', () => ({
  async placeModel(id: string, options: { height?: number; width?: number; depth?: number }) {
    const height = options.height ?? 0.9
    const geometry = new THREE.BoxGeometry(options.width ?? 0.5, height, options.depth ?? 0.5)
    geometry.translate(0, height / 2, 0)
    const group = new THREE.Group()
    group.name = id
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()))
    return group
  },
}))

const material = (name: string) => new THREE.MeshStandardMaterial({ name })
const lib = new Proxy({
  zone: material,
  lamp: material,
  interiorExtra: new Set<THREE.Material>(),
}, {
  get: (target, key) => Reflect.get(target, key) ?? material(String(key)),
}) as unknown as MaterialLibrary

afterEach(() => vi.unstubAllGlobals())

describe('Aspen floors', () => {
  it('picks the nearest floor over overlapping footprints and respects the rotated ADU', () => {
    const house = buildHouse(aspenCustom, lib)
    const upper = levelFloor(aspenCustom, 'main')
    const lower = levelFloor(aspenCustom, 'lower')
    const [x, z] = [8, -2]
    expect(house.floorAt(x, z, upper)).toBe(upper)
    expect(house.floorAt(x, z, lower)).toBe(lower)
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0))
    const floors = ray.intersectObject(house.interior, true).filter(hit =>
      ((hit.object as THREE.Mesh).material as THREE.Material).name === 'floor')
    expect(floors[0].point.y).toBeCloseTo(upper)
    expect(floors.at(-1)?.point.y).toBeCloseTo(lower)
    const adu = aspenCustom.blocks.find(b => b.id === 'adu')!
    const [ax, az] = framePoint(adu, adu.rect[0] + 0.25, adu.rect[1] + 0.25)
    expect(house.floorAt(ax, az)).toBe(upper)
    expect(house.floorAt(adu.rect[0] + 0.25, adu.rect[1] + 0.25)).toBeNull()
    house.dispose()
  })

  it('walks down and back up both stairs with the built shell colliders', () => {
    const house = buildHouse(aspenCustom, lib)
    const eventTarget = new EventTarget()
    vi.stubGlobal('window', eventTarget)
    const engine = { plan: aspenCustom, house, addHook() {}, site: { heightAt: () => 0 } } as unknown as Engine
    const nav = new Navigator(engine, eventTarget as unknown as HTMLElement)
    const upper = levelFloor(aspenCustom, 'main')
    const lower = levelFloor(aspenCustom, 'lower')
    for (const stair of aspenCustom.stairs) {
      const { end, dx, dz, run, rect } = stairFlight(stair)
      const [x, z] = stair.from
      nav.feet.set(x - dx * 0.35, upper, z - dz * 0.35)
      const destination = new THREE.Vector3(end[0] + dx * 0.55, lower, end[1] + dz * 0.55)
      expect(nav['stairRoute'](destination).map(p => p.y)).toEqual([upper, lower, lower])
      const steps = Math.ceil((run + 0.9) / 0.04)
      for (let i = 0; i < steps; i++) expect(nav['walk'](dx * 0.04, dz * 0.04), `${stair.id} down step ${i}`).toBe(true)
      expect(nav.feet.y).toBeCloseTo(lower, 1)
      expect(inRect(rect, nav.feet.x, nav.feet.z)).toBe(false)
      for (let i = 0; i < steps; i++) expect(nav['walk'](-dx * 0.04, -dz * 0.04), `${stair.id} up step ${i}`).toBe(true)
      expect(nav.feet.y).toBeCloseTo(upper, 1)
    }
    const front = aspenCustom.blocks.find(b => b.id === 'great-room')!.rect
    const glass = aspenCustom.openings.find(o => o.id === 'great-slider-open')!
    const center = front[0] + glass.at
    const throughSlider = new THREE.Raycaster(
      new THREE.Vector3(center, upper + 1.4, front[1] - 0.4), new THREE.Vector3(0, 0, 1), 0, 0.7,
    )
    expect(throughSlider.intersectObject(house.shell, true).map(hit => hit.object.name)).toEqual([])
    nav.feet.set(center, upper, front[1] + 0.45)
    expect(nav['walk'](0, -0.95)).toBe(true)
    expect(nav.feet.z).toBeLessThan(front[1])
    nav.feet.set(center + 0.85, upper, front[1] + 0.45)
    nav['walk'](0, -0.95)
    expect(nav.feet.z).toBeGreaterThan(front[1])
    nav.dispose()
    house.dispose()
  })

  it('places each furnished room on its actual floor, including both lower suites and the ADU', async () => {
    const context = { fillRect() {}, beginPath() {}, ellipse() {}, fill() {} }
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const house = buildHouse(aspenCustom, lib)
    const furnished: string[] = []
    for (const room of aspenCustom.rooms) {
      const interior = new Interior(lib, TIERS.low)
      await interior.build({ ...aspenCustom, rooms: [room] }, house)
      const box = new THREE.Box3().setFromObject(interior.group)
      const y = levelFloor(aspenCustom, room.level)
      const [x0, z0, x1, z1] = room.rect
      const frame = aspenCustom.blocks.find(b => b.id === room.frame)
      const [x, z] = framePoint(frame, (x0 + x1) / 2, (z0 + z1) / 2)
      expect(house.floorAt(x, z, y), room.id).toBe(y)
      if (!box.isEmpty()) {
        furnished.push(room.id)
        expect(box.min.y, room.id).toBeCloseTo(y, 1)
        const center = box.getCenter(new THREE.Vector3())
        const [cx, cz] = framePoint(frame, center.x, center.z, true)
        expect(inRect(room.rect, cx, cz), room.id).toBe(true)
      }
      interior.dispose()
    }
    expect(furnished).toEqual(expect.arrayContaining([
      'great', 'kitchen', 'primary', 'laundry', 'office', 'adu', 'adubed', 'adu-kitchen', 'adu-bath',
      'bed5', 'bed6', 'bath5', 'bath6', 'shower5', 'shower6', 'wc1', 'wc2',
    ]))
    house.dispose()
  })
})
