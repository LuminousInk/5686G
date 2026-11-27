import { describe, expect, it } from 'vitest'
import { MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three'
import type { Engine } from '../Engine'
import { TIERS } from '../quality'
import { Refinement, refinementBlend, refinementSizing, STILL_MS } from './refine'
import { reflectionSurface } from './refineSSR'

describe('still refinement', () => {
  it('cannot allocate an atlas or path samples through the default low-tier motion path', () => {
    const engine = { quality: TIERS.low } as Engine
    const still = new Refinement(engine, engine.quality.refinement.auto)
    still.cameraActive(1)
    expect(still.frame(2 + STILL_MS, true)).toBe(false)
    expect(still.status).toEqual({ state: 'idle', samples: 0, target: 0 })
  })

  it('waits for a full idle interval after the latest camera activity', () => {
    const still = new Refinement({ quality: TIERS.high } as Engine, true)
    expect(still.frame(1000, true)).toBe(true)
    still.cameraActive(1200)
    expect(still.frame(1000 + STILL_MS, true)).toBe(true)
    expect(still.status.state).toBe('idle')
    still.setAllowed(false)
    expect(still.frame(1200 + STILL_MS, true)).toBe(false)
  })

  it('starts the HDR handoff gently and converges to full weight', () => {
    expect(refinementBlend(1, false)).toBeCloseTo(0.07)
    expect(refinementBlend(8, false)).toBeCloseTo(0.535)
    expect(refinementBlend(64, false)).toBe(1)
  })

  it('keeps the texture array and ray targets within each tier budget', () => {
    for (const quality of Object.values(TIERS)) {
      for (const count of [1, 28, 73, 170, 370]) {
        const { atlas, atlasBytes, pixels } = refinementSizing(quality, count)
        expect(atlasBytes).toBeLessThanOrEqual(quality.refinement.atlasBudget)
        expect(atlas).toBeLessThanOrEqual(512)
        expect(pixels).toBe(quality.refinement.pixelBudget)
      }
    }
  })

  it('keeps screen reflections on glossy standard surfaces, including glass and finished wood', () => {
    const mirror = reflectionSurface(new MeshStandardMaterial({ roughness: 0.1, metalness: 1 }))!
    const glass = reflectionSurface(new MeshPhysicalMaterial({ transmission: 1, roughness: 0.02 }))!
    expect(mirror.strength).toBeGreaterThan(glass.strength)
    expect(glass.roughness).toBeCloseTo(0.02)
    expect(reflectionSurface(new MeshStandardMaterial({ roughness: 0.95, roughnessMap: new Texture(), name: 'floor' }))).not.toBeNull()
    expect(reflectionSurface(new MeshStandardMaterial({ roughness: 0.9 }))).toBeNull()
    expect(reflectionSurface(new MeshBasicMaterial())).toBeNull()
  })
})
