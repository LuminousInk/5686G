import * as THREE from 'three'
import type { HouseModel } from '../house/build'
import type { QualitySettings } from '../quality'
import type { Interior } from '../interior/interior'

/**
 * Exterior downlights, door sconces and interior room lights. They always exist (intensity 0 by day) so switching
 * time of day never changes the light count, which would recompile every shader.
 */
export class NightLights {
  readonly group = new THREE.Group()
  private items: { light: THREE.Light; full: number }[] = []

  constructor(
    scene: THREE.Scene,
    private quality: QualitySettings,
  ) {
    this.group.name = 'night-lights'
    scene.add(this.group)
  }

  setup(house: HouseModel, interior: Interior | null) {
    for (const it of this.items) {
      this.group.remove(it.light)
      ;(it.light as THREE.PointLight).dispose?.()
    }
    this.items = []
    const cap = this.quality.tier === 'low' ? 6 : this.quality.tier === 'medium' ? 10 : 16
    const warm = new THREE.Color('#ffc58a')
    // exterior soffit and porch downlights, merged when close together
    const spots = thin(house.downlights, 1.8)
    const sconces = thin(house.sconces, 1.2)
    const rooms = interior?.lightSpots ?? []
    const budget = { ext: Math.ceil(cap * 0.45), sconce: Math.ceil(cap * 0.15) }
    for (const p of spots.slice(0, budget.ext)) {
      const l = new THREE.SpotLight(warm, 0, 9, THREE.MathUtils.degToRad(58), 0.75, 2)
      l.position.copy(p)
      l.target.position.set(p.x, p.y - 3, p.z)
      this.group.add(l, l.target)
      this.items.push({ light: l, full: 9 })
    }
    for (const p of sconces.slice(0, budget.sconce)) {
      const l = new THREE.PointLight(warm, 0, 4, 2)
      l.position.copy(p)
      this.group.add(l)
      this.items.push({ light: l, full: 1.2 })
    }
    const left = Math.max(2, cap - this.items.length)
    for (const p of rooms.slice(0, left)) {
      const l = new THREE.PointLight('#ffd2a1', 0, 8, 2)
      l.position.copy(p)
      this.group.add(l)
      this.items.push({ light: l, full: 6 })
    }
  }

  setLevel(level: number) {
    for (const it of this.items) it.light.intensity = it.full * level
  }
}

function thin(pts: THREE.Vector3[], minDist: number) {
  const out: THREE.Vector3[] = []
  for (const p of pts) if (!out.some(q => q.distanceTo(p) < minDist)) out.push(p)
  return out
}
