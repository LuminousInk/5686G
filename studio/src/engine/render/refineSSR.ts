import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

const fullScreen = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

export function reflectionSurface(material: THREE.Material) {
  if (!(material instanceof THREE.MeshStandardMaterial) || !material.visible) return null
  const physical = material instanceof THREE.MeshPhysicalMaterial ? material : null
  const coatRoughness = physical?.clearcoat ? physical.clearcoatRoughness + 0.18 : 1
  const map = material.roughnessMap
  const roughness = material.roughness
  if (Math.min(coatRoughness, roughness) >= 0.67 && !map) return null
  if (material.transparent && !physical?.transmission) return null
  const metal = material.metalness
  const glass = physical?.transmission || material.name === 'glass'
  const strength = glass ? 0.15 : 0.055 + metal * 0.5 + (physical?.clearcoat ?? 0) * 0.13
  return { roughness, coatRoughness, map, strength }
}

/** One stationary screen-space solve at half resolution. Hits contribute where the raster probes lack local detail. */
export class StillReflections {
  private receivers = new THREE.Scene()
  private materials = new Map<THREE.Material, THREE.ShaderMaterial>()
  private skip = new THREE.MeshBasicMaterial({ visible: false })
  private surfaces = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  })
  private hits = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  private output = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  private trace: FullScreenQuad
  private blend: FullScreenQuad
  private clear = new THREE.Color()

  constructor() {
    const plain = { vertexShader: fullScreen, depthTest: false, depthWrite: false }
    const cameraUniforms = {
      projection: { value: new THREE.Matrix4() }, invProjection: { value: new THREE.Matrix4() },
      clip: { value: new THREE.Vector2() }, tDepth: { value: null }, tReceiverDepth: { value: this.surfaces.depthTexture },
      tSurface: { value: this.surfaces.texture },
    }
    this.trace = new FullScreenQuad(new THREE.ShaderMaterial({
      ...plain,
      uniforms: { ...cameraUniforms, tColor: { value: null } },
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform highp sampler2D tDepth, tReceiverDepth;
        uniform sampler2D tSurface, tColor;
        uniform mat4 projection, invProjection;
        uniform vec2 clip;
        float viewDistance(float d) { return clip.x * clip.y / mix(clip.y, clip.x, d); }
        vec3 positionAt(vec2 uv, float depth) {
          vec4 p = invProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          return p.xyz / p.w;
        }
        vec2 project(vec3 p) {
          vec4 v = projection * vec4(p, 1.0);
          return v.xy / v.w * 0.5 + 0.5;
        }
        vec3 octDecode(vec2 a) {
          vec2 xy = a * 2.0 - 1.0;
          vec3 v = vec3(xy, 1.0 - abs(xy.x) - abs(xy.y));
          v.xy -= sign(v.xy) * max(0.0, -v.z);
          return normalize(v);
        }
        void main() {
          gl_FragColor = vec4(0.0);
          vec4 surface = texture2D(tSurface, vUv);
          if (surface.a < 0.01 || surface.z >= 0.76) return;
          float receiverDepth = texture2D(tReceiverDepth, vUv).r;
          vec3 p = positionAt(vUv, receiverDepth);
          float d = viewDistance(texture2D(tDepth, vUv).r);
          if (-p.z > d + max(0.035, d * 0.012)) return;
          vec3 n = octDecode(surface.xy);
          vec3 incoming = normalize(p);
          vec3 ray = reflect(incoming, n);
          float stride = mix(0.22, 0.46, surface.z);
          p += n * max(0.025, -p.z * 0.002);
          float previous = 0.06;
          float gapBefore = 0.0;
          bool inFront = false;
          for (int i = 0; i < 24; i++) {
            float j = 1.0 + float(i);
            float distance = 0.1 + stride * j * (0.55 + j * 0.028);
            vec3 q = p + ray * distance;
            if (q.z > -clip.x) break;
            vec2 uv = project(q);
            if (any(lessThanEqual(uv, vec2(0.005))) || any(greaterThanEqual(uv, vec2(0.995)))) break;
            float gap = -q.z - viewDistance(texture2D(tDepth, uv).r);
            if (inFront && gap >= 0.0 && gapBefore < 0.0) {
              float lo = previous;
              float hi = distance;
              for (int b = 0; b < 4; b++) {
                float mid = (lo + hi) * 0.5;
                q = p + ray * mid;
                uv = project(q);
                if (-q.z >= viewDistance(texture2D(tDepth, uv).r)) hi = mid;
                else lo = mid;
              }
              q = p + ray * hi;
              uv = project(q);
              gap = -q.z - viewDistance(texture2D(tDepth, uv).r);
              float tolerance = max(0.08, -q.z * 0.008);
              if (gap > tolerance) break;
              vec2 border = min(uv, 1.0 - uv);
              float confidence = smoothstep(0.008, 0.1, min(border.x, border.y)) *
                (1.0 - smoothstep(6.0, 15.0, distance)) * (1.0 - smoothstep(0.35, 0.76, surface.z));
              float fresnel = pow(1.0 - max(dot(-incoming, n), 0.0), 5.0);
              float weight = confidence * clamp(surface.a + fresnel * 0.23, 0.0, 0.55);
              gl_FragColor = vec4(min(texture2D(tColor, uv).rgb, vec3(4.0)) * weight, weight);
              return;
            }
            inFront = true;
            previous = distance;
            gapBefore = gap;
          }
        }
      `,
    }))
    this.blend = new FullScreenQuad(new THREE.ShaderMaterial({
      ...plain,
      uniforms: { ...cameraUniforms, tColor: { value: null }, tHits: { value: this.hits.texture }, texel: { value: new THREE.Vector2() } },
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tColor, tHits, tSurface;
        uniform highp sampler2D tReceiverDepth;
        uniform vec2 texel, clip;
        float viewDistance(float d) { return clip.x * clip.y / mix(clip.y, clip.x, d); }
        void main() {
          vec3 base = texture2D(tColor, vUv).rgb;
          vec4 surface = texture2D(tSurface, vUv);
          if (surface.a < 0.01) {
            gl_FragColor = vec4(base, 1.0);
            return;
          }
          float d = viewDistance(texture2D(tReceiverDepth, vUv).r);
          vec4 value = texture2D(tHits, vUv) * 2.0;
          float total = 2.0;
          for (int i = 0; i < 4; i++) {
            float angle = float(i) * 1.570796;
            vec2 p = vUv + vec2(cos(angle), sin(angle)) * texel * mix(0.75, 2.4, surface.z);
            vec4 g = texture2D(tSurface, p);
            float e = viewDistance(texture2D(tReceiverDepth, p).r);
            float w = step(0.01, g.a) * exp(-abs(d - e) * 15.0 - length(g.xy - surface.xy) * 25.0);
            value += texture2D(tHits, p) * w;
            total += w;
          }
          value /= total;
          gl_FragColor = vec4(base * (1.0 - value.a * 0.38) + value.rgb, 1.0);
        }
      `,
    }))
  }

  private receiverFor(source: THREE.Material) {
    const cached = this.materials.get(source)
    if (cached) return cached
    const surface = reflectionSurface(source)
    if (!surface) return this.skip
    const map = surface.map
    if (map?.matrixAutoUpdate) map.updateMatrix()
    const material = new THREE.ShaderMaterial({
      side: source.side,
      defines: map ? { HAS_ROUGHNESS: 1 } : {},
      uniforms: {
        roughness: { value: surface.roughness }, coatRoughness: { value: surface.coatRoughness },
        strength: { value: surface.strength }, tRoughness: { value: map }, mapMatrix: { value: map?.matrix },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        #ifdef HAS_ROUGHNESS
          uniform mat3 mapMatrix;
          varying vec2 vMapUv;
        #endif
        void main() {
          vNormal = normalMatrix * normal;
          #ifdef HAS_ROUGHNESS
            vMapUv = (mapMatrix * vec3(uv, 1.0)).xy;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        uniform float roughness, coatRoughness, strength;
        #ifdef HAS_ROUGHNESS
          uniform sampler2D tRoughness;
          varying vec2 vMapUv;
        #endif
        void main() {
          vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          n /= abs(n.x) + abs(n.y) + abs(n.z);
          if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * sign(n.xy + 0.00001);
          float gloss = roughness;
          #ifdef HAS_ROUGHNESS
            gloss *= texture2D(tRoughness, vMapUv).g;
          #endif
          gl_FragColor = vec4(n.xy * 0.5 + 0.5, min(gloss, coatRoughness), strength);
        }
      `,
    })
    this.materials.set(source, material)
    return material
  }

  render(
    renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, raster: THREE.Texture, depth: THREE.Texture,
    groups: readonly (THREE.Object3D | undefined)[],
  ) {
    const { width, height } = raster.image as { width: number; height: number }
    const scale = Math.min(0.5, 650 / width, 410 / height)
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    this.surfaces.setSize(w, h)
    this.hits.setSize(w, h)
    this.output.setSize(width, height)
    for (const group of groups) {
      group?.updateWorldMatrix(true, true)
      group?.traverseVisible(object => {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object.userData.shadowOnly ||
          !object.layers.test(camera.layers) || !object.geometry.getAttribute('normal')) return
        const source = Array.isArray(object.material) ? object.material : [object.material]
        const materials = source.map(m => this.receiverFor(m))
        if (materials.every(m => m === this.skip)) return
        const mesh = new THREE.Mesh(object.geometry, Array.isArray(object.material) ? materials : materials[0])
        mesh.matrix.copy(object.matrixWorld)
        mesh.matrixAutoUpdate = false
        this.receivers.add(mesh)
      })
    }
    const previous = renderer.getRenderTarget()
    const shadows = renderer.shadowMap.enabled
    const clearAlpha = renderer.getClearAlpha()
    renderer.getClearColor(this.clear)
    renderer.shadowMap.enabled = false
    try {
      const trace = (this.trace.material as THREE.ShaderMaterial).uniforms
      const blend = (this.blend.material as THREE.ShaderMaterial).uniforms
      trace.projection.value.copy(camera.projectionMatrix)
      trace.invProjection.value.copy(camera.projectionMatrixInverse)
      trace.clip.value.set(camera.near, camera.far)
      trace.tDepth.value = depth
      trace.tColor.value = blend.tColor.value = raster
      blend.texel.value.set(1 / w, 1 / h)
      renderer.setClearColor(0, 0)
      renderer.setRenderTarget(this.surfaces)
      renderer.clear()
      renderer.render(this.receivers, camera)
      renderer.setRenderTarget(this.hits)
      this.trace.render(renderer)
      renderer.setRenderTarget(this.output)
      this.blend.render(renderer)
    } finally {
      renderer.setClearColor(this.clear, clearAlpha)
      renderer.setRenderTarget(previous)
      renderer.shadowMap.enabled = shadows
      this.receivers.clear()
    }
    return this.output.texture
  }

  dispose() {
    for (const material of this.materials.values()) material.dispose()
    this.skip.dispose()
    this.trace.material.dispose()
    this.trace.dispose()
    this.blend.material.dispose()
    this.blend.dispose()
    this.surfaces.dispose()
    this.hits.dispose()
    this.output.dispose()
  }
}
