import * as THREE from 'three'
import type { HomePlan } from '../house/types'
import type { HouseModel } from '../house/build'
import { MaterialLibrary } from '../materials/library'
import { roomVolumes, type RoomVolume } from './roomVolumes'

export function selectProbeRooms(plan: HomePlan, limit: number): RoomVolume[] {
  const rooms = roomVolumes(plan, true)
  const first = (type: string) => rooms.find(v => v.room.type === type)
  const primary = first('primary') ?? first('bedroom')
  const baths = rooms.filter(v => v.room.type === 'bath')
  const bath = baths.find(v => v.room.id === 'pbath' || /primary|suite/i.test(v.room.name)) ?? (primary ?
    baths.reduce<RoomVolume | undefined>((near, v) => !near
      || v.center.distanceToSquared(primary.center) < near.center.distanceToSquared(primary.center) ? v : near, undefined) : baths[0])
  const priority = [first('living'), first('kitchen'), primary, bath, ...rooms.filter(v =>
    ['living', 'kitchen', 'primary', 'bath', 'bedroom', 'dining', 'office'].includes(v.room.type))]
  return [...new Set(priority.filter(v => v !== undefined))].slice(0, limit)
}

function shaderSource(count: number, maxLod: number) {
  const slots = Array.from({ length: count }, (_, i) => i)
  return /* glsl */`
    #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_PMREM)
    varying vec3 vProbeWorld;
    uniform float uProbesOn;
    uniform vec4 uProbeHalf[${count}];
    uniform vec3 uProbeCenter[${count}];
    uniform vec3 uProbeCapture[${count}];
    uniform vec2 uProbeRotation[${count}];
    ${slots.map(i => `uniform samplerCube uRoomProbe${i};`).join('\n')}
    vec4 roomProbeBlend;
    const float ROOM_MAX_LOD = ${maxLod.toFixed(1)};

    vec3 roomSpace(vec3 p, vec2 cs) {
      return vec3(cs.x * p.x - cs.y * p.z, p.y, cs.y * p.x + cs.x * p.z);
    }

    vec4 roomProbeWeights() {
      vec4 result = vec4(-1.0, -1.0, 0.0, 0.0);
      if (uProbesOn < 0.5) return result;
      for (int i = 0; i < ${count}; i++) {
        if (uProbeHalf[i].w < 0.5) continue;
        vec3 p = roomSpace(vProbeWorld - uProbeCenter[i], uProbeRotation[i]);
        vec3 inside = uProbeHalf[i].xyz - abs(p);
        float horizontal = smoothstep(-0.60, 0.34, min(inside.x, inside.z));
        float vertical = smoothstep(-0.20, -0.02, inside.y);
        float weight = horizontal * vertical;
        if (weight > result.z) {
          result = vec4(float(i), result.x, weight, result.z);
        } else if (weight > result.w) {
          result.yw = vec2(float(i), weight);
        }
      }
      return result;
    }

    vec3 roomProbeDirection(int i, vec3 ray) {
      vec2 cs = uProbeRotation[i];
      vec3 h = uProbeHalf[i].xyz;
      vec3 p = clamp(roomSpace(vProbeWorld - uProbeCenter[i], cs), -h, h);
      vec3 d = roomSpace(ray, cs);
      vec3 side = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), d));
      vec3 t = (side * h - p) / (side * max(abs(d), vec3(0.0001)));
      vec3 hit = roomSpace(p + d * min(t.x, min(t.y, t.z)), vec2(cs.x, -cs.y));
      return normalize(hit + uProbeCenter[i] - uProbeCapture[i]);
    }

    vec4 roomSample(int i, vec3 direction, float lod) {
      ${slots.map(i => `if (i == ${i}) return textureLod(uRoomProbe${i}, direction, lod);`).join('\n')}
      return vec4(0.0);
    }

    vec3 roomSpecular(int room, vec3 reflectVec, float roughness, float lod) {
      vec3 direction = mix(roomProbeDirection(room, reflectVec), reflectVec, roughness * roughness);
      return roomSample(room, normalize(direction), lod).rgb;
    }
    #endif
  `
}

