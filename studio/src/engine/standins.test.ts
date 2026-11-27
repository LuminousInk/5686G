import { readdirSync } from 'node:fs'
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import type { MaterialLibrary } from './materials/library'
import { loadModel, MODEL_YAW, modelPieces, placeModel } from './models'
import { standinModel } from './standins'

const materials = new Map<PropertyKey, THREE.Material>()
const lib = new Proxy({} as MaterialLibrary, {
  get(_target, name) {
    let material = materials.get(name)
    if (!material) {
      material = new THREE.MeshStandardMaterial({ name: String(name) })
      materials.set(name, material)
    }
    return material
  },
})

const ids = readdirSync('public/assets/models').filter(file => file.endsWith('.json')).map(file => file.slice(0, -5))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('substitutes renderable, compact geometry with library materials for every shipped model id', () => {
  for (const id of ids) {
    const group = standinModel(lib, id, MODEL_YAW[id] ?? 0)
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
    expect(size.toArray().every(value => Number.isFinite(value) && value > 0), id).toBe(true)

    let triangles = 0
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      const g = object.geometry
      triangles += (g.index?.count ?? g.getAttribute('position').count) / 3
      expect(materials.has(object.material.name), id).toBe(true)
      expect(object.castShadow && object.receiveShadow, id).toBe(true)
    })
    expect(triangles, id).toBeGreaterThan(0)
    expect(triangles, id).toBeLessThan(20_000)
  }
})

it('uses existing placement dimensions and corrects the source facing before placement', async () => {
  vi.stubEnv('PUBLIC_BUILD', 'true')
  vi.stubGlobal('window', { __engine: { lib } })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)

  const id = 'bed_dark_headboard'
  const dims = { width: 1.86, depth: 2.23, height: 0.92 }
  const placed = await placeModel(id, dims)
  const box = new THREE.Box3().setFromObject(placed)
  const size = box.getSize(new THREE.Vector3())
  expect(size.x).toBeCloseTo(dims.width)
  expect(size.y).toBeCloseTo(dims.height)
  expect(size.z).toBeCloseTo(dims.depth)
  expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0)
  expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(0)
  expect(box.min.y).toBeCloseTo(0)

  const headboard = placed.getObjectByName('walnut headboard')!
  expect(new THREE.Box3().setFromObject(headboard).max.z).toBeLessThan(0)
  const stool = await placeModel('bar_stool_wood', { height: 0.68 })
  expect(new THREE.Box3().setFromObject(stool).max.y).toBeCloseTo(0.68)
  const coffeeTable = await placeModel('coffee_table_round_01', { size: 0.75 })
  const tableSize = new THREE.Box3().setFromObject(coffeeTable).getSize(new THREE.Vector3())
  expect(Math.max(tableSize.x, tableSize.z)).toBeCloseTo(0.75)

  expect(await loadModel(id)).toBe(await loadModel(id))
  expect(fetch).not.toHaveBeenCalled()
})

it('returns distinct, grounded rock pieces and a whole, compact grass tuft for instancing', async () => {
  vi.stubEnv('PUBLIC_BUILD', 'true')
  vi.stubGlobal('window', { __engine: { lib } })

  const rocks = await modelPieces('rock_moss_set_01')
  expect(rocks).toHaveLength(3)
  expect(new Set(rocks.map(rock => rock.geometry.boundingBox!.max.y)).size).toBe(3)
  const grass = await modelPieces('grass_medium_01')
  expect(grass).toHaveLength(1)
  for (const piece of [...rocks, ...grass]) {
    const box = piece.geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(0)
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0)
    expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(0)
  }
})
