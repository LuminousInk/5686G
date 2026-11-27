import { ShaderChunk } from 'three'
import { expect, it } from 'vitest'
import { motionAOIntensity } from './pipeline'

it('uses a fixed 2D PCF disk for accumulation and keeps point-light sampling intact', () => {
  const [shadow2D, pointShadow] = ShaderChunk.shadowmap_pars_fragment.split('float getPointShadow')
  expect(shadow2D).toMatch(/const float phi = 0\.0;\s+shadow = \(/)
  expect(pointShadow).toContain('interleavedGradientNoise( gl_FragCoord.xy )')
})

it('uses lighter AO in motion and restores the original still strength', () => {
  expect(motionAOIntensity(false, 0)).toBe(3.3)
  expect(motionAOIntensity(false, 1)).toBe(3.3)
  expect(motionAOIntensity(true, 0)).toBe(2.5)
  expect(motionAOIntensity(true, 0.5)).toBeCloseTo(1.925)
  expect(motionAOIntensity(true, 1)).toBeCloseTo(1.35)
})
