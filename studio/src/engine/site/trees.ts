import * as THREE from 'three'
// vendored ez-tree (MIT), see src/vendor/ez-tree/README.md
import { Tree } from '../../vendor/ez-tree/tree.js'
import { loadPreset } from '../../vendor/ez-tree/presets/index.js'
import { rng } from '../materials/textures'
import { wind } from './grass'

const loader = new THREE.TextureLoader()
const textureReady = new WeakMap<THREE.Texture, Promise<void>>()
const tex = (name: string, srgb: boolean) => {
  let finish!: () => void
  const ready = new Promise<void>(resolve => { finish = resolve })
  const t = loader.load(`./assets/trees/${name}`, finish, undefined, finish)
  textureReady.set(t, ready)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

const barkMats = new Map<BarkKind, THREE.MeshStandardMaterial>()
type BarkKind = 'pine' | 'oak' | 'sycamore'
type LeafKind = 'pine' | 'aspen' | 'oak' | 'sycamore' | 'olive' | 'eucalyptus'
const leafMats = new Map<string, THREE.MeshStandardMaterial>()

function windPatch(m: THREE.MeshStandardMaterial, key: string, strength: number, canopy = false) {
  m.onBeforeCompile = shader => {
    shader.uniforms.uTime = wind.uTime
    shader.uniforms.uWind = wind.uWind
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec2 seedXZ = instanceMatrix[3].xz;
        #else
          vec2 seedXZ = vec2(0.0);
        #endif
        float hh = max(position.y, 0.0);
        float ph = uTime * 0.9 + dot(seedXZ, vec2(0.13, 0.11)) + position.x * 0.08;
        float sw = (sin(ph) * 0.6 + sin(ph * 2.3 + position.z * 0.2) * 0.3) * uWind * ${strength.toFixed(4)};
        transformed.x += sw * hh * hh * 0.012;
        transformed.z += sw * hh * hh * 0.006;
        vCanopy = vec2(length(position.xz), position.y);`,
      )
      .replace('#include <common>', '#include <common>\nvarying vec2 vCanopy;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCanopy;')
    if (canopy)
      // needles deep inside the crown are shadowed by the ones around them; tips catch more light
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float rim = smoothstep(0.015, 0.2, vCanopy.x);
        diffuseColor.rgb *= mix(0.38, 1.12, rim) * mix(0.82, 1.08, clamp(vCanopy.y, 0.0, 1.0));`,
      )
  }
  m.customProgramCacheKey = () => key
}

export function barkMaterial(kind: BarkKind = 'pine') {
  let material = barkMats.get(kind)
  if (!material) {
    const texture = kind === 'pine' ? 'pine' : 'oak'
    material = new THREE.MeshStandardMaterial({
      map: tex(`${texture}_bark_d.webp`, true),
      normalMap: tex(`${texture}_bark_n.webp`, false),
      color: { pine: '#8c7f78', oak: '#817467', sycamore: '#e4d9bc' }[kind],
      roughness: 0.95,
    })
    windPatch(material, `bark-wind-${kind}`, 0.25)
    barkMats.set(kind, material)
  }
  return material
}

export function leafMaterial(kind: LeafKind) {
  let m = leafMats.get(kind)
  if (!m) {
    const texture = kind === 'sycamore' || kind === 'eucalyptus' ? 'aspen' : kind === 'olive' ? 'oak' : kind
    m = new THREE.MeshStandardMaterial({
      map: tex(`${texture}_leaves.webp`, true),
      color: { pine: '#7f9a66', aspen: '#c9b46a', oak: '#788f5f', sycamore: '#a5ac72', olive: '#a3b4a0', eucalyptus: '#91a385' }[kind],
      roughness: 0.82,
      side: THREE.DoubleSide,
      alphaTest: 0.42,
    })
    windPatch(m, `leaf-wind-${kind}`, 1, true)
    leafMats.set(kind, m)
  }
  return m
}

export function leavesReady(kind: LeafKind) {
  return textureReady.get(leafMaterial(kind).map!)
}

export interface TreeVariant {
  branches: THREE.BufferGeometry
  leaves: THREE.BufferGeometry
  leafKind: LeafKind
  barkKind?: BarkKind
  height: number
}

export type CoastalTree = 'live-oak' | 'sycamore' | 'stone-pine' | 'canary-pine' | 'olive' | 'eucalyptus'