export class RoomProbes {
  private readonly count: number
  private readonly size: number
  private readonly maxLod: number
  private readonly shader: string
  private readonly libraryNames = new Set(MaterialLibrary.INTERIOR)
  private readonly patched = new Map<THREE.MeshStandardMaterial, {
    compile: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey']
  }>()
  private readonly uniforms: Record<string, THREE.IUniform>
  private readonly centers: THREE.Vector3[]
  private readonly extents: THREE.Vector4[]
  private readonly positions: THREE.Vector3[]
  private readonly rotations: THREE.Vector2[]
  private rooms: RoomVolume[] = []
  private queue: number[] = []
  private targets: (THREE.WebGLCubeRenderTarget | undefined)[] = []
  private pmrem: THREE.PMREMGenerator | undefined
  private cube: THREE.WebGLCubeRenderTarget | undefined
  private captureAfter = 0

  constructor(private renderer: THREE.WebGLRenderer, low: boolean) {
    this.count = low ? 4 : Math.min(8, renderer.capabilities.maxTextures - 10)
    this.size = low ? 64 : 128
    this.maxLod = Math.log2(this.size) - 3
    this.shader = shaderSource(this.count, this.maxLod)
    this.centers = Array.from({ length: this.count }, () => new THREE.Vector3())
    this.extents = Array.from({ length: this.count }, () => new THREE.Vector4(0, 0, 0, 0))
    this.positions = Array.from({ length: this.count }, () => new THREE.Vector3())
    this.rotations = Array.from({ length: this.count }, () => new THREE.Vector2(1, 0))
    this.uniforms = {
      uProbesOn: { value: 1 },
      uProbeCenter: { value: this.centers },
      uProbeHalf: { value: this.extents },
      uProbeCapture: { value: this.positions },
      uProbeRotation: { value: this.rotations },
    }
    for (let i = 0; i < this.count; i++) this.uniforms[`uRoomProbe${i}`] = { value: null }
  }

  get pending() { return this.queue.length > 0 }

  get readyRooms() {
    return this.rooms.filter((_, i) => this.extents[i].w > 0).map(v => v.room.id)
  }

  setHouse(house: HouseModel, interior: THREE.Object3D | null, lib: MaterialLibrary) {
    this.rooms = selectProbeRooms(house.plan, this.count)
    this.prepareMaterials(house, interior, lib)
  }

