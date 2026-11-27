import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Engine } from '../engine/Engine'
import { finishSurface, hotspotArea, HotspotSurfaces } from './hotspotSurfaces'

describe('finish hotspots', () => {
  it('uses the same palette zone for floor and cabinet surfaces', () => {
    expect(finishSurface('floor')).toEqual({ key: 'floor', zone: 'palette' })
    expect(finishSurface('cabinet')).toEqual({ key: 'cabinet', zone: 'palette' })
    expect(finishSurface('zone:roof')).toEqual({ key: 'roof', zone: 'roof' })
    expect(finishSurface('ceiling')).toBeUndefined()
  })

  it('keeps markers out of the phone center and edge controls', () => {
    expect(hotspotArea(195, 422, 390, 844)).toBe(false)
    expect(hotspotArea(365, 110, 390, 844)).toBe(false)
    expect(hotspotArea(90, 420, 390, 844)).toBe(true)
  })

  it('anchors to the first visible finish and drops an anchor occluded by furniture', () => {
    const group = new THREE.Group()
    function add(name: string, depth: number, transparent = false) {
      const material = new THREE.MeshBasicMaterial({ transparent })
      material.name = name
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 15, 15), material)
      mesh.position.z = depth
      group.add(mesh)
      group.updateMatrixWorld()
    }
    const camera = new THREE.PerspectiveCamera(60, 390 / 844, 0.05, 100)
    camera.updateMatrixWorld()
    add('zone:walls', -12)
    add('glass', -8, true)
    const engine = { house: { group } } as Engine
    const visible = new HotspotSurfaces(engine).scan(camera, ['walls'], 390, 844)
    expect(visible).toHaveLength(1)
    expect(visible[0].point.z).toBeCloseTo(-12)
    expect(visible[0].opacity).toBeLessThan(1)
    add('furniture', -4)
    expect(new HotspotSurfaces(engine).scan(camera, ['walls'], 390, 844)).toEqual([])
  })
})
