import * as THREE from 'three'
import { AerialPerspectiveEffect, SkyMaterial } from '@takram/three-atmosphere'
import { Ellipsoid, Geodetic } from '@takram/three-geospatial'
import { EffectPass } from 'postprocessing'
import type { TimePreset } from './environment'
import { canPrecomputeAtmosphere, coastalScatteringZScale, precomputeCoastalAtmosphere } from './atmospherePrecompute'

const { degToRad } = THREE.MathUtils
const origin = new Geodetic(degToRad(-118.53), degToRad(34.05)).toECEF()
const east = new THREE.Vector3()
const north = new THREE.Vector3()
const up = new THREE.Vector3()
Ellipsoid.WGS84.getEastNorthUpVectors(origin, east, north, up)

/** East, up, south in a right-handed metre-scale scene. The plan's ocean sets datum zero. */
export function palisadesFrame(seaLevel: number) {
  return new THREE.Matrix4().makeBasis(east, up, north.clone().negate())
    .setPosition(origin.clone().addScaledVector(up, -seaLevel))
}

// Qwantani dusk has no visible disk. Its warm horizon lobe is centered around azimuth 42°.
const twilightElevation = degToRad(-0.5)
const twilightDirection = new THREE.Vector3(
  Math.sin(degToRad(42)) * Math.cos(twilightElevation), Math.sin(twilightElevation),
  Math.cos(degToRad(42)) * Math.cos(twilightElevation),
)

export function atmosphereSunDirection(preset: string, sceneSun: THREE.Vector3, frame: THREE.Matrix4, out: THREE.Vector3) {
  return out.copy(preset === 'dusk' ? twilightDirection : sceneSun).transformDirection(frame)
}

function replaceShaderPart(shader: string, original: string, replacement: string) {
  if (!shader.includes(original)) throw new Error(`Atmosphere shader is missing ${original}`)
  return shader.replaceAll(original, replacement)
}

function cropScatteringLookup(shader: string) {
  const scale = coastalScatteringZScale.toFixed(1)
  return replaceShaderPart(shader, 'uvwz.z, uvwz.w);', `uvwz.z, uvwz.w * ${scale});`)
}

// Extra coastal aerosol glow is strongest along shallow rays toward the setting sun.
const coastalGlowShader = /* glsl */`
  uniform vec3 coastalGlowColor;
  vec3 coastalGlow(vec3 eye, vec3 ray, vec3 sun) {
    if (coastalGlowColor.r <= 0.0) return vec3(0.0);
    float elevation = abs(dot(normalize(eye), ray));
    float sunward = max(0.0, 0.5 + 0.5 * dot(ray, sun));
    return coastalGlowColor * exp2(-20.0 * elevation) * (0.4 + 0.6 * sunward * sunward);
  }
`

// Pinned integration points in three-atmosphere 0.19's GLSL. The upstream effect handles
// view-position reconstruction, projection jitter and the two Bruneton radiance lookups.
class CoastalAerialEffect extends AerialPerspectiveEffect {
  private readonly hazeStart = new THREE.Uniform(new THREE.Vector2(55, 240))
  private readonly opticalDepthScale = new THREE.Uniform(5)
  private readonly hasOcean = new THREE.Uniform(false)

