import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { roomVolumes } from '../env/roomVolumes'
import type { HomePlan } from '../house/types'
import { anchoredExposure, interiorExposureWeight, roomExposureEV } from './exposureAnchors'

const plan = {
  id: 'test', floorY: 0, blocks: [{ id: 'main', rect: [0, 0, 12, 5], roof: { type: 'flat', height: 3 } }],
  rooms: [
    { id: 'living', rect: [0, 0, 6, 5], type: 'living' },
    { id: 'hall', rect: [6, 0, 12, 5], type: 'hall' },
  ],
} as HomePlan

describe('exposure anchors', () => {
  it('blends authored biases continuously on both sides of a room threshold', () => {
    const volumes = roomVolumes(plan)
    const evAt = (x: number) => roomExposureEV(plan.id, volumes, new THREE.Vector3(x, 1.6, 2.5))
    expect(evAt(4)).toBeLessThan(0)
    expect(evAt(8)).toBeGreaterThan(0)
    expect(evAt(6.01) - evAt(5.99)).toBeLessThan(0.02)
    expect(evAt(6)).toBeCloseTo((evAt(4) + evAt(8)) / 2)
  })

  it('eases back to the exterior exposure across the slider', () => {
    const at = (x: number) => interiorExposureWeight(plan, new THREE.Vector3(x, 1.6, 2.5))
    expect(at(-1)).toBe(0)
    expect(at(0)).toBe(0.5)
    expect(at(1)).toBe(1)
    expect(anchoredExposure(3, 2.35, 0.2, at(-1))).toBe(1)
    expect(anchoredExposure(3, 2.35, 0.2, at(0))).toBeCloseTo(Math.sqrt(anchoredExposure(3, 2.35, 0.2, at(1))))
  })

  it('stays at interior exposure across touching blocks', () => {
    const a = { ...plan.blocks[0], rect: [0, 0, 6, 5] as HomePlan['blocks'][number]['rect'] }
    const b = { ...plan.blocks[0], id: 'wing', rect: [6, 0, 12, 5] as HomePlan['blocks'][number]['rect'] }
    expect(interiorExposureWeight({ ...plan, blocks: [a, b] }, new THREE.Vector3(6, 1.6, 2.5))).toBe(1)
  })

  it('lets the meter lead while bounding extreme readings', () => {
    expect(anchoredExposure(0, 2, -0.3, 1)).toBeCloseTo(2 ** 0.7)
    expect(anchoredExposure(1.25, 2, 0, 1)).toBeLessThan(1.5)
    expect(anchoredExposure(5, 2, 0, 1)).toBeGreaterThan(4)
    expect(anchoredExposure(1000, 2, 0, 1)).toBeLessThan(9)
  })
})
