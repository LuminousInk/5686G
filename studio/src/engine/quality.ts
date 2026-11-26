// Quality tiers. Phones get a lighter pipeline (smaller shadow maps, half-res AO, fewer grass blades, cheap glass),
// desktops get the full one. Everything refines further while the camera holds still (see RenderPipeline).

export type Tier = 'low' | 'medium' | 'high'

export interface QualitySettings {
  tier: Tier
  maxPixelRatio: number
  shadowMapSize: number
  aoHalfRes: boolean
  aoSamples: number
  grassBlades: number
  ornamentalClumps: number
  forestTrees: number
  texRes: '512' | '1k' | '2k'
  hdriRes: '1k' | '2k'
  transmissionGlass: boolean
  accumulateFrames: number
  bloom: boolean
  treeDetail: number
}

export const TIERS: Record<Tier, QualitySettings> = {
  low: {
    tier: 'low',
    maxPixelRatio: 1.5,
    shadowMapSize: 2048,
    aoHalfRes: true,
    aoSamples: 8,
    grassBlades: 50000,
    ornamentalClumps: 36,
    forestTrees: 40,
    texRes: '512',
    hdriRes: '1k',
    transmissionGlass: false,
    accumulateFrames: 24,
    bloom: true,
    treeDetail: 0.5,
  },
  medium: {
    tier: 'medium',
    maxPixelRatio: 1.75,
    shadowMapSize: 2048,
    aoHalfRes: true,
    aoSamples: 12,
    grassBlades: 140000,
    ornamentalClumps: 70,
    forestTrees: 80,
    texRes: '1k',
    hdriRes: '2k',
    transmissionGlass: true,
    accumulateFrames: 48,
    bloom: true,
    treeDetail: 0.8,
  },
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    shadowMapSize: 4096,
    aoHalfRes: false,
    aoSamples: 16,
    grassBlades: 320000,
    ornamentalClumps: 110,
    forestTrees: 140,
    texRes: '2k',
    hdriRes: '2k',
    transmissionGlass: true,
    accumulateFrames: 96,
    bloom: true,
    treeDetail: 1,
  },
}

export function detectTier(): Tier {
  const override = new URLSearchParams(location.search).get('quality')
  if (override === 'low' || override === 'medium' || override === 'high') return override
  const coarse = matchMedia('(pointer: coarse)').matches
  const small = Math.min(screen.width, screen.height) < 820
  const cores = navigator.hardwareConcurrency ?? 4
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  if (coarse && small) return 'low'
  if (coarse || cores <= 4 || mem <= 4) return 'medium'
  return 'high'
}
