import * as THREE from 'three'
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  Pass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import type { TimePreset } from '../env/environment'
import type { QualitySettings } from '../quality'
import { Meter } from './meter'

// Three's 2D PCF rotates its five-tap disk per screen pixel. The pattern survives temporal averaging,
// particularly on high-contrast sun patches. Keep the PCF disk fixed and let the sun jitter do the averaging.
const screenSpacePcfPhase = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;(?=\s+shadow = \()/
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(
  screenSpacePcfPhase, 'const float phi = 0.0;',
)

/**
 * Accumulates jittered frames while the camera holds still: anti-aliasing, soft sun shadows (the sun is jittered
 * inside its disk) and denoised AO all converge into a clean, supersampled image. Works in linear HDR before tone
 * mapping so bright highlights average correctly. Also applies exposure.
 */
class AccumulatePass extends Pass {
  private targets: THREE.WebGLRenderTarget[]
  private index = 0
  count = 0
  exposure = 1
  /** meters the next frame (before exposure) when set */
  meterNext = false
  readonly meter = new Meter()
  private copyMat: THREE.ShaderMaterial

  constructor() {
    super('AccumulatePass')
    const mk = () =>
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
    this.targets = [mk(), mk()]
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      uniforms: { tCurrent: { value: null }, tHistory: { value: null }, weight: { value: 1 }, exposure: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tCurrent; uniform sampler2D tHistory; uniform float weight; uniform float exposure;
        varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tCurrent, vUv);
          c.rgb *= exposure;
          // clamp fireflies a little so single hot samples don't dominate the average
          c.rgb = min(c.rgb, vec3(64.0));
          vec4 h = texture2D(tHistory, vUv);
          gl_FragColor = mix(h, c, weight);
        }`,
      depthTest: false,
      depthWrite: false,
    })
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tMap; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tMap, vUv); }',
      depthTest: false,
      depthWrite: false,
    })
  }

  override setSize(w: number, h: number) {
    for (const t of this.targets) t.setSize(w, h)
    this.count = 0
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget | null) {
    if (this.meterNext) {
      this.meterNext = false
      this.meter.measure(renderer, inputBuffer.texture)
    }
    const m = this.fullscreenMaterial as THREE.ShaderMaterial
    const write = this.targets[this.index]
    const read = this.targets[1 - this.index]
    m.uniforms.tCurrent.value = inputBuffer.texture
    m.uniforms.tHistory.value = read.texture
    m.uniforms.weight.value = 1 / (this.count + 1)
    m.uniforms.exposure.value = this.exposure
    renderer.setRenderTarget(write)
    renderer.render(this.scene, this.camera)
    // copy the accumulated image on to the next pass
    const fs = this.fullscreenMaterial
    this.copyMat.uniforms.tMap.value = write.texture
    this.fullscreenMaterial = this.copyMat
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
    this.fullscreenMaterial = fs
    this.index = 1 - this.index
    this.count++
  }
}

/** Display-referred grade: contrast, saturation, white balance and a gentle shadow lift. */
class GradeEffect extends Effect {
  constructor() {
    super(
      'GradeEffect',
      `
      uniform float contrast; uniform float saturation; uniform float warmth;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = clamp(mix(vec3(l), c, saturation), 0.0, 1.0);
        // gentle S-curve around mid grey (linear space ~0.18)
        vec3 x = pow(c, vec3(1.0 / 2.2));
        x = x + contrast * (x - x * x) * (2.0 * x - 1.0);
        c = pow(clamp(x, 0.0, 1.0), vec3(2.2));
        float w = warmth * (1.0 - smoothstep(0.35, 0.95, l));
        c *= vec3(1.0 + w, 1.0 + w * 0.25, 1.0 - w * 0.6);
        vec3 toe = 1.0 - c;
        c += 0.18 * c * toe * toe * toe;
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ['contrast', new THREE.Uniform(0)],
          ['saturation', new THREE.Uniform(1)],
          ['warmth', new THREE.Uniform(0)],
        ]),
      },
    )
  }
  set(contrast: number, saturation: number, warmth: number) {
    this.uniforms.get('contrast')!.value = contrast
    this.uniforms.get('saturation')!.value = saturation
    this.uniforms.get('warmth')!.value = warmth
  }
}

