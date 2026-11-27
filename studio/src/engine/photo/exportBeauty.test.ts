import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { cedarRidge } from '../../plans/cedarRidge'
import type { Block, HomePlan } from '../house/types'
import { beautyMaterial, beautyOpenings } from './exportBeauty'

describe('beauty export materials', () => {
  it('preserves mapped PBR inputs and leaves the live lightmap alone', () => {
    const map = new THREE.Texture()
    const normalMap = new THREE.Texture()
    const arm = new THREE.Texture()
    const lightMap = new THREE.Texture()
    const source = new THREE.MeshPhysicalMaterial({
      name: 'cabinet', color: '#b1a990', map, normalMap, normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: arm, metalnessMap: arm, aoMap: arm, aoMapIntensity: 0.72, lightMap, lightMapIntensity: 2,
      emissive: '#ffca99', emissiveIntensity: 0.85, emissiveMap: map, clearcoat: 0.37,
    })
    const copy = beautyMaterial(source, true) as THREE.MeshPhysicalMaterial
    expect(copy).not.toBe(source)
    expect(copy).toMatchObject({
      normalScale: new THREE.Vector2(0.3, 0.3), aoMapIntensity: 0.72, lightMap: null,
      emissiveIntensity: 0.85, clearcoat: 0.37, userData: { beautyBevel: 0.004 },
    })
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
      expect(copy[key]).toBe(source[key])
    }
    expect(source.lightMap).toBe(lightMap)
    expect(source.lightMapIntensity).toBe(2)
    expect(source.userData).toEqual({})
  })

  it('uses transmission for glazing and sheer fabric and retains foliage cutouts', () => {
    const glass = beautyMaterial(new THREE.MeshPhysicalMaterial({ name: 'showerGlass', transparent: true, opacity: 0.08 }))
    const curtain = beautyMaterial(new THREE.MeshStandardMaterial({ name: 'interior:drapery' }), true)
    const texture = new THREE.Texture()
    const leaf = beautyMaterial(new THREE.MeshPhongMaterial({ map: texture, transparent: true, alphaTest: 0.42 }), true)
    expect(glass).toMatchObject({ transmission: 1, ior: 1.47, opacity: 1, userData: { beautyThinGlass: true } })
    expect(curtain).toMatchObject({ transmission: 0.68, side: THREE.DoubleSide, userData: { beautySheer: true } })
    expect(leaf).toMatchObject({ alphaTest: 0.42, transparent: false, userData: {} })
    expect(leaf.map).toBe(texture)
  })
})

describe('beauty export light portals', () => {
  const block: Block = {
    id: 'rotated', level: 'upper', yaw: Math.PI / 2, rect: [0, 0, 4, 6],
    roof: { type: 'flat', height: 3.5 }, cladding: { default: { zone: 'wall', kind: 'panel' } },
  }

  it('passes world-space clear apertures for rotated blocks and raised floors', () => {
    const plan: HomePlan = {
      ...cedarRidge, floorY: 0.5, levels: [{ id: 'upper', label: 'Upper', offset: 4 }], blocks: [block],
      openings: [
        { block: block.id, side: 's', kind: 'slider', at: 2, width: 2.5, height: 2.2 },
        { block: block.id, side: 'e', kind: 'door', at: 3, width: 1, height: 2.1 },
        { block: block.id, side: 's', kind: 'window', at: 0, width: 2, height: 2 },
        { block: block.id, side: 's', kind: 'window', at: 1.5, width: 1.5, sill: 3.3, height: 0.5 },
        { wall: 'inside', kind: 'window', at: 1, width: 1, height: 1 },
      ],
    }
    const portals = beautyOpenings(plan)
    expect(portals).toHaveLength(1)
    const [portal] = portals
    expect(portal.position[0]).toBeCloseTo(4.785)
    expect(portal.position[1]).toBeCloseTo(5.6)
    expect(portal.position[2]).toBeCloseTo(3)
    expect(portal.inward[0]).toBeCloseTo(-1)
    expect(portal.inward[2]).toBeCloseTo(0)
    expect(portal.width).toBeCloseTo(2.39)
    expect(portal.height).toBeCloseTo(2.09)
  })

  it('skips windows on shared walls while retaining clerestories above the adjacent roof', () => {
    const west = { ...block, id: 'west', yaw: undefined, level: undefined, roof: { type: 'flat', height: 2.2, thickness: 0.2 }, rect: [-5, 0, 0, 6] } satisfies Block
    const east = { ...block, id: 'east', yaw: undefined, level: undefined } satisfies Block
    const plan: HomePlan = {
      ...cedarRidge, blocks: [west, east],
      openings: [
        { block: east.id, side: 'w', kind: 'window', at: 2, width: 1, sill: 0.7, height: 1 },
        { block: east.id, side: 'w', kind: 'clerestory', at: 2, width: 1, sill: 2.5, height: 0.6 },
      ],
    }
    expect(beautyOpenings(plan)).toMatchObject([{ inward: [1, 0, 0], width: 0.89 }])
  })
})
