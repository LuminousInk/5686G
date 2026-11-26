declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three'
  import { Pass } from 'postprocessing'
  export interface N8AOConfiguration {
    aoRadius: number
    distanceFalloff: number
    intensity: number
    color: Color
    halfRes: boolean
    aoSamples: number
    denoiseSamples: number
    denoiseRadius: number
    denoiseIterations: number
    gammaCorrection: boolean
    accumulate: boolean
    screenSpaceRadius: boolean
    transparencyAware: boolean
    renderMode: number
  }
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: N8AOConfiguration
    setQualityMode(mode: string): void
  }
}
