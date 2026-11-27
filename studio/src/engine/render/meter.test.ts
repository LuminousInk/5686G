import { describe, expect, it } from 'vitest'
import { exposureFor } from './meter'

describe('interior exposure', () => {
  it('places even room lighting at the metered key', () => {
    expect(exposureFor({ mean: 0.05, high: 0.08 }, 0.25, 0.72)).toBe(5)
  })

  it('holds back broad lit surfaces', () => {
    const high = 0.24
    const exposure = exposureFor({ mean: 0.05, high }, 0.25, 0.72)
    expect(high * exposure).toBeCloseTo(0.86)
  })

  it('keeps midtones readable when windows fill the bright end of the frame', () => {
    expect(exposureFor({ mean: 0.05, high: 8 }, 0.25, 0.72)).toBeCloseTo(5 * 0.57)
  })

  it('bounds metered gain in very dark halls and overbright rooms', () => {
    expect(exposureFor({ mean: 0.0006, high: 0.001 }, 0.25, 0.72)).toBe(120)
    expect(exposureFor({ mean: 100, high: 100 }, 0.25, 0.72)).toBeCloseTo(0.72 * 0.28)
  })
})
