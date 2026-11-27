import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Engine } from '../Engine'
import { paintSunDisk, preparePhotoScene } from './scene'
import { packGeometry, unpackGeometry } from './workerGeometry'

describe('photo scene preparation', () => {
  it('keeps the visible architecture, strips raster-only maps, and leaves the live scene intact', () => {
    const house = new THREE.Group()
    house.position.set(2, 1, -3)
    const geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), lightMap: new THREE.Texture() })
    const mesh = new THREE.Mesh(geometry, material)
    const blocker = new THREE.Mesh(geometry, material)
    blocker.userData.shadowOnly = true
    const invisible = new THREE.Group()
    invisible.visible = false
    invisible.add(new THREE.Mesh(geometry, material))
    house.add(mesh, blocker, invisible, new THREE.InstancedMesh(geometry, material, 2))
    const lamp = new THREE.PointLight(0xffffff, 2)
    const lights = new THREE.Group()
    lights.add(lamp, new THREE.PointLight(0xffffff, 0))
    const engine = {
      camera: new THREE.PerspectiveCamera(),
      house: { group: house },
      lights: { group: lights },
      sky: { worldSky: () => null },
    } as unknown as Engine
    const snapshot = preparePhotoScene(engine)
    const rendered = snapshot.scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    expect(snapshot.scene.children).toHaveLength(2)
    expect(snapshot.triangles).toBe(12)
    expect(snapshot.textureLayers).toBe(1)
    expect(rendered.geometry).toBe(geometry)
    expect(rendered.material).not.toBe(material)
    expect(rendered.material.map).not.toBe(material.map)
    expect(rendered.material.map?.source).toBe(material.map?.source)
    expect(rendered.material.lightMap).toBeNull()
    expect(material.lightMap).toBeInstanceOf(THREE.Texture)
    expect(new THREE.Vector3().setFromMatrixPosition(rendered.matrix).equals(house.position)).toBe(true)
    expect(snapshot.scene.background).toBeNull()
    snapshot.dispose()
    expect(house.children).toHaveLength(4)
  })

  it('deposits the preset sun energy across the equirectangular longitude seam', () => {
    const w = 512
    const h = 256
    const sky = new Float32Array(w * h * 3)
    paintSunDisk(sky, w, h, new THREE.Vector3(-1, 0, 0), new THREE.Color(3, 2, 1), 1)
    const total = [0, 0, 0]
    let seamLeft = false
    let seamRight = false
    for (let y = 0; y < h; y++) {
      const area = (Math.PI * 2 / w) * (Math.PI / h) * Math.cos((0.5 - (y + 0.5) / h) * Math.PI)
      for (let x = 0; x < w; x++) {
        const offset = (y * w + x) * 3
        if (!sky[offset]) continue
        if (x === 0) seamLeft = true
        if (x === w - 1) seamRight = true
        for (let c = 0; c < 3; c++) total[c] += sky[offset + c] * area
      }
    }
    expect(seamLeft && seamRight).toBe(true)
    expect(total[0]).toBeCloseTo(3)
    expect(total[1]).toBeCloseTo(2)
    expect(total[2]).toBeCloseTo(1)
  })

  it('round trips interleaved attributes and material groups for the worker', () => {
    const geometry = new THREE.BufferGeometry()
    const buffer = new THREE.InterleavedBuffer(new Float32Array([1, 2, 3, 4, 5, 6]), 3)
    geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(buffer, 2, 1))
    geometry.setIndex([0, 1, 0])
    geometry.addGroup(0, 3, 5)
    const copy = unpackGeometry(structuredClone(packGeometry(geometry, ['uv'])))
    expect(copy.getAttribute('uv').getX(1)).toBe(5)
    expect(copy.getAttribute('uv').getY(1)).toBe(6)
    expect(copy.index?.getX(1)).toBe(1)
    expect(copy.groups).toEqual(geometry.groups)
  })
})
