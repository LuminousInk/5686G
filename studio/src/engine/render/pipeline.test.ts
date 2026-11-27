import { ShaderChunk } from 'three'
import { expect, it } from 'vitest'
import './pipeline'

it('uses a fixed 2D PCF disk for accumulation and keeps point-light sampling intact', () => {
  const [shadow2D, pointShadow] = ShaderChunk.shadowmap_pars_fragment.split('float getPointShadow')
  expect(shadow2D).toMatch(/const float phi = 0\.0;\s+shadow = \(/)
  expect(pointShadow).toContain('interleavedGradientNoise( gl_FragCoord.xy )')
})
