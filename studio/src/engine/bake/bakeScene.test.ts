import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TIME_PRESETS } from '../env/environment'
import type { HouseModel } from '../house/build'
import type { HomePlan } from '../house/types'
import type { Site } from '../site/site'
import { bakeSignature, collectBakeMeshes } from './bakeScene'
import { ensureLayout, LightmapBinding, validateLightmap } from './lightmaps'
import { loadRgbeWebp } from '../env/environment'

vi.mock('../env/environment', async importOriginal => ({
  ...await importOriginal<typeof import('../env/environment')>(),
  loadRgbeWebp: vi.fn(),
}))

function fixture() {
  const group = new THREE.Group()
  const [shell, roof, ceilings, outdoor, inside] = Array.from({ length: 5 }, () => new THREE.Group())
  group.add(shell, roof, ceilings, outdoor, inside)
  const plan = {
    id: 'fixture', floorY: 0, sunAzimuth: 0,
    rooms: [], blocks: [], openings: [], landscape: {},
  } as unknown as HomePlan
  const house = {
    plan, group, shell, roof, ceilings, outdoor, interior: inside,
    bounds: new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 4, 4)),
  } as unknown as HouseModel
  const interior = new THREE.Group()
  const site = { group: new THREE.Group() } as Site
  const floorMat = new THREE.MeshStandardMaterial({ name: 'floor' })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), floorMat)
  inside.add(floor)
  const dresser = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.4), new THREE.MeshStandardMaterial())
  dresser.position.set(1, 0.5, 0)
  interior.add(dresser)
  const planter = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), floorMat)
  planter.position.set(0, 0, -5)
  site.group.add(planter)
  const preset = TIME_PRESETS[0]
  const meshes = () => collectBakeMeshes(house, interior, site)
  const signature = () => bakeSignature(house, meshes(), preset)
  return { house, interior, site, floor, floorMat, dresser, planter, preset, meshes, signature }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('baked scene fingerprint', () => {
  it('excludes decorated meshes and whole nested subtrees while keeping their furniture', () => {
    const { interior, dresser, meshes, signature } = fixture()
    const original = signature()
    const styling = new THREE.Group()
    styling.userData.bakeIgnore = true
    const nested = new THREE.Group()
    const vase = dresser.clone()
    const book = dresser.clone()
    book.userData.bakeIgnore = true
    nested.add(vase)
    styling.add(nested)
    dresser.add(styling, book)
    styling.position.y += 0.2
    expect(meshes().map(entry => entry.mesh)).toContain(dresser)
    expect(meshes().map(entry => entry.mesh)).not.toContain(vase)
    expect(meshes().map(entry => entry.mesh)).not.toContain(book)
    expect(signature()).toBe(original)
    styling.userData.bakeIgnore = false
    expect(signature()).not.toBe(original)

    const wrapped = new THREE.Group()
    wrapped.userData.bakeIgnore = true
    wrapped.add(interior)
    expect(meshes().map(entry => entry.mesh)).not.toContain(dresser)
  })

  it('tracks furniture and nearby site occluders, including inherited world transforms', () => {
    const { signature, dresser, interior, planter } = fixture()
    const original = signature()
    interior.rotation.y = 0.25
    expect(signature()).not.toBe(original)
    interior.rotation.y = 0
    expect(signature()).toBe(original)
    planter.position.z -= 0.25
    const newSite = signature()
    expect(newSite).not.toBe(original)
    dresser.geometry.translate(0.025, 0, 0)
    expect(signature()).not.toBe(newSite)
  })

  it('tracks topology and ignores completion order, dithering detail and distant site objects', () => {
    const { signature, dresser, interior, site } = fixture()
    const chair = dresser.clone()
    chair.position.z += 1
    interior.add(chair)
    const original = signature()
    interior.add(dresser)
    expect(signature()).toBe(original)
    const distant = dresser.clone()
    distant.position.z = 100
    site.group.add(distant)
    expect(signature()).toBe(original)
    const cutout = dresser.clone()
    cutout.material = new THREE.MeshStandardMaterial({ transparent: true })
    interior.add(cutout)
    expect(signature()).toBe(original)
    dresser.geometry = dresser.geometry.clone()
    const index = dresser.geometry.index!
    index.setX(0, index.getX(1))
    expect(signature()).not.toBe(original)
  })

  it('is unchanged by prepared UVs, colour finishes and dollhouse visibility', () => {
    const { house, floorMat, signature, meshes } = fixture()
    const top = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), floorMat)
    house.roof.add(top)
    const original = signature()
    house.roof.visible = false
    floorMat.color.set('blue')
    ensureLayout(house, meshes())
    expect(signature()).toBe(original)
    expect(ensureLayout(house, meshes())).toBe(ensureLayout(house, meshes()))
  })
})

describe('lightmap binding', () => {
  it('rejects older or unrelated sidecars and invalid atlas settings', () => {
    const meta = { plan: 'a', preset: 'golden', signature: 'gi2-scene', size: 2048, density: 75, scale: Math.PI }
    expect(validateLightmap(meta, 'a', 'golden', 'gi2-scene')).toBeUndefined()
    expect(validateLightmap(meta, 'b', 'golden', 'gi2-scene')).toMatch(/plan/)
    expect(validateLightmap(meta, 'a', 'day', 'gi2-scene')).toMatch(/preset/)
    expect(validateLightmap({ ...meta, signature: 'd394fdf0' }, 'a', 'golden', 'gi2-scene')).toMatch(/signature/)
    expect(validateLightmap({ ...meta, size: 4096 }, 'a', 'golden', 'gi2-scene')).toMatch(/metadata/)
  })

  it('keeps a mismatched atlas on live lighting and reports why', async () => {
    const { house, interior, site, preset } = fixture()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ plan: house.plan.id, preset: preset.id, signature: 'old' })))
    const binding = new LightmapBinding()
    await binding.apply(house, interior, site, preset, true)
    expect(binding.status).toMatchObject({ state: 'live', reason: 'bake signature mismatch', bakedSignature: 'old' })
    expect(loadRgbeWebp).not.toHaveBeenCalled()
  })

  it('binds only receivers and discards a decode that finishes after the scene changes', async () => {
    const { house, interior, site, preset, signature, floor, floorMat, planter, meshes } = fixture()
    const density = ensureLayout(house, meshes()).layout.density
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      plan: house.plan.id, preset: preset.id, signature: signature(), size: 2048, density, scale: Math.PI,
    })))
    const binding = new LightmapBinding()
    const decoded = { W: 1024, H: 1024, data: new Float32Array(1024 * 1024 * 4), bytes: 500_000 }
    vi.mocked(loadRgbeWebp).mockResolvedValueOnce(decoded)
    await binding.apply(house, interior, site, preset, true)
    expect(binding.status).toMatchObject({ state: 'bound', size: 1024, bytes: 500_000 })
    expect((floor.material as THREE.MeshStandardMaterial).lightMap).not.toBeNull()
    expect(planter.material.lightMap).toBeNull()
    floorMat.color.set('red')
    binding.syncMaterials()
    expect(floor.material.color.getHex()).toBe(0xff0000)

    let finish!: (value: typeof decoded) => void
    vi.mocked(loadRgbeWebp).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const stale = binding.apply(house, interior, site, preset, true)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    binding.clear('house was replaced')
    finish(decoded)
    await stale
    expect(floor.material).toBe(floorMat)
    expect(binding.status).toEqual({ state: 'live', reason: 'house was replaced' })
  })
})
