import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PALETTES } from './catalog'
import { MaterialLibrary } from './library'
import { TIERS } from '../quality'

vi.mock('./textures', async importOriginal => ({
  ...await importOriginal<typeof import('./textures')>(),
  noiseTexture: () => new THREE.Texture(),
}))

let lib: MaterialLibrary

beforeEach(() => {
  const renderer = { capabilities: { getMaxAnisotropy: () => 8 } } as THREE.WebGLRenderer
  lib = new MaterialLibrary(renderer, TIERS.low)
  vi.spyOn(lib.bank, 'scaled').mockImplementation((_id, size = 1, rotation = 0) => {
    const map = new THREE.Texture()
    map.rotation = rotation
    return { map, size, normalMap: new THREE.Texture(), arm: new THREE.Texture() }
  })
})

describe('finish material updates', () => {
  it('keeps lightmapped wall paint matte through finish swaps', () => {
    const wall = lib.wall
    const map = wall.map
    const normal = wall.normalMap
    expect(wall.name).toBe('zone:walls')
    expect(lib.zone('walls')).toBe(wall)
    for (const finish of ['charcoal', 'limewash', 'warm-white']) {
      lib.setFinish('walls', finish)
      expect(wall.map).toBe(map)
      expect(wall.normalMap).toBe(normal)
      expect(wall.roughnessMap).toBeNull()
      expect(wall.aoMap).toBeNull()
      expect(wall.roughness).toBeGreaterThanOrEqual(0.9)
      expect(wall.normalScale.x).toBe(finish === 'limewash' ? 0.28 : 0.16)
    }
  })

  it('changes siding between painted and directional wood finishes in place', () => {
    const siding = lib.zone('coastal')
    expect(siding.map).toBeNull()
    expect(siding.bumpMap).not.toBeNull()
    lib.setFinish('coastal', 'weathered-cedar')
    expect(siding.bumpMap).toBeNull()
    expect(siding.map?.rotation).toBe(Math.PI / 2)
    expect(siding.aoMap).toBe(siding.roughnessMap)
    lib.setFinish('coastal', 'sand')
    expect(siding.map).toBeNull()
    expect(siding.normalMap).toBeNull()
    expect(siding.aoMap).toBeNull()
    expect(siding.bumpMap).not.toBeNull()
  })

  it('reapplies palette settings to retained floor, counter and fabric materials', () => {
    const { floor, counter, fabric } = lib
    const oakMap = floor.map
    lib.setPalette('walnut')
    expect(floor.map).toBe(oakMap)
    expect(counter.clearcoat).toBe(PALETTES.walnut.counter.coat)
    lib.setPalette('ash')
    expect(floor.map).not.toBe(oakMap)
    expect(floor.normalScale.x).toBe(0.62)
    expect(counter.name).toBe('counter')
    expect(fabric.color.getHexString()).toBe(PALETTES.ash.fabric.slice(1).toLowerCase())
    lib.setPalette('light')
    expect(floor.normalScale.x).toBe(1.35)
    expect(counter.clearcoat).toBe(PALETTES.light.counter.coat)
  })

  it('patches only the shared sofa fabric once', () => {
    const fabric = new THREE.MeshStandardMaterial({ name: 'Tela_Victoria', roughness: 0.6 })
    const feet = new THREE.MeshStandardMaterial({ name: 'Negro', roughness: 0.6 })
    lib.interiorExtra.add(fabric).add(feet)
    const setup = fabric.onBeforeCompile
    lib.interiorExtra.add(fabric)
    expect(fabric.onBeforeCompile).toBe(setup)
    expect(fabric.customProgramCacheKey()).toContain('upholstery-sheen')
    expect(fabric.roughness).toBe(0.78)
    expect(feet.roughness).toBe(0.6)
    expect(feet.customProgramCacheKey()).not.toContain('upholstery-sheen')
  })
})