export function coastalTreeVariant(kind: CoastalTree, seed: number, detail: number) {
  const preset = {
    'live-oak': 'Oak Medium', sycamore: 'Aspen Medium', 'stone-pine': 'Oak Medium',
    'canary-pine': 'Pine Medium', olive: 'Oak Medium', eucalyptus: 'Aspen Medium',
  }[kind]
  const leaves: Record<CoastalTree, LeafKind> = {
    'live-oak': 'oak', sycamore: 'sycamore', 'stone-pine': 'pine', 'canary-pine': 'pine',
    olive: 'olive', eucalyptus: 'eucalyptus',
  }
  const variant = makeVariant(preset, seed, detail, leaves[kind])

  variant.barkKind = kind === 'sycamore' || kind === 'eucalyptus' ? 'sycamore' : kind.endsWith('pine') ? 'pine' : 'oak'
  const width = { 'live-oak': 1.48, sycamore: 1.48, 'stone-pine': 1.7, 'canary-pine': 0.87, olive: 1.36, eucalyptus: 0.94 }[kind]
  for (const geometry of [variant.branches, variant.leaves]) {
    geometry.scale(width, 1, width)
    if (kind === 'stone-pine' || kind === 'eucalyptus' || kind === 'olive') {
      // Adjust crown height and trunk lean without floating the roots.
      const p = geometry.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        const y = Math.max(0, p.getY(i))
        if (kind === 'eucalyptus') p.setX(i, p.getX(i) + Math.sin(y * 3.6) * y * 0.18)
        else p.setY(i, Math.pow(y, kind === 'olive' ? 0.72 : 0.56))
      }
      geometry.computeVertexNormals()
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
    }
  }
  return variant
}

/** Generates one tree with ez-tree and normalises it to 1 unit of height (scaled per instance). */
export function makeVariant(preset: string, seed: number, detail: number, leafKind: LeafKind): TreeVariant {
  const t = new Tree()
  const opts = loadPreset(preset)
  t.loadFromJson(opts)
  t.options.seed = seed
  t.options.bark.textured = false
  // scale detail: fewer child branches / leaves on small devices
  const o = t.options as unknown as {
    branch: { children: Record<string, number>; sections: Record<string, number>; segments: Record<string, number> }
    leaves: { count: number; size: number }
  }
  o.branch.children['0'] = Math.max(8, Math.round(o.branch.children['0'] * (0.55 + 0.45 * detail)))
  o.leaves.count = Math.max(4, Math.round(o.leaves.count * (0.6 + 0.4 * detail)))
  o.leaves.size *= 1 + (1 - detail) * 0.35
  for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * (0.6 + 0.4 * detail)))
  t.generate()
  const branches = t.branchesMesh.geometry as THREE.BufferGeometry
  const leaves = t.leavesMesh.geometry as THREE.BufferGeometry
  branches.computeBoundingBox()
  leaves.computeBoundingBox()
  const box = branches.boundingBox!.clone().union(leaves.boundingBox!)
  const h = box.max.y - box.min.y
  const s = 1 / h
  branches.scale(s, s, s)
  leaves.scale(s, s, s)
  branches.translate(0, -box.min.y * s, 0)
  leaves.translate(0, -box.min.y * s, 0)
  // wind code expects heights in meters: store normalised, scale applied by instance matrix
  return { branches, leaves, leafKind, height: 1 }
}

export interface TreePlacement {
  x: number
  y: number
  z: number
  height: number
  yaw: number
}

/** Instanced trees for one variant. */
export function treeInstances(v: TreeVariant, places: TreePlacement[], castShadow: boolean): THREE.Group {
  const g = new THREE.Group()
  if (!places.length) return g
  const b = new THREE.InstancedMesh(v.branches, barkMaterial(v.barkKind), places.length)
  const l = new THREE.InstancedMesh(v.leaves, leafMaterial(v.leafKind), places.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const c = new THREE.Color()
  places.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw)
    m.compose(new THREE.Vector3(p.x, p.y - 0.05, p.z), q, new THREE.Vector3(p.height, p.height, p.height))
    b.setMatrixAt(i, m)
    l.setMatrixAt(i, m)
    const k = Math.abs(Math.sin(p.x * 12.9898 + p.z * 78.233)) % 1
    c.setRGB(0.86 + k * 0.22, 0.9 + k * 0.16, 0.8 + (1 - k) * 0.25)
    l.setColorAt(i, c)
  })
  for (const mesh of [b, l]) {
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    g.add(mesh)
  }
  return g
}

/**
 * Impostor forest: one tree rendered to a texture (with alpha), drawn as camera-facing cards. Hundreds of distant
 * trees for the cost of a few hundred triangles.
 */
