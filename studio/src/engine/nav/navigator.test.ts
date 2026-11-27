import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../Engine'
import type { CameraView } from '../house/types'
import { Navigator } from './navigator'

const view: CameraView = { id: 'living', label: 'Living', kind: 'walk', pos: [0, 1.62, 0], target: [0, 1.5, -4], fov: 65 }

function setup() {
  const house = {
    group: new THREE.Group(),
    floorAt: (_x: number, _z: number, y: number) => y < -1.5 ? -3 : 0,
  }
  const camera = new THREE.PerspectiveCamera(50, 1.6)
  const engine = {
    house,
    camera,
    dollhouse: false,
    plan: { floorY: 0, levels: [{ id: 'main', offset: 0 }, { id: 'lower', offset: -3 }] },
    invalidate: vi.fn(),
    start: vi.fn(),
    addHook: vi.fn(),
  } as unknown as Engine
  return { house, nav: new Navigator(engine, new EventTarget() as HTMLElement) }
}

describe('guided camera moves', () => {
  beforeEach(() => { vi.stubGlobal('window', new EventTarget()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('freezes a glide on pause and hands off the same camera when interrupted', () => {
    const { nav } = setup()
    const arrived = vi.fn()
    nav.goToTourView(view, false, arrived)
    expect(nav.active).toBe(true)
    nav.update(0.5)
    const pose = nav.capturePose()
    expect(pose.pos).not.toEqual(view.pos)
    nav.pauseTween(true)
    nav.update(0.75)
    expect(nav.capturePose()).toEqual(pose)
    nav.interruptTween()
    nav.pauseTween(false)
    nav.update(0.8)
    expect(nav.capturePose()).toEqual(pose)
    expect(arrived).not.toHaveBeenCalled()
    nav.dispose()
  })

  it('cuts if the glide would cross a wall, or if reduced motion is enabled', () => {
    const { nav, house } = setup()
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5, 0.7), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    house.group.add(wall)
    house.group.updateMatrixWorld()
    const arrived = vi.fn()
    nav.goToTourView(view, false, arrived)
    expect(nav.active).toBe(false)
    expect(nav.capturePose().pos).toEqual(view.pos)
    wall.removeFromParent()
    nav.goToTourView({ ...view, pos: [4, -1.38, 0] }, true, arrived)
    expect(nav.active).toBe(false)
    expect(nav.floorLevel).toBe('lower')
    expect(arrived).toHaveBeenCalledTimes(2)
    nav.dispose()
  })
})
