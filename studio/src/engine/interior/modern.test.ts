import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { MaterialLibrary } from '../materials/library'
import {
  FURNITURE_FOOTPRINTS, areaRug, barStool, diningChair, diningTable, floorLamp, mediaConsole,
  modernSofa, nightstand, platformBed, sideboard, tableLamp, tv, wardrobe,
} from './modern'

const makeLib = () =>
  ({
    cabinet: new THREE.MeshStandardMaterial({ color: '#c9a77d' }),
    darkWood: new THREE.MeshStandardMaterial({ color: '#7a5a42' }),
    blackMetal: new THREE.MeshStandardMaterial({ color: '#1a1b1d' }),
    fixtureMetal: new THREE.MeshStandardMaterial({ color: '#5a5351' }),
    fabric: new THREE.MeshStandardMaterial({ color: '#f4f1ea' }),
    fabric2: new THREE.MeshStandardMaterial({ color: '#b9ae9c' }),
    linen: new THREE.MeshStandardMaterial({ color: '#f5f3ee' }),
    oliveLinen: new THREE.MeshStandardMaterial({ color: '#77795a' }),
    throwLinen: new THREE.MeshStandardMaterial({ color: '#a18972' }),
    linenShade: new THREE.MeshStandardMaterial({ color: '#e9d8b8' }),
    tvGlass: new THREE.MeshPhysicalMaterial({ color: '#111013' }),
    tvCase: new THREE.MeshStandardMaterial({ color: '#161517' }),
    diffuser: new THREE.MeshStandardMaterial({ color: '#fff1d5' }),
    bathStone: new THREE.MeshStandardMaterial({ color: '#d5c5ad' }),
    porcelain: new THREE.MeshStandardMaterial({ color: '#f7f7f4' }),
    rug: new THREE.MeshStandardMaterial({ color: '#d9d1c3' }),
    lamp: () => new THREE.MeshStandardMaterial({ color: '#1a1a1a', emissive: new THREE.Color('#ffe2b8') }),
  }) as unknown as MaterialLibrary

function bbox(g: THREE.Group): THREE.Box3 {
  return new THREE.Box3().setFromObject(g)
}

function size(g: THREE.Group): THREE.Vector3 {
  return bbox(g).getSize(new THREE.Vector3())
}

const pieces: [string, () => THREE.Group][] = [
  ['platformBed', () => platformBed(makeLib(), 1.6, 2.0)],
  ['nightstand', () => nightstand(makeLib())],
  ['tableLamp', () => tableLamp(makeLib())],
  ['floorLamp', () => floorLamp(makeLib())],
  ['diningTable', () => diningTable(makeLib(), 1.8, 0.9)],
  ['diningChair', () => diningChair(makeLib())],
  ['barStool', () => barStool(makeLib())],
  ['sideboard', () => sideboard(makeLib(), 1.8)],
  ['mediaConsole', () => mediaConsole(makeLib(), 1.8)],
  ['tv', () => tv(makeLib(), 1.4)],
  ['wardrobe', () => wardrobe(makeLib(), 2.0)],
  ['modernSofa', () => modernSofa(makeLib(), 2.2)],
  ['areaRug', () => areaRug(makeLib(), 2.4, 1.6)],
]

describe('modern furniture kit', () => {
  it('has a footprint for every builder', () => {
    for (const [name] of pieces) expect(FURNITURE_FOOTPRINTS[name], name).toBeDefined()
  })

  for (const [name, build] of pieces) {
    it(`${name}: has meshes and sits on the floor`, () => {
      const g = build()
      let meshes = 0
      g.traverse(o => {
        if ((o as THREE.Mesh).isMesh) meshes++
      })
      expect(meshes).toBeGreaterThan(0)
      const box = bbox(g)
      expect(box.min.y).toBeGreaterThanOrEqual(-0.005)
      expect(box.min.y).toBeLessThan(0.02)
      expect(box.max.y).toBeGreaterThan(0)
    })
  }

  it('platformBed is about 1.7 wide and low', () => {
    const box = size(platformBed(makeLib(), 1.6, 2.0))
    expect(box.x).toBeGreaterThan(1.6)
    expect(box.x).toBeLessThan(1.8)
    expect(box.y).toBeLessThan(1.15)
  })

  it('diningTable top is at 0.75 m', () => {
    expect(bbox(diningTable(makeLib(), 1.8, 0.9)).max.y).toBeCloseTo(0.75, 2)
  })

  it('tv width follows the 16:9 diagonal', () => {
    expect(size(tv(makeLib(), 1.4)).x).toBeCloseTo(1.4 * (16 / Math.hypot(16, 9)), 1)
  })
})
