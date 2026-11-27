import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { MaterialLibrary } from '../materials/library'
import { bedThrow, cushion, hungTowel, linenRunner, supportHeight } from './softGoods'
import { basket, bathCounterDecor, counterProps, kitchenBoards, kettle } from './styling'

const material = new THREE.MeshStandardMaterial()
const lib = new Proxy({ interiorExtra: new Set() }, {
  get: (target, key) => Reflect.get(target, key) ?? material,
}) as MaterialLibrary

describe('catalog decor', () => {
  it('reserves the full hob and keeps each worktop grouping in its own supported span', () => {
    const widths = { boards: 0.42, kettle: 0.33, cookbooks: 0.23, herbs: 0.18 }
    for (const [left, right, hob] of [[-1.3, 1.3, 0], [-0.60, 1.72, 0.23], [-0.50, 0.60, 0.05]]) {
      const spans = counterProps(left, right, hob, 0.58).map(({ kind, x }) => {
        expect(Math.abs(x - hob) - widths[kind] / 2).toBeGreaterThanOrEqual(0.3939)
        return [x - widths[kind] / 2, x + widths[kind] / 2]
      }).sort((a, b) => a[0] - b[0])
      for (const [i, [lo, hi]] of spans.entries()) {
        expect(lo).toBeGreaterThan(left)
        expect(hi).toBeLessThan(right)
        if (i) expect(lo).toBeGreaterThan(spans[i - 1][1])
      }
    }
    expect(counterProps(-1.3, 1.3, 0, 0.58).map(prop => prop.kind))
      .toEqual(['boards', 'kettle', 'cookbooks', 'herbs'])
    expect(counterProps(-0.5, 0.6, 0.05, 0.58)).toEqual([])
  })

  it('samples the actual surface in the fitted furniture frame', () => {
    const parent = new THREE.Group()
    parent.position.y = -2.8
    parent.rotation.y = Math.PI / 3
    const bed = new THREE.Group()
    bed.position.set(-4, 0.4, -3)
    bed.rotation.y = Math.PI / 2
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 2.1), material)
    mattress.position.y = 0.5
    bed.add(mattress)
    parent.add(bed)

    const sample = supportHeight(bed)
    expect(sample(-0.42, 0.33)).toBeCloseTo(0.58, 5)
    expect(sample(0, 1.2)).toBeUndefined()

    const throwCover = bedThrow(lib, 1.8, 2.1, sample, material)
    const bounds = new THREE.Box3().setFromObject(throwCover, true)
    expect(bounds.max.y).toBeGreaterThan(0.58)
    expect(bounds.min.y).toBeGreaterThan(0.58)
    expect(bounds.max.z).toBeLessThan(1.05)
  })

  it('keeps the throw on a duvet that is narrower than the fitted frame', () => {
    const top = (x: number) => Math.abs(x) <= 0.68 ? 0.52 : undefined
    const throwCover = bedThrow(lib, 1.8, 2.1, top, material)
    const bounds = new THREE.Box3().setFromObject(throwCover, true)
    expect(bounds.min.x).toBeGreaterThan(-0.68)
    expect(bounds.max.x).toBeLessThan(0.68)
    expect(bounds.min.y).toBeGreaterThan(0.52)
  })

  it('tags each accessory subtree and keeps its geometry light enough to repeat', () => {
    const accessories = [basket(lib, 0.16), bathCounterDecor(lib, true, true), cushion(material, 0.44, 0.3, 0.125),
      hungTowel(lib, 0.35, 0.35, 0.033), linenRunner(lib, 1.4, 0.31), kettle(lib), kitchenBoards(lib)]
    for (const accessory of accessories) {
      expect(accessory.userData.bakeIgnore, accessory.name).toBe(true)
      let triangles = 0
      accessory.traverse(node => {
        if (node instanceof THREE.Mesh) triangles += node.geometry.getAttribute('position').count / 3
      })
      expect(triangles, accessory.name).toBeGreaterThan(0)
      expect(triangles, accessory.name).toBeLessThan(6000)
    }
    const box = new THREE.Box3().setFromObject(accessories[2], true)
    expect(box.min.y).toBeCloseTo(0, 6)
  })
})