  constructor(
    camera: THREE.PerspectiveCamera,
    coastalGlowColor: THREE.Uniform<THREE.Vector3>,
    atmosphereWeight: THREE.Uniform<number>,
  ) {
    super(camera, { correctGeometricError: false, sun: false, moon: false, ground: false })
    this.uniforms.set('hazeStart', this.hazeStart)
    this.uniforms.set('opticalDepthScale', this.opticalDepthScale)
    this.uniforms.set('hasOcean', this.hasOcean)
    this.uniforms.set('coastalGlowColor', coastalGlowColor)
    this.uniforms.set('atmosphereWeight', atmosphereWeight)

    let shader = /* glsl */`
      uniform float atmosphereWeight;
      uniform vec2 hazeStart;
      uniform float opticalDepthScale;
      uniform bool hasOcean;
      ${coastalGlowShader}
      ${cropScatteringLookup(this.getFragmentShader())}
    `

    shader = replaceShaderPart(shader, 'void mainImage(', /* glsl */`
      vec3 coastalSkyRadiance(vec3 direction) {
        vec3 transmittance;
        vec3 sky = GetSkyRadiance(vCameraPosition, direction, 0.0, sunDirection, transmittance);
        return max(sky, vec3(0.0)) + coastalGlow(vCameraPosition, direction, sunDirection);
      }

      vec3 oceanAerial(vec3 color, vec3 direction) {
        // Water reserves the last two depth steps before the sky. Recover its true distance
        // by intersecting the ray with the atmosphere's sea-level sphere.
        float b = dot(vCameraPosition, direction);
        float r = length(vCameraPosition);
        float c = (r - ATMOSPHERE.bottom_radius) * (r + ATMOSPHERE.bottom_radius);
        float discriminant = b * b - c;
        float d = discriminant >= 0.0 ? -b - sqrt(discriminant) : -1.0;
        vec3 horizon = coastalSkyRadiance(direction);
        const float fadeStart = 1.8;
        const float fadeEnd = 12.0;
        if (d <= 0.0 || d >= fadeEnd) return horizon;
        // A homogeneous marine layer over the water uses Beer–Lambert extinction in km.
        // Its source radiance is the same Bruneton sky seen along the horizon.
        vec3 extinction = vec3(0.07) + opticalDepthScale * vec3(0.007, 0.009, 0.012);
        vec3 transmittance = exp(-extinction * d) * (1.0 - smoothstep(fadeStart, fadeEnd, d));
        return mix(horizon, color, transmittance);
      }

      void mainImage(`)
    shader = replaceShaderPart(shader, 'depth = reverseLogDepth(depth, cameraNear, cameraFar);', /* glsl */`
      if (hasOcean && depth >= 0.9999998) {
        outputColor = vec4(mix(inputColor.rgb, oceanAerial(inputColor.rgb, rayDirection), atmosphereWeight), inputColor.a);
        return;
      }
      depth = reverseLogDepth(depth, cameraNear, cameraFar);
      float hazeWeight = smoothstep(hazeStart.x, hazeStart.y, -getViewZ(depth));
      if (hazeWeight <= 0.0) {
        outputColor = inputColor;
        return;
      }
    `)
    // Scale optical depth for a humid coastal boundary layer and integrate the same source
    // radiance over the longer optical path. The HDR input already carries scene lighting.
    shader = replaceShaderPart(shader, '#ifdef TRANSMITTANCE\n  radiance = radiance * transmittance;', /* glsl */`
      transmittance = clamp(transmittance, 0.0, 1.0);
      vec3 coastalTransmittance = pow(transmittance, vec3(opticalDepthScale));
      inscatter = max(inscatter, vec3(0.0))
        * min(vec3(opticalDepthScale), (1.0 - coastalTransmittance) / max(vec3(0.0001), 1.0 - transmittance));
      inscatter += coastalGlow(vCameraPosition, normalize(positionECEF - vCameraPosition), sunDirection)
        * (1.0 - coastalTransmittance);
      #ifdef TRANSMITTANCE
      radiance = radiance * coastalTransmittance;`)
    shader = replaceShaderPart(shader, 'outputColor = vec4(radiance, inputColor.a);',
      'outputColor = vec4(mix(inputColor.rgb, radiance, hazeWeight * atmosphereWeight), inputColor.a);')
    this.setFragmentShader(shader)
  }

  setView(hasOcean: boolean, lowMotion: boolean) {
    this.hasOcean.value = hasOcean
    this.hazeStart.value.x = lowMotion ? 100 : 55
  }

  setOpticalDepthScale(scale: number) {
    this.opticalDepthScale.value = scale
  }
}

export class CoastalAtmosphere {
  readonly pass: EffectPass
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, SkyMaterial>
  private readonly haze: CoastalAerialEffect
  private readonly frame = new THREE.Matrix4()
  private readonly lastSun = new THREE.Vector3()
  private readonly irradianceScale: THREE.Vector3
  private readonly coastalGlowColor = new THREE.Uniform(new THREE.Vector3())
  private lastPreset?: TimePreset
  private lastSeaLevel?: number
  private readonly atmosphereWeight = new THREE.Uniform(0)
  private readonly abort = new AbortController()
  private tables?: Awaited<ReturnType<typeof precomputeCoastalAtmosphere>>
  private preparation?: Promise<boolean>
  private unavailable = false
  private inside = true
  private fadeProgress = 0
  private daylight = true
  private hasOcean = false

