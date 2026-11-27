import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { geometrySignature, layoutLightmap } from './lightmapUV'
import { surfaceBudgets } from './surfaceBudget'
import type { HomePlan } from '../house/types'

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

describe('visibility-weighted lightmap charts', () => {
  it('cuts at the budget boundary and allocates more texels on the visible side', () => {
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)
    const layout = () => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 3))
      const result = layoutLightmap([mesh], { size: 512, density: 64, pad: 3, budget: () => ({
        cuts: () => [plane], weight: p => p.x >= 0 ? 1 : 0.25,
      }) })
      return { mesh, result }
    }
    const { mesh, result } = layout()
    const pos = mesh.geometry.getAttribute('position')
    const uv = mesh.geometry.getAttribute('uv1')
    const ix = mesh.geometry.index!
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const ranges = new Set<number>()
    let area = 0
    for (let i = 0; i < ix.count; i += 3) {
      const [ia, ib, ic] = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)]
      a.fromBufferAttribute(pos, ia)
      b.fromBufferAttribute(pos, ib)
      c.fromBufferAttribute(pos, ic)
      const triangle = new THREE.Triangle(a, b, c)
      expect(Math.min(a.x, b.x, c.x) * Math.max(a.x, b.x, c.x)).toBeGreaterThanOrEqual(0)
      area += triangle.getArea()
      const midpoint = triangle.getMidpoint(new THREE.Vector3())
      const uvLength = Math.hypot(uv.getX(ia) - uv.getX(ib), uv.getY(ia) - uv.getY(ib)) * result.size
      expect(uvLength / a.distanceTo(b)).toBeCloseTo(midpoint.x > 0 ? 64 : 16, 3)
      ranges.add(Math.sign(midpoint.x))
    }
    expect(area).toBeCloseTo(18)
    expect(ranges.size).toBe(2)
    expect(result.charts).toBe(2)
    expect(layout().mesh.geometry.getAttribute('uv1').array).toEqual(uv.array)
  })

  it('favours eye-height walls, glazed floor edges and built-ins over overhead and utility faces', () => {
    const plan = {
      floorY: 0,
      blocks: [
        { id: 'main', rect: [0, 0, 8, 6], roof: { type: 'flat', height: 3 } },
        { id: 'garage', rect: [9, 0, 12, 6], utility: true, roof: { type: 'flat', height: 3 } },
      ],
      rooms: [{ id: 'closet', type: 'closet', rect: [0, 0, 2, 2] }],
      openings: [{ block: 'main', side: 's', at: 4, width: 2.4, kind: 'slider' }],
    } as HomePlan
    const budgets = surfaceBudgets(plan)
    const weight = (name: string, x: number, y: number, z: number, normal = new THREE.Vector3(0, 1, 0)) =>
      budgets(new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ name }))).weight!(new THREE.Vector3(x, y, z), normal)
    const towardsRoom = new THREE.Vector3(0, 0, 1)
    expect(weight('floor', 4, 0, 5.4)).toBeGreaterThan(weight('floor', 4, 0, 3))
    expect(weight('floor', 4, 0, 3)).toBeGreaterThan(weight('floor', 1, 0, 1))
    expect(weight('floor', 10, 0, 2)).toBeLessThan(weight('floor', 4, 0, 3))
    expect(weight('zone:walls', 4, 1.55, 0.1, towardsRoom)).toBeGreaterThan(weight('zone:walls', 4, 2.5, 0.1, towardsRoom))
    expect(weight('counter', 4, 1, 3)).toBeGreaterThan(weight('ceiling', 4, 2.9, 3))
  })
})
