import * as THREE from 'three'
import type { MaterialLibrary } from '../materials/library'
import type { Hillside } from './hillside'

// Sample the same world-oriented HDRI as the backdrop, without a reflection render target.
export class CoastalSky {
  private rotation = new THREE.Matrix3()
  private matrix = new THREE.Matrix4()
  readonly uniforms = {
    coastSky: { value: null as THREE.Texture | null },
    coastRotation: { value: this.rotation },
    coastBrightness: { value: 1 },
    coastSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    coastSunColor: { value: new THREE.Color(0) },
  }

  bind(mesh: THREE.Mesh) {
    mesh.onBeforeRender = (_renderer, scene) => {
      const background = scene.background
      if (!(background instanceof THREE.Texture) || background.mapping !== THREE.EquirectangularReflectionMapping) return
      const u = this.uniforms
      if (background === u.coastSky.value && u.coastBrightness.value === scene.backgroundIntensity) return
      u.coastSky.value = background
      u.coastBrightness.value = scene.backgroundIntensity
      this.rotation.setFromMatrix4(this.matrix.makeRotationFromEuler(scene.backgroundRotation)).transpose()
      const sun = scene.children.find(o => o instanceof THREE.DirectionalLight)
      if (sun instanceof THREE.DirectionalLight) {
        u.coastSunDirection.value.subVectors(sun.position, sun.target.position).normalize()
        u.coastSunColor.value.copy(sun.color).multiplyScalar(Math.min(sun.intensity, 6) * 0.55)
      }
    }
  }
}

const skyGLSL = /* glsl */`
uniform sampler2D coastSky;
uniform mat3 coastRotation;
uniform float coastBrightness;
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
export interface CoastalMaps {
  grass: THREE.Texture | null
  bark: THREE.Texture | null
}

export async function loadCoastalMaps(): Promise<CoastalMaps> {
  const loader = new THREE.TextureLoader()
  const load = async (id: string) => {
    const map = await loader.loadAsync(`./assets/tex/${id}_512_d.webp`).catch(() => null)
    if (map) {
      map.wrapS = map.wrapT = THREE.RepeatWrapping
      map.colorSpace = THREE.SRGBColorSpace
      map.anisotropy = 4
    }
    return map
  }
  const [grass, bark] = await Promise.all([load('withered_grass'), load('wood_chip_path')])
  return { grass, bark }
}

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
        vec2 hazeRay = vCoastalWorld.xz - cameraPosition.xz;
        float hazy = 1.0 - exp(-max(0.0, length(hazeRay) - 31.0) * 0.0016);
        vec3 air = horizonSky(hazeRay);
        air /= 1.0 + max(air.r, max(air.g, air.b));
        vec3 coastalAir = air * vec3(0.30, 0.43, 0.62);
        outgoingLight = mix(outgoingLight, coastalAir, hazy * 0.82);
        #include <opaque_fragment>
      `)
  }
  material.customProgramCacheKey = () => key
  return material
}