  constructor(camera: THREE.PerspectiveCamera) {
    const sky = new SkyMaterial({ moon: false, ground: false, sunAngularRadius: degToRad(0.27) })
    this.irradianceScale = sky.uniforms.SKY_SPECTRAL_RADIANCE_TO_LUMINANCE.value.clone()
    // Upstream shares these uniform vectors between effect instances.
    sky.uniforms.SKY_SPECTRAL_RADIANCE_TO_LUMINANCE.value = this.irradianceScale.clone()
    this.haze = new CoastalAerialEffect(camera, this.coastalGlowColor, this.atmosphereWeight)
    this.haze.uniforms.get('SKY_SPECTRAL_RADIANCE_TO_LUMINANCE')!.value = this.irradianceScale.clone()
    sky.uniforms.coastalGlowColor = this.coastalGlowColor
    sky.uniforms.atmosphereWeight = this.atmosphereWeight
    // Alpha composite over the HDRI in the opaque queue, before transparent glazing.
    sky.blending = THREE.CustomBlending
    sky.blendSrc = THREE.SrcAlphaFactor
    sky.blendDst = THREE.OneMinusSrcAlphaFactor
    sky.blendSrcAlpha = THREE.OneFactor
    sky.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
    sky.fragmentShader = replaceShaderPart(cropScatteringLookup(sky.fragmentShader), 'void main() {', `uniform float atmosphereWeight;
      ${coastalGlowShader}
      void main() {`)
    sky.fragmentShader = replaceShaderPart(sky.fragmentShader, 'outputColor.a = 1.0;', /* glsl */`
      outputColor.rgb += coastalGlow(vCameraPosition, rayDirection, sunDirection);
      outputColor.a = atmosphereWeight;
    `)
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sky)
    this.mesh.name = 'Pacific Palisades sky'
    this.mesh.frustumCulled = false
    // Draw behind the scene's depth but before transparent glass.
    this.mesh.renderOrder = 10000
    this.pass = new EffectPass(camera, this.haze)
    this.pass.enabled = false
  }

  prepare(renderer: THREE.WebGLRenderer) {
    return this.preparation ??= this.generate(renderer).then(ready => {
      this.unavailable = !ready
      return ready
    })
  }

  private async generate(renderer: THREE.WebGLRenderer) {
    const { signal } = this.abort
    if (signal.aborted || !canPrecomputeAtmosphere(renderer.extensions)) return false
    try {
      const tables = await precomputeCoastalAtmosphere(renderer, signal)
      if (signal.aborted) {
        tables.dispose()
        return false
      }
      this.tables = tables
      const { transmittanceTexture, scatteringTexture } = tables
      for (const consumer of [this.mesh.material, this.haze]) {
        consumer.transmittanceTexture = transmittanceTexture
        consumer.scatteringTexture = scatteringTexture
      }
      return true
    } catch (error) {
      if (!signal.aborted) console.warn('Atmosphere precompute unavailable, using the HDRI sky', error)
      return false
    }
  }

  configure(preset: TimePreset, sun: THREE.Vector3, seaLevel?: number) {
    const datumChanged = !this.lastPreset || this.lastSeaLevel !== seaLevel
    if (!datumChanged && preset === this.lastPreset && this.lastSun.equals(sun)) return
    if (datumChanged) {
      this.hasOcean = seaLevel !== undefined
      this.frame.copy(palisadesFrame(seaLevel ?? 0))
      this.mesh.material.worldToECEFMatrix.copy(this.frame)
      this.haze.worldToECEFMatrix.copy(this.frame)
      this.lastSeaLevel = seaLevel
    }
    this.lastPreset = preset
    this.lastSun.copy(sun)
    const sky = this.mesh.material
    this.daylight = preset.id !== 'night'
    sky.sun = preset.sunScale > 0
    atmosphereSunDirection(preset.id, sun, this.frame, sky.sunDirection)
    this.haze.sunDirection.copy(sky.sunDirection)
    const tint = this.irradianceScale.clone()
    this.coastalGlowColor.value.set(0, 0, 0)
    if (preset.id === 'golden') tint.multiply(new THREE.Vector3(4.7, 3.7, 2.9))
    else if (preset.id === 'dusk') tint.multiply(new THREE.Vector3(8, 13, 23))
    else tint.multiplyScalar(5)
    sky.uniforms.SKY_SPECTRAL_RADIANCE_TO_LUMINANCE.value.copy(tint)
    this.haze.uniforms.get('SKY_SPECTRAL_RADIANCE_TO_LUMINANCE')!.value.copy(tint)
    if (preset.id === 'golden') this.coastalGlowColor.value.set(0.26, 0.13, 0.075)
    this.haze.setOpticalDepthScale(preset.id === 'golden' ? 12 : preset.id === 'dusk' ? 3.5 : 7)
  }

  needsTransition(inside: boolean) {
    return !!this.tables && this.daylight && !inside && this.fadeProgress < 1
  }

  get weight() { return this.pass.enabled ? this.atmosphereWeight.value : 0 }

  /** Capture tools wait for the final look, while the render loop can idle on the HDRI. */
  get settled() {
    return this.inside || !this.daylight || this.unavailable || this.fadeProgress === 1
  }

  setView(inside: boolean, lowMotion: boolean, dt: number) {
    this.inside = inside
    this.haze.setView(this.hasOcean, lowMotion)
    const transitioning = this.needsTransition(inside)
    if (transitioning) {
      this.fadeProgress = Math.min(1, this.fadeProgress + dt / 0.36)
      this.atmosphereWeight.value = THREE.MathUtils.smoothstep(this.fadeProgress, 0, 1)
    }
    this.pass.enabled = this.daylight && !inside && this.fadeProgress > 0
    return transitioning && this.fadeProgress === 1
  }

  dispose() {
    this.abort.abort()
    this.tables?.dispose()
    this.mesh.material.dispose()
    this.mesh.geometry.dispose()
    // The composer owns the effect pass.
  }
}
