import * as THREE from 'three'
import type { MaterialLibrary } from '../materials/library'
import type { Hillside } from './hillside'

// Sample the world-oriented lighting HDRI without a reflection render target.
export class CoastalSky {
  private rotation = new THREE.Matrix3()
  private matrix = new THREE.Matrix4()
  readonly uniforms = {
    coastSky: { value: null as THREE.Texture | null },
    coastRotation: { value: this.rotation },
    coastBrightness: { value: 1 },
    coastAtmosphere: { value: 0 },
    coastSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    coastSunColor: { value: new THREE.Color(0) },
  }

  bind(mesh: THREE.Mesh) {
    mesh.onBeforeRender = (_renderer, scene) => {
      this.uniforms.coastAtmosphere.value = scene.userData.coastalAtmosphere ?? 0
      const background = scene.background
      if (!(background instanceof THREE.Texture) || background.mapping !== THREE.EquirectangularReflectionMapping) return
      const u = this.uniforms
      if (background !== u.coastSky.value || u.coastBrightness.value !== scene.backgroundIntensity) {
        u.coastSky.value = background
        u.coastBrightness.value = scene.backgroundIntensity
        this.rotation.setFromMatrix4(this.matrix.makeRotationFromEuler(scene.backgroundRotation)).transpose()
      }
      const sun = scene.children.find(o => o instanceof THREE.DirectionalLight)
      if (sun instanceof THREE.DirectionalLight) {
        u.coastSunDirection.value.subVectors(sun.position, sun.target.position).normalize()
        u.coastSunColor.value.copy(sun.color).multiplyScalar(sun.visible ? Math.min(sun.intensity, 6) * 0.55 : 0)
      }
    }
  }
}

const skyGLSL = /* glsl */`
uniform sampler2D coastSky;
uniform mat3 coastRotation;
uniform float coastBrightness;
uniform float coastAtmosphere;
vec3 skyAt(vec3 direction) {
  return texture2D(coastSky, equirectUv(normalize(coastRotation * direction))).rgb * coastBrightness;
}
vec3 horizonSky(vec2 heading) {
  vec2 dir = heading * inversesqrt(max(dot(heading, heading), 0.00001));
  return min(skyAt(vec3(dir.x, 0.018, dir.y)), vec3(4.0));
}
`

const worldVertex = /* glsl */`
varying vec3 vCoastalWorld;
`
export function coastalHaze(material: THREE.MeshStandardMaterial, sky: CoastalSky, key: string) {
  const configure = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    configure(shader, renderer)
    Object.assign(shader.uniforms, sky.uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>' + worldVertex)
      .replace('#include <worldpos_vertex>', /* glsl */`
        #include <worldpos_vertex>
        vec4 coastPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          coastPosition = instanceMatrix * coastPosition;
        #endif
        vCoastalWorld = (modelMatrix * coastPosition).xyz;
      `)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + worldVertex + skyGLSL)
      .replace('#include <opaque_fragment>', /* glsl */`
        if (coastAtmosphere < 1.0) {
          vec2 hazeRay = vCoastalWorld.xz - cameraPosition.xz;
          float hazy = 1.0 - exp(-max(0.0, length(hazeRay) - 31.0) * 0.0016);
          vec3 air = horizonSky(hazeRay);
          air /= 1.0 + max(air.r, max(air.g, air.b));
          vec3 coastalAir = air * vec3(0.30, 0.43, 0.62);
          outgoingLight = mix(outgoingLight, coastalAir, hazy * 0.82 * (1.0 - coastAtmosphere));
        }
        #include <opaque_fragment>
      `)
  }
  material.customProgramCacheKey = () => key
  return material
}

