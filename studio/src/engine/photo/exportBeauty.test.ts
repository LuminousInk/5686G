import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { cedarRidge } from '../../plans/cedarRidge'
import type { Block, HomePlan } from '../house/types'
import { rng } from '../materials/textures'
import { canyonMaterial, type CoastalMaps } from '../site/groundMaterials'
import { Hillside } from '../site/hillside'
import { CoastalSky } from '../site/ocean'
import { beautyForestPlacements, beautyForestSeed, beautyMaterial, beautyOpenings, canyonBakeShader, groundAtlasAxis } from './exportBeauty'

describe('beauty export materials', () => {
  it('preserves mapped PBR inputs and leaves the live lightmap alone', () => {
    const map = new THREE.Texture()
    const normalMap = new THREE.Texture()
    const arm = new THREE.Texture()
    const lightMap = new THREE.Texture()
    const source = new THREE.MeshPhysicalMaterial({
      name: 'cabinet', color: '#b1a990', map, normalMap, normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: arm, metalnessMap: arm, aoMap: arm, aoMapIntensity: 0.72, lightMap, lightMapIntensity: 2,
      emissive: '#ffca99', emissiveIntensity: 0.85, emissiveMap: map, clearcoat: 0.37,
    })
    const copy = beautyMaterial(source, true) as THREE.MeshPhysicalMaterial
    expect(copy).not.toBe(source)
    expect(copy).toMatchObject({
      normalScale: new THREE.Vector2(0.3, 0.3), aoMapIntensity: 0.72, lightMap: null,
      emissiveIntensity: 0.85, clearcoat: 0.37, userData: { beautyBevel: 0.004 },
    })
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
      expect(copy[key]).toBe(source[key])
    }
    expect(source.lightMap).toBe(lightMap)
    expect(source.lightMapIntensity).toBe(2)
    expect(source.userData).toEqual({})
  })

  it('uses transmission for glazing and sheer fabric and retains foliage cutouts', () => {
    const glass = beautyMaterial(new THREE.MeshPhysicalMaterial({ name: 'showerGlass', transparent: true, opacity: 0.08 }))
    const curtain = beautyMaterial(new THREE.MeshStandardMaterial({ name: 'interior:drapery' }), true)
    const texture = new THREE.Texture()
    const leaf = beautyMaterial(new THREE.MeshPhongMaterial({ map: texture, transparent: true, alphaTest: 0.42 }), true)
    expect(glass).toMatchObject({ transmission: 1, ior: 1.47, opacity: 1, userData: { beautyThinGlass: true } })
    expect(curtain).toMatchObject({ transmission: 0.68, side: THREE.DoubleSide, userData: { beautySheer: true } })
    expect(leaf).toMatchObject({ alphaTest: 0.42, transparent: false, userData: {} })
    expect(leaf.map).toBe(texture)
  })
})