export function impostorForest(renderer: THREE.WebGLRenderer, v: TreeVariant, places: TreePlacement[], seed: number): THREE.Mesh {
  // Offscreen shaders write linear color. Sampling an sRGB-marked target would darken the baked leaves.
  const rt = new THREE.WebGLRenderTarget(256, 256, {
    colorSpace: THREE.LinearSRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
  })
  const scene = new THREE.Scene()
  const tree = new THREE.Group()
  const bark = new THREE.MeshStandardMaterial({ color: '#837467', roughness: 1 })
  tree.add(new THREE.Mesh(v.branches, bark))
  const lm = leafMaterial(v.leafKind).clone()
  lm.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBakedLeaf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBakedLeaf = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBakedLeaf;')
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float pocket = 0.5 + 0.5 * sin(vBakedLeaf.x * 37.0 + vBakedLeaf.y * 23.0) * cos(vBakedLeaf.z * 32.0);
        diffuseColor.rgb *= mix(0.70, 1.33, pocket * 0.60 + smoothstep(0.2, 0.9, vBakedLeaf.y) * 0.40);
      `)
  }
  tree.add(new THREE.Mesh(v.leaves, lm))
  scene.add(tree)
  scene.add(new THREE.HemisphereLight('#e3edff', '#988167', 2.8))
  const d = new THREE.DirectionalLight('#fff3e3', 0.65)
  d.position.set(-1, 2, 2)
  scene.add(d)
  const box = new THREE.Box3().setFromObject(tree)
  const size = box.getSize(new THREE.Vector3())
  const halfW = Math.max(size.x, size.z) * 0.55
  const cam = new THREE.OrthographicCamera(-halfW, halfW, box.max.y + 0.01, box.min.y - 0.01, -10, 10)
  cam.position.set(0, 0, 5)
  cam.lookAt(0, 0, 0)
  // aspect of the card in world units
  const aspect = (2 * halfW) / (box.max.y - box.min.y)
  const prevTarget = renderer.getRenderTarget()
  const prevTone = renderer.toneMapping
  const clear = renderer.getClearColor(new THREE.Color())
  const alpha = renderer.getClearAlpha()
  renderer.setRenderTarget(rt)
  renderer.setClearColor(0x000000, 0)
  renderer.clear()
  renderer.toneMapping = THREE.NoToneMapping
  renderer.render(scene, cam)
  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(clear, alpha)
  renderer.toneMapping = prevTone
  lm.dispose()
  bark.dispose()

  const rand = rng(seed)
  const n = places.length
  const geo = new THREE.InstancedBufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  const ip = new Float32Array(n * 4)
  const it = new Float32Array(n * 3)
  places.forEach((p, i) => {
    ip.set([p.x, p.y - 0.3, p.z, p.height], i * 4)
    it.set([0.76 + rand() * 0.40, 0.78 + rand() * 0.39, rand()], i * 3)
  })
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4))
  geo.setAttribute('iTone', new THREE.InstancedBufferAttribute(it, 3))
  geo.instanceCount = n
  const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.29, roughness: 0.97, side: THREE.DoubleSide })
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 iPos; attribute vec3 iTone; varying vec3 vTone; varying vec3 vCardDirection;')
      .replace(
        '#include <begin_vertex>',
        `// cylindrical billboard facing the camera
        vec3 toCam = cameraPosition - iPos.xyz; toCam.y = 0.0; toCam = normalize(toCam);
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        vec3 transformed = iPos.xyz + right * position.x * iPos.w * ${aspect.toFixed(4)} * (0.83 + 0.34 * iTone.z) + vec3(0.0, position.y * iPos.w, 0.0);
        vTone = iTone; vCardDirection = toCam;`,
      )
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTone; varying vec3 vCardDirection;')
      .replace('#include <map_fragment>', /* glsl */`
        #include <map_fragment>
        // The clear part of the bake is black. Unassociate coverage before tinting the filtered edge.
        diffuseColor.rgb /= max(diffuseColor.a, 0.27);
      `)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        diffuseColor.rgb *= vec3(vTone.x, (vTone.x + vTone.y) * 0.53, vTone.y * 0.82);
      `)
      .replace('#include <normal_fragment_begin>', /* glsl */`
        #include <normal_fragment_begin>
        vec2 crown = vec2(vMapUv.x * 2.0 - 1.0, (vMapUv.y - 0.58) * 2.0);
        vec3 tangent = vec3(vCardDirection.z, 0.0, -vCardDirection.x);
        vec3 canopyNormal = tangent * crown.x * 0.94 + vec3(0.0, 0.77 + crown.y * 0.84, 0.0)
          + vCardDirection * max(0.10, 0.67 - dot(crown, crown) * 0.52);
        normal = normalize(mat3(viewMatrix) * canopyNormal);
      `)
  }
  mat.customProgramCacheKey = () => `lit-impostor-${aspect.toFixed(4)}`
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.name = 'forest'
  mesh.userData.aspect = aspect
  mesh.userData.target = rt
  return mesh
}