export function retainingMaterial(lib: MaterialLibrary) {
  const material = lib.concrete.clone()
  material.color.set('#b1a390')
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vForm;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvForm = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vForm;')
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float plank = vForm.y / 0.175;
        float course = floor(plank);
        float seam = smoothstep(0.015, 0.052 + fwidth(plank) * 0.25, fract(plank));
        float knots = sin(vForm.x * 3.8 + course * 9.3);
        float timber = sin(vForm.y * 630.0 + knots * 1.3 + sin(vForm.x * 14.0)) * 0.032;
        float joints = 1.0 - smoothstep(0.001, 0.004, abs(fract(vForm.x * 0.41 + course * 0.38) - 0.5));
        float tie = 1.0 - smoothstep(0.008, 0.015, length(vec2(fract(vForm.x * 0.71) - 0.5, fract(vForm.y * 1.83) - 0.5)));
        float streak = sin(vForm.x * 1.59 + sin(vForm.x * 0.52) * 2.7)
          * sin(vForm.x * 4.37 + vForm.y * 2.1 + knots * 0.36);
        float runoff = smoothstep(0.18, 0.91, streak + sin(vForm.y * 1.7 + course * 0.36) * 0.21);
        vec3 mineral = mix(vec3(1.02, 1.01, 0.97), vec3(0.72, 0.77, 0.69), runoff * 0.48);
        diffuseColor.rgb *= mineral * (0.91 + 0.1 * sin(course * 7.67) + timber)
          * (0.70 + 0.30 * seam) * (1.0 - 0.18 * joints - 0.38 * tie);
      `)
  }
  material.customProgramCacheKey = () => 'board-formed-concrete'
  return material
}

export function buildOcean(hill: Hillside, sky: CoastalSky, time: { value: number }, low: boolean) {
  const geom = new THREE.PlaneGeometry(44000, 44000).rotateX(-Math.PI / 2)
  const normalMap = new THREE.TextureLoader().load('./assets/tex/coastal_water_n.webp')
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  normalMap.anisotropy = low ? 1 : 4
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...sky.uniforms,
      oceanTime: time,
      oceanNormal: { value: normalMap },
      oceanOrigin: { value: new THREE.Vector2(hill.cx, hill.cz) },
      oceanBearing: { value: new THREE.Vector2(hill.dx, hill.dz) },
      oceanDistance: { value: hill.oceanDistance },
      oceanSeaLevel: { value: hill.seaLevel },
    },
    defines: { COAST_LOW: low ? 1 : 0 },
    vertexShader: /* glsl */`
      varying vec3 vSurface;
      varying vec3 vOceanRay;
      uniform float coastAtmosphere;
      void main() {
        if (coastAtmosphere > 0.0) {
          // Screen-space sea plane with constant depth. Clipping the huge world-space quad can
          // perturb its reserved depth near the horizon, even when the vertex depths agree.
          vec2 xy = vec2(position.x, -position.z) / 22000.0;
          vec4 viewRay = inverse(projectionMatrix) * vec4(xy, 1.0, 1.0);
          vOceanRay = transpose(mat3(viewMatrix)) * viewRay.xyz;
          gl_Position = vec4(xy, 0.99999976, 1.0);
          return;
        }
        vec4 world = modelMatrix * vec4(position, 1.0);
        vSurface = world.xyz;
        vec4 clip = projectionMatrix * viewMatrix * world;
        // Keep the far water visible at the sky line. The dry terrain always draws in front.
        clip.z = clip.w * 0.999985;
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      ${skyGLSL}
      uniform float oceanTime;
      uniform sampler2D oceanNormal;
      uniform float oceanDistance;
      uniform float oceanSeaLevel;
      uniform vec2 oceanOrigin;
      uniform vec2 oceanBearing;
      uniform vec3 coastSunDirection;
      uniform vec3 coastSunColor;
      varying vec3 vSurface;
      varying vec3 vOceanRay;
      float bell(float x) { return exp(-x * x); }
      float wave(float phase) {
        // A ripple fades once its period is smaller than the pixel footprint.
        return cos(phase) * (1.0 - smoothstep(0.55, 2.3, fwidth(phase)));
      }
      void main() {
        vec3 surface = vSurface;
        if (coastAtmosphere > 0.0) {
          if (vOceanRay.y >= 0.0 || cameraPosition.y <= oceanSeaLevel) discard;
          surface = cameraPosition + vOceanRay * ((oceanSeaLevel - cameraPosition.y) / vOceanRay.y);
          if (any(greaterThan(abs(surface.xz - oceanOrigin), vec2(22000.0)))) discard;
        }
        vec3 toEye = cameraPosition - surface;
        float distanceToEye = length(toEye);
        vec3 eye = toEye / distanceToEye;
        vec2 p = surface.xz - oceanOrigin;
        float u = dot(p, vec2(oceanBearing.y, -oceanBearing.x));
        float v = dot(p, oceanBearing);
        float beach = oceanDistance + 9.0 * sin(u * 0.025) + 8.0 * sin(u * 0.009)
          + 133.0 * bell((u + 270.0) / sqrt(12000.0))
          + 245.0 * bell((u - 450.0) / sqrt(28000.0))
          + 410.0 * bell((u - 1050.0) / sqrt(180000.0));
        float offshore = v - beach;
        if (offshore < -4.0) discard;
        float t = oceanTime;
        vec2 swash = vec2(u, v);
        vec2 gust = vec2(sin(u * 0.036 + v * 0.04), sin(u * 0.021 - v * 0.127));
        swash += 4.5 * gust;
        // Cross-scroll a periodic normal field, following the three.js Water2 approach (MIT).
        vec2 swell = texture2D(oceanNormal, swash * vec2(0.059, 0.047) + vec2(0.018, -0.045) * t).rg * 2.0 - 1.0;
        vec2 oblique = mat2(0.60, -0.80, 0.80, 0.60) * swash;
        swell += (texture2D(oceanNormal, oblique * 0.091 + vec2(-0.04, 0.02) * t).gr * 2.0 - 1.0) * 0.65;
        #if COAST_LOW == 0
          swell += (texture2D(oceanNormal, swash * 0.31 - vec2(0.035, 0.065) * t).rg * 2.0 - 1.0) * 0.21;
        #endif
        vec2 bearingAcross = vec2(oceanBearing.y, -oceanBearing.x);
        float chop = (0.82 + 0.18 * gust.x) * (1.0 - smoothstep(800.0, 3400.0, distanceToEye));
        vec2 perturbation = (bearingAcross * swell.x + oceanBearing * swell.y) * chop * 0.49;
        vec3 normal = normalize(vec3(perturbation.x, 1.0, perturbation.y));
        vec3 reflected = reflect(-eye, normal);
        reflected.y = max(0.015, reflected.y);
        vec3 reflection = min(skyAt(reflected), vec3(1.25));
        float fresnel = 0.028 + 0.75 * pow(1.0 - max(dot(normal, eye), 0.0), 5.0);
        float depth = smoothstep(0.0, 66.0, offshore);
        float shiftingSand = sin(u * 0.14 + v * 0.11) * sin(u * 0.19 - v * 0.09);
        vec3 shallows = mix(vec3(0.15, 0.28, 0.23), vec3(0.021, 0.18, 0.22), smoothstep(-1.0, 16.0, offshore));
        shallows *= 1.0 + 0.085 * shiftingSand * (1.0 - depth);
        vec3 deep = vec3(0.009, 0.053, 0.109);
        vec3 water = mix(shallows, deep, depth) * pow(coastBrightness, 0.8);
        water = mix(water, reflection * vec3(0.39, 0.56, 0.73), 0.40 * fresnel);
        water *= 1.0 + (swell.x * 0.11 + swell.y * 0.13) * chop;
        float glint = max(dot(normal, normalize(eye + coastSunDirection)), 0.0);
        float roughGlint = mix(31.0, 14.0, smoothstep(220.0, 1200.0, distanceToEye));
        water += coastSunColor * (0.085 * pow(glint, roughGlint) + 0.86 * pow(glint, 168.0))
          * smoothstep(-0.04, 0.14, coastSunDirection.y);

        float lag = sin(u * 0.101 + v * 0.036) * 0.84 + sin(u * 0.043) * 1.21;
        float foamPhase = offshore * 0.86 + lag - t * 0.84;
        float spill = 0.5 + 0.5 * wave(foamPhase);
        float wash = smoothstep(0.82, 0.99, spill + swell.x * 0.12) * (1.0 - smoothstep(1.0, 19.0, offshore));
        float shoreEdge = bell((offshore - 1.9 + 0.76 * sin(t * 0.52 + lag)) / 0.69);
        float foam = max(wash * 0.61, shoreEdge * 0.73) * smoothstep(-0.15, 0.55, offshore);
        foam *= 0.48 + 0.52 * (0.5 + 0.5 * sin(u * 1.85 + offshore * 0.45 + lag));
        water = mix(water, vec3(0.53, 0.67, 0.69) * coastBrightness, foam);
        if (coastAtmosphere < 1.0) {
          float haze = 1.0 - exp(-max(0.0, distanceToEye - 145.0) * 0.00043);
          vec3 air = horizonSky(-toEye.xz);
          water = mix(water, air * mix(vec3(0.35, 0.61, 0.88), vec3(0.96, 0.98, 1.0), haze), haze * (1.0 - coastAtmosphere));
        }
        gl_FragColor = vec4(water, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mat.addEventListener('dispose', () => normalMap.dispose())
  mesh.name = 'Pacific Ocean'
  mesh.position.set(hill.cx, hill.seaLevel, hill.cz)
  mesh.frustumCulled = false
  sky.bind(mesh)
  return mesh
}
