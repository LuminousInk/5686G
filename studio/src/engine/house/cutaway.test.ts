import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GeoBuilder } from '../geo'
import { Cutaway } from './cutaway'

describe('wall cutaway', () => {
  it('clips the near wall and its UVs, adds a cap, and preserves the full source batches', () => {
    const model = new Cutaway()
    const batch = model.batch()
    const section = model.section(batch, 0)
    const material = new THREE.MeshStandardMaterial()
    const build = (z: number, nz: number) => section.wall(0, z, 0, nz, false, () => {
      const builder = new GeoBuilder()
      builder.box(-2, 0, z - 0.1, 2, 3, z + 0.1)
      batch.addBuilder(material, builder)
      section.cap(new THREE.Matrix4().makeTranslation(0, 0, z), -2, 2, -0.1, 0.1, [])
    }, 4)
    build(2, 1)
    build(-2, -1)
    const full = batch.toGroup('walls')
    batch.tag(full)
    const original = (full.children[0] as THREE.Mesh).geometry
    const atlas = original.getAttribute('uv').clone()
    for (let i = 0; i < atlas.count; i++) atlas.setXY(i, atlas.getX(i) * 0.1 + 0.3, atlas.getY(i) * 0.2 + 0.4)
    original.setAttribute('uv1', atlas)
    model.attach(full)
    const eye = new THREE.Vector3(0, 8, 8)
    const focus = new THREE.Vector3()
    expect(model.update(0, true, eye, focus)).toBe(true)
    const wall = model.group.children[1] as THREE.Mesh
    const cap = model.group.children[0] as THREE.Mesh
    const heights = (mesh: THREE.Mesh, side: number) => {
      const { index, attributes, drawRange } = mesh.geometry
      return Array.from({ length: drawRange.count }, (_, i) => index!.getX(i))
        .filter(i => Math.sign(attributes.position.getZ(i)) === side)
        .map(i => attributes.position.getY(i))
    }
    expect(Math.max(...heights(wall, 1))).toBeCloseTo(0.96)
    expect(Math.max(...heights(wall, -1))).toBe(3)
    expect(heights(cap, 1)).toHaveLength(6)
    expect(heights(cap, -1)).toHaveLength(0)
    const uv = wall.geometry.getAttribute('uv')
    const baked = wall.geometry.getAttribute('uv1')
    expect(baked.count).toBeGreaterThan(atlas.count)
    for (let i = 0; i < baked.count; i++) {
      expect(baked.getX(i)).toBeCloseTo(uv.getX(i) * 0.1 + 0.3)
      expect(baked.getY(i)).toBeCloseTo(uv.getY(i) * 0.2 + 0.4)
    }
    expect((full.children[0] as THREE.Mesh).geometry).toBe(original)

    const furniture = new THREE.Group()
    const curtain = new THREE.Group()
    curtain.name = 'linen-curtain'
    curtain.position.set(0.4, 0.012, 1.77)
    curtain.rotation.y = Math.PI
    furniture.add(curtain)
    model.syncFurniture(furniture, 0)
    expect(curtain.layers.isEnabled(0)).toBe(false)

    expect(model.update(0, true, eye, focus)).toBe(false)
    eye.z = -8
    expect(model.update(0, true, eye, focus)).toBe(true)
    expect(Math.max(...heights(wall, -1))).toBeCloseTo(0.96)
    expect(Math.max(...heights(wall, 1))).toBe(3)
    model.syncFurniture(furniture, 0)
    expect(curtain.layers.isEnabled(0)).toBe(true)
    model.update(undefined, false, eye, focus)
    expect(full.children[0].layers.isEnabled(0)).toBe(true)
    expect(model.group.visible).toBe(false)
    model.dispose()
  })

  it('hides a higher section even with full walls selected', () => {
    const model = new Cutaway()
    const batch = model.batch()
    const mat = new THREE.MeshStandardMaterial()
    for (const y of [0, -3]) {
      model.section(batch, y)
      const builder = new GeoBuilder()
      builder.box(0, y - 0.1, 0, 1, y, 1)
      batch.addBuilder(mat, builder)
    }
    const full = batch.toGroup('floor')
    batch.tag(full)
    model.attach(full)
    const eye = new THREE.Vector3(0, 8, 8)
    model.update(-3, false, eye, new THREE.Vector3())
    const variant = (model.group.children[0] as THREE.Mesh).geometry
    expect(variant.drawRange.count).toBe(36)
    model.update(0, false, eye, new THREE.Vector3())
    expect(model.group.children[0].visible).toBe(false)
    expect(full.children[0].layers.isEnabled(0)).toBe(true)
    model.dispose()
  })
})
