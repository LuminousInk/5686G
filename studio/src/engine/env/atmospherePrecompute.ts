import * as THREE from 'three'
import {
  AtmosphereParameters,
  IRRADIANCE_TEXTURE_HEIGHT, IRRADIANCE_TEXTURE_WIDTH,
  SCATTERING_TEXTURE_DEPTH, SCATTERING_TEXTURE_HEIGHT, SCATTERING_TEXTURE_WIDTH,
  SCATTERING_TEXTURE_MU_SIZE, SCATTERING_TEXTURE_MU_S_SIZE, SCATTERING_TEXTURE_NU_SIZE,
  TRANSMITTANCE_TEXTURE_HEIGHT, TRANSMITTANCE_TEXTURE_WIDTH,
} from '@takram/three-atmosphere'
import { common, definitions, precompute } from '@takram/three-atmosphere/shaders/bruneton'

// The runtime uses the published grid through the first four altitude slices (~560 m).
// Keep coarser samples to the top of the atmosphere for the multiple-scattering integrals.
const coastalScatteringDepth = 4
export const coastalScatteringZScale = SCATTERING_TEXTURE_DEPTH / coastalScatteringDepth
const upperStride = 4
const scratchDepth = coastalScatteringDepth + (SCATTERING_TEXTURE_DEPTH - coastalScatteringDepth) / upperStride
const scatteringWidth = SCATTERING_TEXTURE_WIDTH
const scatteringHeight = SCATTERING_TEXTURE_HEIGHT

export function canPrecomputeAtmosphere(extensions: Pick<THREE.WebGLRenderer['extensions'], 'has'>) {
  return extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float')
}

const commonShader = /* glsl */`
  precision highp float;
  precision highp int;
  precision highp sampler3D;
  #define TRANSMITTANCE_TEXTURE_WIDTH ${TRANSMITTANCE_TEXTURE_WIDTH}
  #define TRANSMITTANCE_TEXTURE_HEIGHT ${TRANSMITTANCE_TEXTURE_HEIGHT}
  #define SCATTERING_TEXTURE_R_SIZE ${SCATTERING_TEXTURE_DEPTH}
  #define SCATTERING_TEXTURE_MU_SIZE ${SCATTERING_TEXTURE_MU_SIZE}
  #define SCATTERING_TEXTURE_MU_S_SIZE ${SCATTERING_TEXTURE_MU_S_SIZE}
  #define SCATTERING_TEXTURE_NU_SIZE ${SCATTERING_TEXTURE_NU_SIZE}
  #define IRRADIANCE_TEXTURE_WIDTH ${IRRADIANCE_TEXTURE_WIDTH}
  #define IRRADIANCE_TEXTURE_HEIGHT ${IRRADIANCE_TEXTURE_HEIGHT}
  ${definitions}
  ${common}

  float scratchAltitudeUv(float publishedUv) {
    float layer = publishedUv * float(SCATTERING_TEXTURE_R_SIZE) - 0.5;
    const float last = ${(coastalScatteringDepth - 1).toFixed(1)};
    float scratchLayer = min(layer, last) + max(layer - last, 0.0) / ${upperStride.toFixed(1)};
    return (scratchLayer + 0.5) / ${scratchDepth.toFixed(1)};
  }

  uniform int layer;
  vec3 scatteringCoord() {
    const int last = ${coastalScatteringDepth - 1};
    int publishedLayer = min(layer, last) + max(layer - last, 0) * ${upperStride};
    return vec3(gl_FragCoord.xy, float(publishedLayer) + 0.5);
  }

  ${precompute.replaceAll('uvwz.z, uvwz.w);', 'uvwz.z, scratchAltitudeUv(uvwz.w));')
    .replace('const int SAMPLE_COUNT = 16;', 'const int SAMPLE_COUNT = 8;')}

  uniform AtmosphereParameters ATMOSPHERE;
  uniform sampler2D opticalDepth;
  uniform sampler2D irradiance;
  uniform sampler3D rayleigh;
  uniform sampler3D mie;
  uniform sampler3D density;
  uniform sampler3D multiple;
  uniform int order;
  layout(location = 0) out vec4 result;
`

const targetOptions = {
  type: THREE.HalfFloatType,
  depthBuffer: false,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
}

