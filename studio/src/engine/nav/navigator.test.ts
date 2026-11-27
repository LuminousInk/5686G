import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../Engine'
import type { CameraView } from '../house/types'
import { Navigator } from './navigator'

const view: CameraView = { id: 'living', label: 'Living', kind: 'walk', pos: [0, 1.62, 0], target: [0, 1.5, -4], fov: 65 }

function setup() {
  const house = {
    group: new THREE.Group(),
    bounds: new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 5, 10)),
    floorAt: (_x: number, _z: number, y: number) => y < -1.5 ? -3 : 0,
  }
  const camera = new THREE.PerspectiveCamera(50, 1.6)
  const engine = {
    house,
    camera,
    dollhouse: false,
    plan: { floorY: 0, blocks: [], rooms: [{ id: 'living', rect: [-2, -2, 2, 2] }], levels: [{ id: 'main', offset: 0 }, { id: 'lower', offset: -3 }] },
    invalidate: vi.fn(),
    start: vi.fn(),
    addHook: vi.fn(),
  } as unknown as Engine
  return { house, engine, nav: new Navigator(engine, new EventTarget() as HTMLElement) }
}

describe('guided camera moves', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('DOMRect', class {})
  })
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

describe('outside orbit', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('DOMRect', class {})
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const pose = { mode: 'orbit', pos: [0, 5, 12], target: [0, 2, 0], fov: 48 } as const

  it('keeps an authored pose and eases to the next view without resetting accumulation each update', () => {
    const { house, engine, nav } = setup()
    nav.setBounds(house.bounds)
    nav.goToPose({ ...pose, pos: [...pose.pos], target: [...pose.target] })
    expect(nav.capturePose().pos[1]).toBeCloseTo(5)
    const arrived = vi.fn()
    nav.goToPose({ ...pose, pos: [12, 8, 0], target: [2, 2, 1] }, true, arrived)
    expect(nav.active).toBe(true)
    nav.update(0.16)
    const mid = nav.capturePose()
    expect(mid.pos[0]).toBeGreaterThan(0)
    expect(mid.pos[0]).toBeLessThan(12)
    nav.pauseTween(true)
    nav.update(1)
    expect(nav.capturePose()).toEqual(mid)
    nav.pauseTween(false)
    for (let i = 0; i < 120; i++) nav.update(1 / 60)
    expect(nav.active).toBe(false)
    expect(arrived).toHaveBeenCalledOnce()
    expect(engine.invalidate).not.toHaveBeenCalled()
    const target = nav.capturePose().target
    expect(target[0]).toBeCloseTo(2)
    expect(target[1]).toBeCloseTo(2)
    expect(target[2]).toBeCloseTo(1)
    nav.dispose()
  })

  it('clears terrain and retains the same view when motion is interrupted', () => {
    const { nav } = setup()
    nav.goToPose({ ...pose, pos: [0, -3, 12], target: [...pose.target] })
    expect(nav.capturePose().pos[1]).toBeCloseTo(0.35)
    nav.goToPose({ ...pose, pos: [12, 8, 0], target: [...pose.target] }, true)
    nav.update(0.1)
    const mid = nav.capturePose()
    nav.interruptTween()
    nav.update(1)
    expect(nav.capturePose()).toEqual(mid)
    nav.dispose()
  })
})

describe('dollhouse room taps', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('DOMRect', class {})
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fits a room on the second tap and keeps the camera in dollhouse mode', () => {
    const { nav } = setup()
    nav.goToPose({ mode: 'dollhouse', pos: [6, 8, 8], target: [0, 0, 0], fov: 45 })
    nav['pick'] = () => ({ point: new THREE.Vector3() } as THREE.Intersection)
    const box = vi.fn()
    nav['fitBox'] = box
    const tap = { clientX: 60, clientY: 60 } as PointerEvent
    nav['tap'](tap)
    vi.advanceTimersByTime(100)
    nav['tap'](tap)
    vi.advanceTimersByTime(400)
    expect(nav.mode).toBe('dollhouse')
    expect(box).toHaveBeenCalledOnce()
    expect(box.mock.calls[0][0].getSize(new THREE.Vector3()).toArray()).toEqual([4, 1.65, 4])
    nav.dispose()
  })

  it('walks into the room after a single tap', () => {
    const { nav } = setup()
    nav.goToPose({ mode: 'dollhouse', pos: [6, 8, 8], target: [0, 0, 0], fov: 45 })
    nav['pick'] = () => ({ point: new THREE.Vector3() } as THREE.Intersection)
    nav['tap']({ clientX: 60, clientY: 60 } as PointerEvent)
    vi.advanceTimersByTime(400)
    expect(nav.mode).toBe('walk')
    nav.dispose()
  })
})
