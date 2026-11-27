import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Geodetic } from '@takram/three-geospatial'
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoastalAtmosphere, atmosphereSunDirection, palisadesFrame } from './atmosphere'
import { TIME_PRESETS } from './environment'

const packed = readFileSync(new URL('./atmosphere-lut/coastal.bin', import.meta.url))

afterEach(() => vi.unstubAllGlobals())

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

  it('packs the original half-float samples available to the low-altitude shaders', () => {
    const require = createRequire(import.meta.url)
    const upstream = resolve(require.resolve('@takram/three-atmosphere'), '../../assets')
    const transmittance = readFileSync(resolve(upstream, 'transmittance.bin'))
    const scattering = readFileSync(resolve(upstream, 'scattering.bin'))
    const data = gunzipSync(packed)
    expect(data.byteLength).toBe(transmittance.byteLength + 256 * 128 * 8 * 8)
    expect(data.subarray(0, transmittance.byteLength).equals(transmittance)).toBe(true)
    expect(data.subarray(transmittance.byteLength).equals(scattering.subarray(0, 256 * 128 * 8 * 8))).toBe(true)
  })

  it('loads the shared tables once and bypasses the daylight pass indoors and at night', async () => {
    const fetch = vi.fn(async () => new Response(Uint8Array.from(packed)))
    vi.stubGlobal('fetch', fetch)
    const atmosphere = new CoastalAtmosphere(new PerspectiveCamera())
    const golden = TIME_PRESETS[0]
    const dusk = TIME_PRESETS[2]
    const night = TIME_PRESETS[3]
    const sun = new Vector3(0, 1, 0)
    try {
      await Promise.all([atmosphere.prepare(golden), atmosphere.prepare(dusk)])
      expect(fetch).toHaveBeenCalledTimes(1)
      atmosphere.configure(golden, sun, -28)
      atmosphere.setView(false, true)
      expect(atmosphere.pass.enabled).toBe(true)
      atmosphere.setView(true, false)
      expect(atmosphere.pass.enabled).toBe(false)
      atmosphere.configure(night, sun, -28)
      atmosphere.setView(false, false)
      expect(atmosphere.pass.enabled).toBe(false)
    } finally {
      atmosphere.pass.dispose()
      atmosphere.dispose()
    }
  })

  it('keeps the HDRI available after a failed table request and retries on the next preset', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(Uint8Array.from(packed)))
    vi.stubGlobal('fetch', fetch)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const atmosphere = new CoastalAtmosphere(new PerspectiveCamera())
    try {
      expect(await atmosphere.prepare(TIME_PRESETS[0])).toBe(false)
      atmosphere.setView(false, false)
      expect(atmosphere.pass.enabled).toBe(false)
      expect(await atmosphere.prepare(TIME_PRESETS[1])).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
      atmosphere.pass.dispose()
      atmosphere.dispose()
    }
  })
})