  prepareMaterials(house: HouseModel, interior: THREE.Object3D | null, lib: MaterialLibrary) {
    for (const root of [house.shell, house.ceilings, house.interior, interior]) {
      root?.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const m = mat as THREE.MeshPhysicalMaterial
          if (!m.isMeshStandardMaterial || m.transmission > 0) continue
          if (this.libraryNames.has(m.name) || lib.interiorExtra.has(m) || (root === interior && m.lightMap)) this.patch(m)
        }
      })
    }
  }

  private patch(m: THREE.MeshStandardMaterial) {
    if (this.patched.has(m) || m.userData.roomProbePatched) return
    const previous = m.onBeforeCompile
    this.patched.set(m, { compile: previous, key: m.customProgramCacheKey })
    const cacheKey = m.customProgramCacheKey()
    // A lightmap material clone retains the installed shader callback.
    m.userData.roomProbePatched = true
    m.onBeforeCompile = (shader, renderer) => {
      previous.call(m, shader, renderer)
      Object.assign(shader.uniforms, this.uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vProbeWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_ENVMAP\nvProbeWorld = worldPosition.xyz;\n#endif')
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', `
        #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_PMREM)
          roomProbeBlend = roomProbeWeights();
        #endif
        #include <lights_fragment_begin>
      `).replace('#include <envmap_physical_pars_fragment>', this.shader +
        THREE.ShaderChunk.envmap_physical_pars_fragment
          .replace(/vec4 envMapColor = textureLod\( envMap, envMapRotation \* worldNormal, ENVMAP_MAX_LOD \);\s+return PI \* envMapColor\.rgb \* envMapIntensity;/, `
            vec4 rooms = roomProbeBlend;
            float coverage = min(1.0, rooms.z + rooms.w);
            vec3 diffuse = coverage < 0.999
              ? textureLod(envMap, envMapRotation * worldNormal, ENVMAP_MAX_LOD).rgb * envMapIntensity * 0.38 * (1.0 - coverage)
              : vec3(0.0);
            if (rooms.z > 0.001) diffuse += roomSample(int(rooms.x), worldNormal, ROOM_MAX_LOD).rgb * rooms.z * coverage / (rooms.z + rooms.w);
            if (rooms.w > 0.001) diffuse += roomSample(int(rooms.y), worldNormal, ROOM_MAX_LOD).rgb * rooms.w * coverage / (rooms.z + rooms.w);
            return PI * diffuse;
          `)
          .replace('return envMapColor.rgb * envMapIntensity;', `
            vec4 rooms = roomProbeBlend;
            float coverage = min(1.0, rooms.z + rooms.w);
            vec3 specular = envMapColor.rgb * envMapIntensity * 0.45 * (1.0 - coverage);
            float lod = ROOM_MAX_LOD * roughness * (2.0 - roughness);
            if (rooms.z > 0.001) specular += roomSpecular(int(rooms.x), reflectVec, roughness, lod) * rooms.z * coverage / (rooms.z + rooms.w);
            if (rooms.w > 0.001) specular += roomSpecular(int(rooms.y), reflectVec, roughness, lod) * rooms.w * coverage / (rooms.z + rooms.w);
            return specular;
          `))
    }
    m.customProgramCacheKey = () => `${cacheKey}|room-probes:${this.count}`
    m.needsUpdate = true
  }

  reset(delay = 0, keepCurrent = false) {
    if (!keepCurrent) this.extents.forEach(v => { v.w = 0 })
    this.queue = this.rooms.map((_, i) => i)
    this.captureAfter = performance.now() + delay
  }

  suspend() {
    this.extents.forEach(v => { v.w = 0 })
    this.queue = []
  }

  clear() {
    this.rooms = []
    this.suspend()
    for (const target of this.targets) target?.dispose()
    this.targets = []
    for (let i = 0; i < this.count; i++) this.uniforms[`uRoomProbe${i}`].value = null
  }

  /** Capture at most one room per idle frame. Previous reflections are disabled during the capture. */
  step(now: number, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.pending || now < this.captureAfter) return false
    this.queue.sort((a, b) => this.rooms[a].center.distanceToSquared(camera.position) - this.rooms[b].center.distanceToSquared(camera.position))
    const i = this.queue.shift()!
    const room = this.rooms[i]
    const renderer = this.renderer
    const options = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace }
    this.cube ??= new THREE.WebGLCubeRenderTarget(this.size, options)
    this.pmrem ??= new THREE.PMREMGenerator(renderer)
    const cam = new THREE.CubeCamera(0.1, 90, this.cube)
    // Keep the capture above tables and below the ceiling in short rooms.
    cam.position.copy(room.center)
    cam.position.y = room.floor + Math.min(1.55, room.half.y * 1.37)
    const target = this.targets[i] ??= new THREE.WebGLCubeRenderTarget(this.size, {
      ...options, minFilter: THREE.LinearMipmapLinearFilter, depthBuffer: false,
    })
    if (!target.texture.mipmaps.length) {
      // Supply an output target so r187 PMREM keeps the small faces. Its 256px scratch cube is reused.
      const mipmaps: { width: number; height: number }[] = target.texture.mipmaps
      for (let mip = 0; mip <= this.maxLod; mip++) {
        const size = this.size >> mip
        mipmaps.push({ width: size, height: size })
      }
    }
    const autoUpdate = renderer.shadowMap.autoUpdate
    const previous = renderer.getRenderTarget()
    this.uniforms.uProbesOn.value = 0
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    try {
      cam.update(renderer, scene)
      this.pmrem.fromCubemap(this.cube.texture, target)
      this.centers[i].copy(room.center)
      this.extents[i].set(room.half.x, room.half.y, room.half.z, 1)
      this.positions[i].copy(cam.position)
      this.rotations[i].copy(room.rotation)
      this.uniforms[`uRoomProbe${i}`].value = target.texture
    } catch (err) {
      console.warn(`room probe capture failed for ${room.room.id}`, err)
    } finally {
      renderer.shadowMap.autoUpdate = autoUpdate
      renderer.setRenderTarget(previous)
      this.uniforms.uProbesOn.value = 1
    }
    return true
  }

  dispose() {
    this.clear()
    this.cube?.dispose()
    this.pmrem?.dispose()
    for (const [material, { compile, key }] of this.patched) {
      material.onBeforeCompile = compile
      material.customProgramCacheKey = key
      delete material.userData.roomProbePatched
      material.needsUpdate = true
    }
    this.patched.clear()
  }
}
