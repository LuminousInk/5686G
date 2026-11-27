import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { MaterialLibrary } from '../materials/library'
import { shower, showerOpening, vanity } from './bathParts'
import { ovalTub, suspendedDome } from './catalogFixtures'
import { interiorStyle, INTERIOR_STYLES } from './catalogStyle'
import { openWardrobe, WARDROBE_DEPTH } from './closetParts'

const material = new THREE.MeshStandardMaterial()
const lib = new Proxy({}, { get: () => material }) as MaterialLibrary

describe('catalog interiors', () => {
  it('maps all five plans to their catalog lines', () => {
    for (const plan of ['woodland-modern', 'cedar-ridge', 'aspen-custom']) {
      expect(interiorStyle(plan)).toBe(INTERIOR_STYLES.woodland)
    }
    expect(interiorStyle('coastal-modern')).toBe(INTERIOR_STYLES.coastal)
    expect(interiorStyle('modern-farmhouse')).toBe(INTERIOR_STYLES.desert)
  })

  it('keeps the tub and walk-in casework at their planned scale', () => {
    const tub = new THREE.Box3().setFromObject(ovalTub(lib))
    expect(tub.min.y).toBeCloseTo(0, 3)
    const size = tub.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(1.65, 2)
    expect(size.y).toBeCloseTo(0.607, 3)
    expect(size.z).toBeCloseTo(0.85, 2)

    const wardrobe = new THREE.Box3().setFromObject(openWardrobe(lib, 2.4, 2.31))
    expect(wardrobe.min.y).toBeCloseTo(0, 3)
    expect(wardrobe.max.y).toBeCloseTo(2.31, 3)
    const dimensions = wardrobe.getSize(new THREE.Vector3())
    expect(dimensions.x).toBeCloseTo(2.4, 3)
    expect(dimensions.z).toBeCloseTo(WARDROBE_DEPTH, 3)
  })

  it('fits compact and double vanities within their wall allowances', () => {
    for (const [w, d, mirrors] of [[0.55, 0.37, 1], [1.64, 0.46, 2]]) {
      const unit = vanity(lib, w, d, false, material)
      const box = new THREE.Box3().setFromObject(unit)
      expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(w, 3)
      expect(box.max.z).toBeCloseTo(d, 3)
      expect(box.min.y).toBeGreaterThan(0.25)
      expect(unit.children.filter(o => o.name === 'vanity-mirror')).toHaveLength(mirrors)
    }
  })

  it('reserves a clear shower entrance opposite the screen on either side', () => {
    for (const width of [0.80, 1.38]) {
      const opening = showerOpening(width)
      expect(opening).toBeGreaterThan(0.5)
      for (const side of [-1, 1]) {
        const unit = shower(lib, width, 0.83, material, side, 2.2)
        const screen = unit.getObjectByName('shower-screen')!
        const box = new THREE.Box3().setFromObject(screen)
        const openSide = side > 0 ? box.min.x + width / 2 : width / 2 - box.max.x
        expect(openSide).toBeCloseTo(opening, 3)
        expect(new THREE.Box3().setFromObject(unit).max.y).toBeLessThanOrEqual(2.2)
      }
    }
  })

  it('keeps the model shade at the chosen height under shallow and vaulted ceilings', () => {
    for (const drop of [0.48, 1.61]) {
      const shade = new THREE.Group()
      shade.add(new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.16, 0.39).translate(0, 0.08, 0)))
      const fixture = suspendedDome(lib, drop, shade, 0.16)
      const bounds = new THREE.Box3().setFromObject(fixture, true)
      expect(bounds.min.y).toBeCloseTo(-drop)
      expect(bounds.max.y).toBeCloseTo(0)
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(0.39)
      expect(new THREE.Box3().setFromObject(shade, true).max.y).toBeCloseTo(-drop + 0.16)
    }
  })
})
