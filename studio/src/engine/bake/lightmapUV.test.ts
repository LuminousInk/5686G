import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { geometrySignature, layoutLightmap } from './lightmapUV'

// A room-like test mesh: a 6 x 4 m floor split into two quads, plus a 2.7 m wall, merged and indexed the way
// MeshBatch produces house geometry.
function room(): THREE.Mesh {
  const floorA = new THREE.PlaneGeometry(3, 4).rotateX(-Math.PI / 2).translate(-1.5, 0, 0)
  const floorB = new THREE.PlaneGeometry(3, 4).rotateX(-Math.PI / 2).translate(1.5, 0, 0)
  const wall = new THREE.PlaneGeometry(6, 2.7).translate(0, 1.35, -2)
  const parts = [floorA, floorB, wall].map(g => g.toNonIndexed())
  const merged = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) {
    const arrays = parts.map(p => p.getAttribute(name).array as Float32Array)
    const out = new Float32Array(arrays.reduce((s, a) => s + a.length, 0))
    let o = 0
    for (const a of arrays) {
      out.set(a, o)
      o += a.length
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, parts[0].getAttribute(name).itemSize))
  }
  const m = new THREE.Mesh(merged)
  m.name = 'interior:floor'
  return m
}

describe('lightmap UV layout', () => {
  it('joins coplanar neighbours into one chart and keeps walls separate', () => {
    const layout = layoutLightmap([room()], { size: 512, density: 32, pad: 2 })
    // two floor quads sharing an edge become one chart; the wall is another
    expect(layout.charts).toBe(2)
  })

  it('writes uv1 inside the atlas and preserves the triangles', () => {
    const m = room()
    const before = m.geometry.getAttribute('position').count / 3
    layoutLightmap([m], { size: 512, density: 32, pad: 2 })
    const uv1 = m.geometry.getAttribute('uv1')
    expect(uv1).toBeTruthy()
    expect(m.geometry.index!.count / 3).toBe(before)
    for (let i = 0; i < uv1.count; i++) {
      expect(uv1.getX(i)).toBeGreaterThanOrEqual(0)
      expect(uv1.getX(i)).toBeLessThanOrEqual(1)
      expect(uv1.getY(i)).toBeGreaterThanOrEqual(0)
      expect(uv1.getY(i)).toBeLessThanOrEqual(1)
    }
  })

  it('keeps a constant texel density (metres map linearly to texels)', () => {
    const m = room()
    const layout = layoutLightmap([m], { size: 1024, density: 32, pad: 2 })
    const g = m.geometry
    const pos = g.getAttribute('position')
    const uv1 = g.getAttribute('uv1')
    const idx = g.index!
    // first triangle: compare world edge length with uv edge length in texels
    const a = idx.getX(0)
    const b = idx.getX(1)
    const world = new THREE.Vector3().fromBufferAttribute(pos, a).distanceTo(new THREE.Vector3().fromBufferAttribute(pos, b))
    const texels = Math.hypot(uv1.getX(a) - uv1.getX(b), uv1.getY(a) - uv1.getY(b)) * layout.size
    expect(texels / world).toBeCloseTo(layout.density, 3)
  })

  it('is deterministic and the signature tracks the geometry', () => {
    const a = layoutLightmap([room()], { size: 512 })
    const b = layoutLightmap([room()], { size: 512 })
    expect(a).toEqual(b)
    const moved = room()
    moved.geometry.translate(0.01, 0, 0)
    expect(geometrySignature([moved])).not.toBe(a.signature)
  })

  it('lowers the density when the charts would not fit', () => {
    const layout = layoutLightmap([room()], { size: 64, density: 40, pad: 1 })
    expect(layout.density).toBeLessThan(40)
  })
})