describe('beauty export light portals', () => {
  const block: Block = {
    id: 'rotated', level: 'upper', yaw: Math.PI / 2, rect: [0, 0, 4, 6],
    roof: { type: 'flat', height: 3.5 }, cladding: { default: { zone: 'wall', kind: 'panel' } },
  }

  it('passes world-space clear apertures for rotated blocks and raised floors', () => {
    const plan: HomePlan = {
      ...cedarRidge, floorY: 0.5, levels: [{ id: 'upper', label: 'Upper', offset: 4 }], blocks: [block],
      openings: [
        { block: block.id, side: 's', kind: 'slider', at: 2, width: 2.5, height: 2.2 },
        { block: block.id, side: 'e', kind: 'door', at: 3, width: 1, height: 2.1 },
        { block: block.id, side: 's', kind: 'window', at: 0, width: 2, height: 2 },
        { block: block.id, side: 's', kind: 'window', at: 1.5, width: 1.5, sill: 3.3, height: 0.5 },
        { wall: 'inside', kind: 'window', at: 1, width: 1, height: 1 },
      ],
    }
    const portals = beautyOpenings(plan)
    expect(portals).toHaveLength(1)
    const [portal] = portals
    expect(portal.position[0]).toBeCloseTo(4.785)
    expect(portal.position[1]).toBeCloseTo(5.6)
    expect(portal.position[2]).toBeCloseTo(3)
    expect(portal.inward[0]).toBeCloseTo(-1)
    expect(portal.inward[2]).toBeCloseTo(0)
    expect(portal.width).toBeCloseTo(2.39)
    expect(portal.height).toBeCloseTo(2.09)
  })

  it('skips windows on shared walls while retaining clerestories above the adjacent roof', () => {
    const west = { ...block, id: 'west', yaw: undefined, level: undefined, roof: { type: 'flat', height: 2.2, thickness: 0.2 }, rect: [-5, 0, 0, 6] } satisfies Block
    const east = { ...block, id: 'east', yaw: undefined, level: undefined } satisfies Block
    const plan: HomePlan = {
      ...cedarRidge, blocks: [west, east],
      openings: [
        { block: east.id, side: 'w', kind: 'window', at: 2, width: 1, sill: 0.7, height: 1 },
        { block: east.id, side: 'w', kind: 'clerestory', at: 2, width: 1, sill: 2.5, height: 0.6 },
      ],
    }
    expect(beautyOpenings(plan)).toMatchObject([{ inward: [1, 0, 0], width: 0.89 }])
  })
})

describe('beauty export terrain atlas', () => {
  it('spends most of the resolution near the camera without folding distant triangles', () => {
    const uv = groundAtlasAxis(-1500, 1600, -10)
    expect(uv(-1500)).toBe(0)
    expect(uv(1600)).toBe(1)
    expect(uv(42) - uv(-62)).toBeGreaterThan(0.8)
    const points = [-1500, -950, -62, -10, 42, 128, 760, 1600].map(uv)
    expect(points.every((value, i) => !i || value > points[i - 1])).toBe(true)
  })

  it.each([false, true])('reuses the live terrain colors and normal blend (low tier %s)', low => {
    const scan = { color: new THREE.Texture(), normal: new THREE.Texture() }
    const maps: CoastalMaps = { grass: scan, soil: scan, gravel: scan, rock: scan, bark: scan, lawn: scan }
    const eye = new THREE.Vector3(0, 2, 5)
    const source = canyonMaterial(new Hillside(cedarRidge, cedarRidge.landscape.site!), new CoastalSky(), maps, [-2, -2, 2, 2], low)
    const shader = canyonBakeShader(source, {} as THREE.WebGLRenderer, eye)
    expect(shader.uniforms.bakeEye.value).toBe(eye)
    expect(shader.uniforms.lawnColor.value).toBe(scan.color)
    expect(shader.uniforms.lawnDetail.value).toBe(scan.normal)
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = mix(groundColor')
    expect(shader.fragmentShader).toContain('atlasNormal = normalize(vec3(bump, 1.0))')
    expect(shader.fragmentShader).not.toContain('viewMatrix')
  })
})

describe('beauty export forest', () => {
  it('identifies the tree variant from the card tint even when other variants are missing', () => {
    for (const seed of [5, 9, 10, 11, 12, 13]) {
      const random = rng(seed)
      const tone = new THREE.Float32BufferAttribute([0.76 + random() * 0.40, 0.78 + random() * 0.39, random()], 3)
      expect(beautyForestSeed(tone)).toBe(seed)
    }
    expect(beautyForestSeed(new THREE.Float32BufferAttribute([1, 1, 0], 3))).toBeUndefined()
  })

  it('keeps one representation per tree and restores the real tree base height', () => {
    const cards = new THREE.InstancedBufferGeometry()
    cards.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array([99, 4, 0, 12, 100, 5, 0, 6]), 4))
    cards.instanceCount = 2
    const forest = beautyForestPlacements(cards, new THREE.Matrix4().makeTranslation(1, 0, 0), new THREE.Vector3(0, 80, 0))
    expect(forest.far).toEqual([1])
    expect(forest.near).toMatchObject([{ x: 99, y: 4.3, z: 0, height: 12 }])
  })
})