// Halton (2,3) low-discrepancy jitter
function halton(i: number, b: number) {
  let f = 1
  let r = 0
  while (i > 0) {
    f /= b
    r += f * (i % b)
    i = Math.floor(i / b)
  }
  return r
}

export class RenderPipeline {
  readonly composer: EffectComposer
  readonly ao: N8AOPostPass
  readonly bloom: BloomEffect
  readonly grade: GradeEffect
  readonly tone: ToneMappingEffect
  private accumulate: AccumulatePass
  private renderPass: RenderPass
  /** frames to accumulate while still (0 = off) */
  maxFrames: number
  enabled = true

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    q: QualitySettings,
  ) {
    this.maxFrames = q.accumulateFrames
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 })
    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.ao = new N8AOPostPass(scene, camera, size.x, size.y)
    const c = this.ao.configuration
    c.aoRadius = 0.46
    c.distanceFalloff = 1.1
    c.intensity = 3.3
    c.halfRes = q.aoHalfRes
    c.aoSamples = q.aoSamples
    c.denoiseSamples = 6
    c.denoiseRadius = 7
    c.gammaCorrection = false
    c.color = new THREE.Color(0, 0, 0)
    this.composer.addPass(this.ao)
    this.accumulate = new AccumulatePass()
    this.composer.addPass(this.accumulate)
    this.bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD, intensity: 0, luminanceSmoothing: 0.24,
      mipmapBlur: true, levels: q.tier === 'low' ? 5 : 7,
    })
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX })
    this.grade = new GradeEffect()
    const vignette = new VignetteEffect({ darkness: 0.20, offset: 0.36 })
    this.composer.addPass(new EffectPass(camera, this.bloom, this.tone, this.grade, vignette))
    this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })))
  }

  setToneMapping(id: string) {
    this.tone.mode = id === 'aces' ? ToneMappingMode.ACES_FILMIC : id === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX
  }

  setLook({ bloom, grade }: Pick<TimePreset, 'bloom' | 'grade'>) {
    this.bloom.intensity = bloom.intensity
    this.bloom.luminanceMaterial.threshold = bloom.threshold
    this.bloom.mipmapBlurPass.radius = bloom.radius
    this.grade.set(grade.contrast, grade.saturation, grade.warmth)
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h, false)
  }

  set exposure(v: number) {
    this.accumulate.exposure = v
  }

  get frames() {
    return this.accumulate.count
  }

  /** Light meter on the HDR frame; call requestMeter() before a render to take a reading. */
  get meter() {
    return this.accumulate.meter
  }

  requestMeter() {
    this.accumulate.meterNext = true
  }

  get converged() {
    return this.maxFrames > 0 && this.accumulate.count >= this.maxFrames
  }

  reset() {
    this.accumulate.count = 0
  }

  /** Sub-pixel jitter for the next accumulated frame (call before render). */
  jitter(w: number, h: number) {
    const n = this.accumulate.count
    if (n === 0 || this.maxFrames === 0) {
      this.camera.clearViewOffset()
      return
    }
    const jx = halton(n + 1, 2) - 0.5
    const jy = halton(n + 1, 3) - 0.5
    this.camera.setViewOffset(w, h, jx, jy, w, h)
  }

  /** A point on the sun disk for soft-shadow accumulation (unit vector near `dir`). */
  sunSample(dir: THREE.Vector3, angularRadius: number, out: THREE.Vector3) {
    const n = this.accumulate.count
    if (n === 0) return out.copy(dir)
    const r = Math.sqrt(halton(n + 1, 5)) * angularRadius
    const a = halton(n + 1, 7) * Math.PI * 2
    const t = new THREE.Vector3(0, 1, 0).cross(dir)
    if (t.lengthSq() < 1e-6) t.set(1, 0, 0)
    t.normalize()
    const b = new THREE.Vector3().crossVectors(dir, t)
    return out.copy(dir).addScaledVector(t, Math.cos(a) * r).addScaledVector(b, Math.sin(a) * r).normalize()
  }

  render(dt: number) {
    this.composer.render(dt)
  }

  dispose() {
    this.accumulate.meter.dispose()
    this.composer.dispose()
  }
}