export function canyonMaterial(lib: MaterialLibrary, hill: Hillside, sky: CoastalSky, maps: CoastalMaps) {
  const scan = lib.soil
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96,
    normalMap: scan.normalMap, normalScale: new THREE.Vector2(0.38, 0.38),
  })
  // Vertex colors carry the medium-scale plant stands and transitions into beds and beach.
  // The scans add detail down to the twigs and grass blades at walking distance.
  material.onBeforeCompile = shader => {
    shader.uniforms.coastGrass = { value: maps.grass ?? scan.map }
    shader.uniforms.coastBark = { value: maps.bark ?? scan.map }
    shader.uniforms.coastSeaLevel = { value: hill.oceanDistance === undefined ? -1e5 : hill.seaLevel }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 groundCover; varying vec2 vGroundCover;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGroundCover = groundCover;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec2 vGroundCover;
        uniform sampler2D coastGrass;
        uniform sampler2D coastBark;
        uniform float coastSeaLevel;
        float groundHash(vec2 p) {
          return fract(sin(dot(p, vec2(37.1, 17.7))) * 43758.5453);
        }
        float groundNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(groundHash(i), groundHash(i + vec2(1, 0)), f.x),
            mix(groundHash(i + vec2(0, 1)), groundHash(i + vec2(1)), f.x), f.y);
        }
      `)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        if (vCoastalWorld.y < coastSeaLevel - 0.025) discard;
        vec2 ground = vCoastalWorld.xz;
        float distanceToEye = distance(ground, cameraPosition.xz);
        float fine = 1.0 - smoothstep(46.0, 140.0, distanceToEye);
        float grass = dot(texture2D(coastGrass, ground * 0.54).rgb, vec3(0.27, 0.62, 0.11));
        float bark = dot(texture2D(coastBark, ground * 0.86).rgb, vec3(0.45, 0.44, 0.11));
        float grain = mix(0.58 + grass * 1.8, 0.53 + bark * 2.35, vGroundCover.x);
        float edge = groundNoise(ground * 0.58) * 0.64 + groundNoise(ground * 1.87) * 0.36;
        float mottle = mix(0.57, 1.23, smoothstep(0.14, 0.85, edge));
        diffuseColor.rgb = vColor.rgb * mix(mottle * mix(1.0, grain, fine), 0.98, vGroundCover.y);
      `)
  }
  return coastalHaze(material, sky, 'coastal-canyon')
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
        diffuseColor.rgb *= (0.91 + 0.1 * sin(course * 7.67) + timber) * (0.70 + 0.30 * seam) * (1.0 - 0.18 * joints - 0.38 * tie);
      `)
  }
  material.customProgramCacheKey = () => 'board-formed-concrete'
  return material
}

export function buildOcean(hill: Hillside, sky: CoastalSky, time: { value: number }, low: boolean) {
  const geom = new THREE.PlaneGeometry(44000, 44000).rotateX(-Math.PI / 2)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...sky.uniforms,
      oceanTime: time,
      oceanOrigin: { value: new THREE.Vector2(hill.cx, hill.cz) },
      oceanBearing: { value: new THREE.Vector2(hill.dx, hill.dz) },
      oceanDistance: { value: hill.oceanDistance },
    },
    defines: { COAST_LOW: low ? 1 : 0 },
    vertexShader: /* glsl */`
      varying vec3 vSurface;
      void main() {
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
      uniform float oceanDistance;
      uniform vec2 oceanOrigin;
      uniform vec2 oceanBearing;
      uniform vec3 coastSunDirection;
      uniform vec3 coastSunColor;
      varying vec3 vSurface;
      float bell(float x) { return exp(-x * x); }
      float wave(float phase) {
        // A ripple fades once its period is smaller than the pixel footprint.
        return cos(phase) * (1.0 - smoothstep(0.55, 2.3, fwidth(phase)));
      }
      void main() {
        vec3 toEye = cameraPosition - vSurface;
        float distanceToEye = length(toEye);
        vec3 eye = toEye / distanceToEye;
        vec2 p = vSurface.xz - oceanOrigin;
        float u = dot(p, vec2(oceanBearing.y, -oceanBearing.x));
        float v = dot(p, oceanBearing);
        float beach = oceanDistance + 9.0 * sin(u * 0.025) + 8.0 * sin(u * 0.009)
          + 133.0 * bell((u + 270.0) / sqrt(12000.0))
          + 245.0 * bell((u - 450.0) / sqrt(28000.0))
          + 410.0 * bell((u - 1050.0) / sqrt(180000.0));
        float offshore = v - beach;
        float t = oceanTime * 0.64;
        float gust = sin(u * 0.024 + v * 0.052) * 1.6 + sin(u * 0.068 - v * 0.034)
          + sin(u * 0.137 + v * 0.092) * 1.2;
        vec2 swell = vec2(
          wave(u * 0.22 + v * 0.74 - t * 2.0 + gust) * 0.024 + wave(u * 0.81 - v * 0.46 + t) * 0.016,
          wave(u * 0.36 + v * 0.63 - t * 1.7 - gust) * 0.034 + wave(u * 1.22 + v * 0.30 + t) * 0.019
        );
        #if COAST_LOW == 0
          swell += vec2(wave(u * 2.3 + v * 1.9 - t * 2.4), wave(u * 1.3 - v * 2.7 + t)) * 0.018;
        #endif
        swell *= (1.0 - smoothstep(110.0, 360.0, distanceToEye)) * smoothstep(0.055, 0.23, eye.y);
        vec3 normal = normalize(vec3(swell.x, 1.0, swell.y));
        vec3 reflected = reflect(-eye, normal);
        reflected.y = max(0.018, reflected.y);
        vec3 reflection = min(skyAt(reflected), vec3(1.55));
        float fresnel = 0.035 + 0.965 * pow(1.0 - max(dot(normal, eye), 0.0), 5.0);
        float shallows = 1.0 - smoothstep(0.0, 50.0, offshore);
        vec3 deep = mix(vec3(0.007, 0.047, 0.149), vec3(0.013, 0.138, 0.217), shallows);
        deep *= (0.91 + swell.y * 1.6) * pow(coastBrightness, 0.8);
        vec3 water = mix(deep, reflection * vec3(0.45, 0.63, 0.79), 0.16 * fresnel);
        float glint = max(dot(normal, normalize(eye + coastSunDirection)), 0.0);
        water += coastSunColor * (0.10 * pow(glint, 52.0) + 0.26 * pow(glint, 255.0));
        float stripe = offshore - 4.1 - 0.7 * sin(u * 0.13 + t);
        float breakers = 0.70 * bell(stripe / 0.65) + 0.23 * bell((stripe - 5.5) / 1.1);
        float foam = pow(0.5 + 0.5 * wave(offshore * 1.63 - t * 2.1 + sin(u * 0.62) * 0.65), 9.0);
        foam *= smoothstep(-0.2, 0.9, offshore) * (1.0 - smoothstep(4.0, 17.0, offshore));
        water = mix(water, vec3(0.48, 0.59, 0.61) * coastBrightness, (foam * 0.31 + breakers) * (0.70 + sin(u * 0.43) * 0.24));
        float haze = 1.0 - exp(-max(0.0, distanceToEye - 145.0) * 0.00043);
        vec3 air = horizonSky(-toEye.xz);
        water = mix(water, air * mix(vec3(0.35, 0.61, 0.88), vec3(0.96, 0.98, 1.0), haze), haze);
        gl_FragColor = vec4(water, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = 'Pacific Ocean'
  mesh.position.set(hill.cx, hill.seaLevel, hill.cz)
  mesh.frustumCulled = false
  sky.bind(mesh)
  return mesh
}
