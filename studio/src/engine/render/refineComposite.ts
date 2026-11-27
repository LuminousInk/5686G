import * as THREE from 'three'
import { Pass } from 'postprocessing'
import type { TimePreset } from '../env/environment'

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

/** Blends exposed linear HDR before the existing bloom, AgX, grade and SMAA passes. */
export class RefineComposite extends Pass {
  private material: THREE.ShaderMaterial
  private exposureMaterial: THREE.ShaderMaterial
  private denoiseMaterial: THREE.ShaderMaterial
  private denoiseTargets: THREE.WebGLRenderTarget[]
  private exposure = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  })

  constructor(camera: THREE.PerspectiveCamera) {
    super('RefineComposite')
    this.needsDepthTexture = true
    this.denoiseTargets = Array.from({ length: 2 }, () => new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    }))
    const uniforms = {
      tRaster: { value: null }, tRay: { value: null }, tRasterDepth: { value: null }, tRayDepth: { value: null },
      tFiltered: { value: null }, tInput: { value: null },
      clip: { value: new THREE.Vector2(camera.near, camera.far) },
      texel: { value: new THREE.Vector2() }, exposure: { value: 1 }, blend: { value: 0 },
      stepSize: { value: 1 }, spread: { value: 1 }, firstPass: { value: true }, detail: { value: 0 },
      interior: { value: 0 }, warmth: { value: 0 }, exteriorFill: { value: 0 },
      tExposure: { value: this.exposure.texture },
    }
    const common = /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D tRaster, tFiltered;
      uniform highp sampler2D tRay, tRayDepth, tRasterDepth;
      uniform vec2 clip;
      uniform float exposure;
      float photoLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      float viewDistance(float d) { return clip.x * clip.y / mix(clip.y, clip.x, d); }
      float coverage(vec2 uv) {
        float a = viewDistance(texture2D(tRasterDepth, uv).r);
        float b = viewDistance(texture2D(tRayDepth, uv).r);
        return step(b, a + max(0.045, a * 0.012));
      }
    `
    this.denoiseMaterial = new THREE.ShaderMaterial({
      uniforms, vertexShader, depthTest: false, depthWrite: false,
      fragmentShader: common + /* glsl */ `
        uniform highp sampler2D tInput;
        uniform vec2 texel;
        uniform float stepSize;
        uniform bool firstPass;
        vec3 encode(vec3 rgb, vec3 guide) {
          rgb = max(vec3(0.0), rgb * exposure);
          // Very bright isolated paths should not spread over otherwise dark surfaces.
          float cap = max(2.5, photoLuma(guide) * 5.0);
          rgb *= min(1.0, cap / max(0.0001, photoLuma(rgb)));
          return log(1.0 + rgb * 2.0);
        }
        void main() {
          vec4 center = texture2D(tInput, vUv);
          if (center.a < 0.002) {
            gl_FragColor = vec4(0.0);
            return;
          }
          vec3 guide = texture2D(tRaster, vUv).rgb;
          vec3 lab = log(vec3(0.10) + guide);
          float d = viewDistance(texture2D(tRayDepth, vUv).r);
          vec3 color = firstPass ? encode(center.rgb, guide) : center.rgb;
          vec3 sum = color * 3.0;
          float total = 3.0;
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              if (x == 0 && y == 0) continue;
              vec2 uv = vUv + vec2(float(x), float(y)) * texel * stepSize;
              vec4 tap = texture2D(tInput, uv);
              vec3 g = texture2D(tRaster, uv).rgb;
              float z = viewDistance(texture2D(tRayDepth, uv).r);
              float depthWeight = exp(-abs(d - z) / max(0.06, d * 0.054));
              float edgeWeight = exp(-1.7 * length(log(vec3(0.10) + g) - lab));
              float w = tap.a * depthWeight * edgeWeight;
              vec3 c = firstPass ? encode(tap.rgb, g) : tap.rgb;
              sum += c * w;
              total += w;
            }
          }
          gl_FragColor = vec4(sum / total, center.a);
        }
      `,
    })
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader, depthTest: false, depthWrite: false,
      fragmentShader: common + /* glsl */ `
        uniform sampler2D tExposure;
        uniform float blend, detail, interior, warmth, exteriorFill;
        uniform vec2 texel;
        void main() {
          vec3 raster = texture2D(tRaster, vUv).rgb;
          vec4 ray = texture2D(tRay, vUv);
          float alpha = ray.a * coverage(vUv);
          if (alpha < 0.001 || blend <= 0.0) {
            gl_FragColor = vec4(raster, 1.0);
            return;
          }
          vec3 filtered = (exp(texture2D(tFiltered, vUv).rgb) - 1.0) * 0.5;
          vec3 sharp = clamp(ray.rgb * exposure, vec3(0.0), filtered * 2.5 + 0.15);
          vec3 color = mix(filtered, sharp, detail) * texture2D(tExposure, vec2(0.5)).r;
          vec3 base = 0.25 * (
            texture2D(tRaster, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tRaster, vUv - vec2(texel.x, 0.0)).rgb +
            texture2D(tRaster, vUv + vec2(0.0, texel.y)).rgb + texture2D(tRaster, vUv - vec2(0.0, texel.y)).rgb
          );
          vec3 grain = clamp(log((raster + 0.08) / (base + 0.08)), -0.13, 0.13);
          color *= exp(grain * 0.48 * (1.0 - detail));
          color *= mix(vec3(1.0), vec3(1.042, 1.012, 0.955), warmth);
          float luma = photoLuma(color);
          color *= 1.0 + interior * 0.08 * smoothstep(0.04, 0.18, luma) * (1.0 - smoothstep(0.58, 1.4, luma));
          // Retain enough raster ambient fill to match the surrounding landscape at dusk. The
          // trace omits the terrain that would supply ground bounce and the raster airlight pass.
          float baseLuma = photoLuma(raster);
          float fill = max(0.0, baseLuma * exteriorFill - photoLuma(color));
          color += raster * (fill / max(0.001, baseLuma));
          gl_FragColor = vec4(mix(raster, color, blend * alpha), 1.0);
        }
      `,
    })
    this.exposureMaterial = new THREE.ShaderMaterial({
      uniforms, vertexShader, depthTest: false, depthWrite: false,
      fragmentShader: common + /* glsl */ `
        void main() {
          float sum = 0.0;
          float total = 0.0;
          // Compare corresponding opaque midtones and winsorize; specular highlights and windows
          // should change with the transport, without moving the whole image's exposure.
          for (int y = 0; y < 12; y++) {
            for (int x = 0; x < 16; x++) {
              vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(16.0, 12.0);
              vec4 ray = texture2D(tRay, uv);
              float base = photoLuma(texture2D(tRaster, uv).rgb);
              float trace = photoLuma((exp(texture2D(tFiltered, uv).rgb) - 1.0) * 0.5);
              float w = step(0.92, ray.a) * coverage(uv) * smoothstep(0.045, 0.16, base)
                * (1.0 - smoothstep(0.7, 1.5, base));
              sum += w * clamp(log((base + 0.015) / (trace + 0.015)), -0.7, 0.7);
              total += w;
            }
          }
          gl_FragColor = vec4(exp(clamp(sum / max(6.0, total), -0.25, 0.28)));
        }
      `,
    })
    this.fullscreenMaterial = this.material
  }

  override setDepthTexture(texture: THREE.Texture | null) {
    this.material.uniforms.tRasterDepth.value = texture
  }

  setSource(
    raster: THREE.Texture, ray: THREE.Texture, depth: THREE.Texture, exposure: number, blend: number, samples: number,
    inside: boolean, preset: TimePreset['id'],
  ) {
    const u = this.material.uniforms
    u.tRaster.value = raster
    u.tRay.value = ray
    u.tRayDepth.value = depth
    const { width, height } = ray.image as { width: number; height: number }
    u.texel.value.set(1 / width, 1 / height)
    for (const target of this.denoiseTargets) target.setSize(width, height)
    u.exposure.value = exposure
    u.blend.value = blend
    u.interior.value = inside ? 1 : 0
    u.warmth.value = inside ? (preset === 'golden' ? 0.85 : preset === 'dusk' ? 0.48 : 0) : 0
    u.exteriorFill.value = inside ? 0 : (preset === 'dusk' || preset === 'night' ? 0.80 : 0.56)
    const convergence = THREE.MathUtils.smoothstep(samples, 4, 64)
    u.spread.value = THREE.MathUtils.lerp(2.25, 0.5, convergence)
    u.detail.value = 0.55 * convergence
  }

  clearSource() {
    const u = this.material.uniforms
    u.tRaster.value = u.tRay.value = u.tRayDepth.value = u.tInput.value = u.tFiltered.value = null
  }

  override render(renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms
    this.fullscreenMaterial = this.denoiseMaterial
    let input = u.tRay.value
    for (let i = 0; i < 3; i++) {
      const output = this.denoiseTargets[i % 2]
      u.firstPass.value = i === 0
      u.stepSize.value = u.spread.value * (1 << i) * 0.82
      u.tInput.value = input
      renderer.setRenderTarget(output)
      renderer.render(this.scene, this.camera)
      input = output.texture
    }
    u.tFiltered.value = input
    this.fullscreenMaterial = this.exposureMaterial
    renderer.setRenderTarget(this.exposure)
    renderer.render(this.scene, this.camera)
    this.fullscreenMaterial = this.material
    renderer.setRenderTarget(output)
    renderer.render(this.scene, this.camera)
  }

  override dispose() {
    this.material.dispose()
    this.denoiseMaterial.dispose()
    for (const target of this.denoiseTargets) target.dispose()
    this.exposureMaterial.dispose()
    this.exposure.dispose()
  }
}
