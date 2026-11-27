import { Geodetic } from '@takram/three-geospatial'
import { Data3DTexture, DataTexture, MathUtils, PerspectiveCamera, Vector3, type WebGLRenderer } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoastalAtmosphere, atmosphereSunDirection, palisadesFrame } from './atmosphere'
import * as precompute from './atmospherePrecompute'
import { TIME_PRESETS } from './environment'

function rendererWith(extension?: string) {
  return { extensions: { has: (name: string) => name === extension } } as WebGLRenderer
}

function testTables() {
  return {
    transmittanceTexture: new DataTexture(),
    scatteringTexture: new Data3DTexture(),
    dispose: vi.fn(),
  }
}

afterEach(() => vi.restoreAllMocks())

describe('coastal atmosphere', () => {
  it('places the ocean on the Palisades WGS84 datum and preserves local metre scale', () => {
    const frame = palisadesFrame(-32)
    const sea = new Geodetic().setFromECEF(new Vector3(0, -32, 0).applyMatrix4(frame))
    const hill = new Geodetic().setFromECEF(new Vector3().applyMatrix4(frame))
    expect(MathUtils.radToDeg(sea.latitude)).toBeCloseTo(34.05, 6)
    expect(MathUtils.radToDeg(sea.longitude)).toBeCloseTo(-118.53, 6)
    expect(sea.height).toBeCloseTo(0, 5)
    expect(hill.height).toBeCloseTo(32, 5)
    expect(frame.determinant()).toBeCloseTo(1, 8)
  })

  it('keeps the same solar bearing and elevation after changing coordinate frames', () => {
    const frame = palisadesFrame(-32)
    const worldSun = new Vector3(-0.79, 0.36, 0.49).normalize()
    const restored = atmosphereSunDirection('golden', worldSun, frame, new Vector3()).transformDirection(frame.invert())
    expect(restored.distanceTo(worldSun)).toBeLessThan(1e-12)
    const twilight = atmosphereSunDirection('dusk', worldSun, palisadesFrame(0), new Vector3())
      .transformDirection(palisadesFrame(0).invert())
    expect(twilight.y).toBeLessThan(0)
  })

  it('precomputes once and fades only on exterior daylight frames', async () => {
    const tables = testTables()
    let finish!: (value: typeof tables) => void
    const generate = vi.spyOn(precompute, 'precomputeCoastalAtmosphere')
      .mockReturnValue(new Promise(resolve => { finish = resolve }))
    const atmosphere = new CoastalAtmosphere(new PerspectiveCamera())
    const renderer = rendererWith('EXT_color_buffer_half_float')
    const [golden, , dusk, night] = TIME_PRESETS
    const sun = new Vector3(0, 1, 0)
    try {
      const pending = atmosphere.prepare(renderer)
      expect(atmosphere.prepare(renderer)).toBe(pending)
      atmosphere.configure(golden, sun, -28)
      atmosphere.setView(false, true, 0.1)
      expect(atmosphere.pass.enabled).toBe(false)
      expect(atmosphere.settled).toBe(false)
      finish(tables)
      expect(await pending).toBe(true)
      expect(generate).toHaveBeenCalledTimes(1)
      expect(atmosphere.mesh.material.scatteringTexture).toBe(tables.scatteringTexture)

      expect(atmosphere.needsTransition(false)).toBe(true)
      expect(atmosphere.setView(false, false, 0.18)).toBe(false)
      expect(atmosphere.weight).toBeCloseTo(0.5)
      expect(atmosphere.setView(true, false, 10)).toBe(false)
      expect(atmosphere.weight).toBe(0)
      expect(atmosphere.settled).toBe(true)
      atmosphere.configure(night, sun, -28)
      expect(atmosphere.setView(false, false, 10)).toBe(false)
      expect(atmosphere.weight).toBe(0)
      expect(atmosphere.settled).toBe(true)
      atmosphere.configure(dusk, sun, -28)
      expect(atmosphere.setView(false, false, 0.18)).toBe(true)
      expect(atmosphere.weight).toBe(1)
      expect(atmosphere.settled).toBe(true)
      expect(atmosphere.needsTransition(false)).toBe(false)
      expect(atmosphere.setView(false, false, 0.18)).toBe(false)
    } finally {
      atmosphere.pass.dispose()
      atmosphere.dispose()
    }
    expect(tables.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the HDRI active when color render targets are unsupported or generation fails', async () => {
    const generate = vi.spyOn(precompute, 'precomputeCoastalAtmosphere').mockRejectedValue(new Error('incomplete'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const extension of [undefined, 'EXT_color_buffer_float']) {
      const atmosphere = new CoastalAtmosphere(new PerspectiveCamera())
      try {
        const renderer = rendererWith(extension)
        expect(await atmosphere.prepare(renderer)).toBe(false)
        expect(await atmosphere.prepare(renderer)).toBe(false)
        expect(atmosphere.setView(false, false, 1)).toBe(false)
        expect(atmosphere.pass.enabled).toBe(false)
        expect(atmosphere.settled).toBe(true)
      } finally {
        atmosphere.pass.dispose()
        atmosphere.dispose()
      }
    }
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('aborts work on teardown and disposes any tables that complete concurrently', async () => {
    const tables = testTables()
    const generate = vi.spyOn(precompute, 'precomputeCoastalAtmosphere').mockResolvedValue(tables)
    const atmosphere = new CoastalAtmosphere(new PerspectiveCamera())
    const pending = atmosphere.prepare(rendererWith('EXT_color_buffer_float'))
    atmosphere.dispose()
    atmosphere.pass.dispose()
    expect(generate.mock.calls[0][1].aborted).toBe(true)
    expect(await pending).toBe(false)
    expect(tables.dispose).toHaveBeenCalledTimes(1)
  })
})