// Let each submitted group finish before queuing the next one. A camera frame can draw
// between groups, and a slow device cannot queue the entire precompute ahead of input.
async function waitForGpu(gl: WebGL2RenderingContext, signal: AbortSignal) {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  if (!fence) throw new Error('Could not fence the atmosphere precompute')
  gl.flush()
  try {
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 0))
      signal.throwIfAborted()
      const status = gl.clientWaitSync(fence, 0, 0)
      if (status === gl.WAIT_FAILED) throw new Error('Atmosphere GPU work failed')
      if (status !== gl.TIMEOUT_EXPIRED) return
    }
  } finally {
    gl.deleteSync(fence)
  }
}

/** Run the Bruneton passes against the same WebGL context that will sample their outputs. */
export async function precomputeCoastalAtmosphere(renderer: THREE.WebGLRenderer, signal: AbortSignal) {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const transmittance = new THREE.WebGLRenderTarget(TRANSMITTANCE_TEXTURE_WIDTH, TRANSMITTANCE_TEXTURE_HEIGHT, targetOptions)
  const scattering = new THREE.WebGL3DRenderTarget(scatteringWidth, scatteringHeight, coastalScatteringDepth, targetOptions)
  const opticalDepth = transmittance.clone()
  const irradiance = new THREE.WebGLRenderTarget(IRRADIANCE_TEXTURE_WIDTH, IRRADIANCE_TEXTURE_HEIGHT, targetOptions)
  const single = new THREE.WebGL3DRenderTarget(scatteringWidth, scatteringHeight, scratchDepth, targetOptions)
  single.textures.push(single.texture.clone())
  const density = new THREE.WebGL3DRenderTarget(scatteringWidth, scatteringHeight, scratchDepth, targetOptions)
  const multiple = density.clone()
  const uniforms = {
    ATMOSPHERE: AtmosphereParameters.DEFAULT.toUniform(),
    opticalDepth: new THREE.Uniform(opticalDepth.texture),
    irradiance: new THREE.Uniform(irradiance.texture),
    rayleigh: new THREE.Uniform(single.texture),
    mie: new THREE.Uniform(single.textures[1]),
    density: new THREE.Uniform(density.texture),
    multiple: new THREE.Uniform(multiple.texture),
    layer: new THREE.Uniform(0),
    order: new THREE.Uniform(2),
  }

  const materials: THREE.RawShaderMaterial[] = []
  function material(body: string, logTransmittance = true) {
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: logTransmittance ? { TRANSMITTANCE_PRECISION_LOG: 1 } : {},
      vertexShader: 'in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: commonShader + body,
      uniforms,
      depthTest: false,
      depthWrite: false,
    })
    materials.push(mat)
    return mat
  }
  const transmittanceShader = /* glsl */`
    void main() {
      result = vec4(ComputeTransmittanceToTopAtmosphereBoundaryTexture(ATMOSPHERE, gl_FragCoord.xy), 1.0);
    }
  `
  const transmittanceMaterial = material(transmittanceShader, false)
  const opticalDepthMaterial = material(transmittanceShader)
  const direct = material(/* glsl */`
    void main() {
      result = vec4(ComputeDirectIrradianceTexture(ATMOSPHERE, opticalDepth, gl_FragCoord.xy), 1.0);
    }
  `)
  const singleScattering = material(/* glsl */`
    layout(location = 1) out vec4 mieResult;
    void main() {
      vec3 r, m;
      ComputeSingleScatteringTexture(ATMOSPHERE, opticalDepth, scatteringCoord(), r, m);
      result = vec4(r, 0.0);
      mieResult = vec4(m, 0.0);
    }
  `)
  const packSingle = material(/* glsl */`
    void main() {
      ivec3 texel = ivec3(ivec2(gl_FragCoord.xy), layer);
      result = vec4(texelFetch(rayleigh, texel, 0).rgb, texelFetch(mie, texel, 0).r);
    }
  `)
  const scatteringDensity = material(/* glsl */`
    void main() {
      result = vec4(ComputeScatteringDensityTexture(
        ATMOSPHERE, opticalDepth, rayleigh, mie, multiple, irradiance, scatteringCoord(), order), 0.0);
    }
  `)
  const indirect = material(/* glsl */`
    void main() {
      result = vec4(ComputeIndirectIrradianceTexture(
        ATMOSPHERE, rayleigh, mie, multiple, gl_FragCoord.xy, order - 1), 1.0);
    }
  `)
  const multipleScattering = material(/* glsl */`
    void main() {
      float nu;
      result = vec4(ComputeMultipleScatteringTexture(ATMOSPHERE, opticalDepth, density, scatteringCoord(), nu), 0.0);
    }
  `)
  const addMultiple = material(/* glsl */`
    void main() {
      Length r;
      Number mu, mu_s, nu;
      bool intersectsGround;
      GetRMuMuSNuFromScatteringTextureFragCoord(ATMOSPHERE, scatteringCoord(), r, mu, mu_s, nu, intersectsGround);
      vec3 radiance = texelFetch(multiple, ivec3(ivec2(gl_FragCoord.xy), layer), 0).rgb;
      result = vec4(radiance / RayleighPhaseFunction(nu), 0.0);
    }
  `)
  addMultiple.blending = THREE.AdditiveBlending
  addMultiple.premultipliedAlpha = true

  const geometry = new THREE.PlaneGeometry(2, 2)
  const quad = new THREE.Mesh(geometry, transmittanceMaterial)
  quad.frustumCulled = false
  const scene = new THREE.Scene().add(quad)
  const camera = new THREE.Camera()
  const checked = new Set<THREE.WebGLRenderTarget>()

  function draw(target: THREE.WebGLRenderTarget, shader: THREE.RawShaderMaterial, layer = 0) {
    const previous = renderer.getRenderTarget()
    const face = renderer.getActiveCubeFace()
    const level = renderer.getActiveMipmapLevel()
    const autoClear = renderer.autoClear
    const onShaderError = renderer.debug.onShaderError
    let shaderError: string | null = null
    try {
      renderer.autoClear = false
      renderer.debug.onShaderError = (context, program, vertex, fragment) => {
        onShaderError?.(context, program, vertex, fragment)
        shaderError = context.getProgramInfoLog(program) || 'Could not compile the atmosphere precompute'
      }
      renderer.setRenderTarget(target, layer)
      if (!checked.has(target)) {
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('Atmosphere render target is incomplete')
        }
        checked.add(target)
      }
      uniforms.layer.value = layer
      quad.material = shader
      renderer.render(scene, camera)
      if (shaderError) throw new Error(shaderError)
    } finally {
      renderer.debug.onShaderError = onShaderError
      renderer.autoClear = autoClear
      renderer.setRenderTarget(previous, face, level)
    }
  }

  async function volume(target: THREE.WebGL3DRenderTarget, shader: THREE.RawShaderMaterial, depth: number, rows = scatteringHeight) {
    target.scissorTest = rows < scatteringHeight
    for (let layer = 0; layer < depth; layer++) {
      for (let y = 0; y < scatteringHeight; y += rows) {
        target.scissor.set(0, y, scatteringWidth, rows)
        draw(target, shader, layer)
        await waitForGpu(gl, signal)
      }
    }
  }

  try {
    signal.throwIfAborted()
    draw(transmittance, transmittanceMaterial)
    draw(opticalDepth, opticalDepthMaterial)
    draw(irradiance, direct)
    await waitForGpu(gl, signal)
    await volume(single, singleScattering, scratchDepth)
    await volume(scattering, packSingle, coastalScatteringDepth)
    for (let order = 2; order <= 4; order++) {
      uniforms.order.value = order
      await volume(density, scatteringDensity, scratchDepth, 32)
      if (order < 4) {
        draw(irradiance, indirect)
        await waitForGpu(gl, signal)
      }
      await volume(multiple, multipleScattering, order === 4 ? coastalScatteringDepth : scratchDepth)
      await volume(scattering, addMultiple, coastalScatteringDepth)
    }

    return {
      transmittanceTexture: transmittance.texture,
      scatteringTexture: scattering.texture,
      dispose() {
        transmittance.dispose()
        scattering.dispose()
      },
    }
  } catch (error) {
    transmittance.dispose()
    scattering.dispose()
    throw error
  } finally {
    opticalDepth.dispose()
    irradiance.dispose()
    single.dispose()
    density.dispose()
    multiple.dispose()
    for (const mat of materials) mat.dispose()
    geometry.dispose()
  }
}
