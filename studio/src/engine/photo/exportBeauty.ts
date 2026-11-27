import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { Engine } from '../Engine'
import { buildingSections, framePoint } from '../house/levels'
import { ceilingAt, roofHeightAt, roofThickness, sideIntervals, sidePoint, WALL_T } from '../house/massing'
import type { HomePlan } from '../house/types'
import { roomVolumes } from '../env/roomVolumes'
import { rng } from '../materials/textures'
import { anchoredExposure, interiorExposureWeight, roomExposureEV } from '../render/exposureAnchors'
import { coastalTreeVariant, leavesReady, makeVariant, treeInstances, type TreePlacement } from '../site/trees'
import { expandShaderInstances } from './bake'

type Vec3 = [number, number, number]

interface BeautyOpening {
  position: Vec3
  inward: Vec3
  width: number
  height: number
}

export interface BeautyMeta {
  plan: string
  preset: string
  camera: { position: Vec3; target: Vec3; up: Vec3; fov: number }
  exposure: number
  backgroundScale: number
  interior: boolean
  sky: { width: number; height: number }
  sun: { direction: Vec3; color: Vec3; intensity: number; radius: number }
  openings: BeautyOpening[]
  lamps: { position: Vec3; color: Vec3; intensity: number; target?: Vec3; angle?: number; penumbra?: number }[]
}

export function beautyOpenings(home: HomePlan): BeautyOpening[] {
  return buildingSections(home).flatMap(({ plan, frame }) => plan.openings.flatMap(opening => {
    if (!opening.side || !['window', 'fixed', 'slider', 'clerestory', 'entry'].includes(opening.kind)) return []
    const block = plan.blocks.find(candidate => candidate.id === opening.block)
    if (!block) return []
    const { frame: side, intervals } = sideIntervals(block, opening.side, plan.blocks)
    const u0 = opening.at - opening.width / 2
    const u1 = opening.at + opening.width / 2
    const span = intervals.find(iv => u0 >= iv.u0 - 1e-3 && u1 <= iv.u1 + 1e-3)
    if (!span) return []
    const sill = opening.sill ?? 0
    if ([u0, u1].some(u => {
      const [x, z] = sidePoint(side, u)
      return sill + opening.height > roofHeightAt(block, x, z) + 0.001 ||
        (span.neighbour && sill < roofHeightAt(span.neighbour, x, z) + roofThickness(span.neighbour.roof))
    })) return []
    // Exterior entry doors can have a sidelite beside their solid leaf.
    const clearWidth = opening.width - 0.11
    const entry = opening.kind === 'entry'
    if (entry && clearWidth <= 1.2) return []
    const covered = entry ? 1.05 + 0.044 : 0
    const [x, z] = framePoint(frame, ...sidePoint(side, opening.at + covered / 2, WALL_T + 0.015))
    const inward = new THREE.Vector3(-side.ox, 0, -side.oz)
      .applyAxisAngle(THREE.Object3D.DEFAULT_UP, frame?.yaw ?? 0)
    const width = clearWidth - covered
    const height = opening.height - 0.11
    return width > 0 && height > 0
      ? [{ position: [x, plan.floorY + sill + opening.height / 2, z] as Vec3, inward: inward.toArray(), width, height }]
      : []
  }))
}

type Surface = THREE.MeshStandardMaterial
type MappedMaterial = THREE.Material & Pick<Surface, 'color' | 'map' | 'normalMap' | 'normalScale' | 'aoMap' | 'aoMapIntensity' | 'vertexColors'>

/** Preserve PBR inputs while dropping runtime lighting and shader state. */
export function beautyMaterial(source: THREE.Material, bevel = false, tint?: THREE.Color): Surface {
  const src = source as MappedMaterial
  const standard = source instanceof THREE.MeshStandardMaterial
  const sheer = /(?:drapery|sheer)/i.test(source.name)
  const thinGlass = source.name === 'glass' || source.name === 'showerGlass'
  let out: Surface
  if (sheer || thinGlass) {
    const physical = new THREE.MeshPhysicalMaterial()
    if (standard) THREE.MeshStandardMaterial.prototype.copy.call(physical, source)
    physical.transmission = sheer ? 0.68 : 1
    physical.ior = sheer ? 1.05 : 1.47
    physical.roughness = sheer ? 0.87 : source.name === 'glass' ? 0.045 : 0.10
    physical.transparent = false
    physical.opacity = 1
    physical.side = THREE.DoubleSide
    out = physical
  } else if (standard) {
    out = source.clone()
  } else {
    out = new THREE.MeshStandardMaterial({
      color: src.color ?? new THREE.Color('#808080'), map: src.map ?? null,
      normalMap: src.normalMap ?? null, normalScale: src.normalScale?.clone() ?? new THREE.Vector2(1, 1),
      aoMap: src.aoMap ?? null, aoMapIntensity: src.aoMapIntensity ?? 1,
      roughness: 0.82, side: src.side, alphaTest: src.alphaTest,
      transparent: src.transparent, opacity: src.opacity, vertexColors: src.vertexColors,
    })
  }
  out.name = source.name
  out.lightMap = null
  out.lightMapIntensity = 1
  out.envMap = null
  if (tint) {
    out.color.multiply(tint)
    out.color.setRGB(Math.min(out.color.r, 1), Math.min(out.color.g, 1), Math.min(out.color.b, 1))
  }
  if (out.alphaTest > 0 && out.opacity === 1) out.transparent = false
  // Blender reads glTF material extras as custom properties.
  out.userData = {
    ...(sheer ? { beautySheer: true } : {}),
    ...(thinGlass ? { beautyThinGlass: true } : {}),
    ...(bevel && !sheer && !thinGlass && out.alphaTest === 0 && !out.transparent ? { beautyBevel: 0.004 } : {}),
  }
  return out
}

function captureRenderTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, encodeColor = false) {
  const { width, height } = target
  const pixels = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
  if (encodeColor) {
    // Impostors are rendered into a linear byte buffer. glTF base color images are sRGB.
    const srgb = Uint8Array.from({ length: 256 }, (_, i) => Math.round(255 * THREE.ColorManagement.workingToColorSpace(
      new THREE.Color().setScalar(i / 255), THREE.SRGBColorSpace,
    ).r))
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = srgb[pixels[i]]
      pixels[i + 1] = srgb[pixels[i + 1]]
      pixels[i + 2] = srgb[pixels[i + 2]]
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  const image = context.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    image.data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - y - 1) * width * 4)
  }
  context.putImageData(image, 0, 0)
  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = encodeColor ? THREE.SRGBColorSpace : target.texture.colorSpace
  return map
}

/** Allocate most of the atlas to the lot and foreground, keeping monotonically ordered UVs out to the horizon. */
export function groundAtlasAxis(min: number, max: number, center: number) {
  const project = (value: number) => {
    const offset = value - center
    const distance = Math.abs(offset)
    return Math.sign(offset) * (Math.min(distance, 52) + 2.4 * Math.log1p(Math.max(0, distance - 52) / 7))
  }
  const start = project(min)
  const span = project(max) - start || 1
  return (value: number) => (project(value) - start) / span
}

/** Run the canyon's existing blend on its triangles in UV space, with no lighting or tone mapping. */
export function canyonBakeShader(source: Surface, renderer: THREE.WebGLRenderer, eye: THREE.Vector3) {
  const sections = '// Beauty atlas section'
  const shader = {
    uniforms: { bakeEye: { value: eye } },
    vertexShader: '#include <common>\n#include <color_vertex>\n#include <worldpos_vertex>',
    fragmentShader: ['#include <common>', '#include <color_fragment>', '#include <normal_fragment_maps>', ''].join(`\n${sections}\n`),
  } as unknown as Parameters<Surface['onBeforeCompile']>[0]
  source.onBeforeCompile(shader, renderer)
  const [declarations, albedo, normal] = shader.fragmentShader.split(sections)
  // The runtime applies the blended normal's XZ components in view space. Store those components
  // in the atlas's tangent space, whose U and V axes follow world X and Z.
  const detail = normal?.split('vec3 oriented =')[0]
  if (!albedo?.includes('diffuseColor.rgb = mix(groundColor') || !detail?.includes('vec2 bump =')) {
    throw new Error('The canyon shader no longer supplies the terrain atlas blend')
  }
  return {
    uniforms: shader.uniforms,
    vertexShader: /* glsl */`
      attribute vec4 groundCover;
      attribute float curvature;
      attribute vec3 color;
      varying vec3 vGroundNormal, vColor, vCoastalWorld;
      varying vec4 vGroundCover;
      varying float vCurvature;
      void main() {
        vGroundCover = groundCover;
        vGroundNormal = normal;
        vColor = color;
        vCurvature = curvature;
        vCoastalWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      ${declarations}
      uniform vec3 bakeEye;
      varying vec3 vColor;
      void main() {
        vec4 diffuseColor = vec4(1.0);
        ${albedo.replace('#include <color_fragment>', '').replaceAll('cameraPosition', 'bakeEye')}
        #ifdef BAKE_NORMAL
          vec3 atlasNormal = vec3(0.0, 0.0, 1.0);
          ${detail.replace('#include <normal_fragment_maps>', '')}
            atlasNormal = normalize(vec3(bump, 1.0));
          }
          gl_FragColor = vec4(atlasNormal * 0.5 + 0.5, 1.0);
        #else
          gl_FragColor = sRGBTransferOETF(diffuseColor);
        #endif
      }
    `,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthTest: false,
  }
}

function bakeCanyon(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh<THREE.BufferGeometry, Surface>, eye: THREE.Vector3) {
  const source = mesh.geometry.getAttribute('position')
  const world = new THREE.Vector3()
  const bounds = new THREE.Box3()
  for (let i = 0; i < source.count; i++) bounds.expandByPoint(world.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld))
  const projectX = groundAtlasAxis(bounds.min.x, bounds.max.x, eye.x)
  const projectZ = groundAtlasAxis(bounds.min.z, bounds.max.z, eye.z)
  const uv = new THREE.Float32BufferAttribute(new Float32Array(source.count * 2), 2)
  for (let i = 0; i < source.count; i++) {
    world.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld)
    uv.setXY(i, projectX(world.x), projectZ(world.z))
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(mesh.geometry.index)
  for (const name of ['position', 'normal', 'color', 'groundCover', 'curvature']) {
    geometry.setAttribute(name, mesh.geometry.getAttribute(name))
  }
  geometry.setAttribute('uv', uv)
  const shader = canyonBakeShader(mesh.material, renderer, eye)
  const scene = new THREE.Scene()
  const baker = new THREE.Mesh(geometry, new THREE.ShaderMaterial(shader))
  baker.matrixAutoUpdate = false
  baker.matrix.copy(mesh.matrixWorld)
  baker.frustumCulled = false
  scene.add(baker)
  const camera = new THREE.Camera()
  const size = Math.min(4096, renderer.capabilities.maxTextureSize)
  const target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false })
  const previous = renderer.getRenderTarget()
  const clear = renderer.getClearColor(new THREE.Color())
  const alpha = renderer.getClearAlpha()
  let map: THREE.Texture | undefined
  try {
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    renderer.render(scene, camera)
    map = captureRenderTarget(renderer, target)
    map.colorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(new THREE.Color().setRGB(0.5, 0.5, 1), 1)
    baker.material.defines.BAKE_NORMAL = 1
    baker.material.needsUpdate = true
    renderer.render(scene, camera)
    const normalMap = captureRenderTarget(renderer, target)
    // Drop the bake inputs so glTF sees the atlas as the sole base color source.
    for (const name of ['color', 'groundCover', 'curvature']) geometry.deleteAttribute(name)
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      name: 'Canyon terrain splat', map, normalMap, roughness: 0.94, alphaTest: 0.5,
    }))
  } catch (error) {
    geometry.dispose()
    map?.dispose()
    throw error
  } finally {
    renderer.setRenderTarget(previous)
    renderer.setClearColor(clear, alpha)
    target.dispose()
    baker.material.dispose()
  }
}

const forestKinds = ['live-oak', 'canary-pine', 'sycamore', 'live-oak', 'stone-pine'] as const
const meshTreeRadius = 100

/** The app's card attributes carry placement and a per-group seeded tint, even when some groups are empty. */
export function beautyForestSeed(tone: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  return [5, ...forestKinds.map((_, i) => i + 9)].find(seed => {
    const random = rng(seed)
    return tone.getX(0) === Math.fround(0.76 + random() * 0.40) &&
      tone.getY(0) === Math.fround(0.78 + random() * 0.39)
  })
}

export function beautyForestPlacements(geometry: THREE.InstancedBufferGeometry, matrix: THREE.Matrix4, eye: THREE.Vector3) {
  const points = geometry.getAttribute('iPos')
  const near: TreePlacement[] = []
  const far: number[] = []
  const world = new THREE.Vector3()
  for (let i = 0; i < geometry.instanceCount; i++) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i)
    world.set(x, y, z).applyMatrix4(matrix)
    if (Math.hypot(world.x - eye.x, world.z - eye.z) <= meshTreeRadius) {
      const yaw = 2 * Math.PI * rng(i + 77)()
      near.push({ x, y: y + 0.3, z, height: points.getW(i), yaw })
    } else {
      far.push(i)
    }
  }
  return { near, far }
}

function forestCards(source: THREE.InstancedBufferGeometry, indices: number[], eye: THREE.Vector3, aspect: number) {
  const points = source.getAttribute('iPos')
  const tones = source.getAttribute('iTone')
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], colors: number[] = [], triangles: number[] = []
  const face = new THREE.Vector3(), normal = new THREE.Vector3()
  for (const i of indices) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i), h = points.getW(i)
    const w = h * aspect * (0.83 + 0.34 * tones.getZ(i))
    face.set(eye.x - x, 0, eye.z - z).normalize()
    const red = tones.getX(i), green = (red + tones.getY(i)) * 0.53, blue = tones.getY(i) * 0.82
    const base = positions.length / 3
    // Interpolate the app's upward, rounded canopy normals over the card, including its center.
    for (const v of [0, 0.5, 1]) {
      for (const u of [0, 0.5, 1]) {
        positions.push(x + face.z * (u - 0.5) * w, y + h * v, z - face.x * (u - 0.5) * w)
        const cx = u * 2 - 1, cy = (v - 0.58) * 2
        const forward = Math.max(0.10, 0.67 - (cx * cx + cy * cy) * 0.52)
        normal.set(face.z * cx * 0.94 + face.x * forward, 0.77 + cy * 0.84, -face.x * cx * 0.94 + face.z * forward).normalize()
        normals.push(...normal.toArray())
        uv.push(u, v)
        colors.push(Math.min(1, red), Math.min(1, green), blue)
      }
    }
    for (const offset of [0, 1, 3, 4]) {
      const a = base + offset
      triangles.push(a, a + 1, a + 4, a, a + 4, a + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(triangles)
  return geometry
}

export async function exportBeauty(engine: Engine, options: { target?: Vec3; useExposureAnchor?: boolean } = {}) {
  const { camera, house, interior, site, sky } = engine
  if (!house) throw new Error('No home loaded')
  const width = 2048
  const height = 1024
  const world = sky.worldSky(width, height)
  if (!world) throw new Error('Sky has not loaded')

  engine.scene.updateMatrixWorld(true)
  const position = camera.getWorldPosition(new THREE.Vector3())
  const look = options.target ?? camera.getWorldDirection(new THREE.Vector3()).add(position).toArray()
  const exposure = options.useExposureAnchor ? sky.exposure * anchoredExposure(
    0, sky.preset.lamps > 0.5 ? 1 : 2.35, roomExposureEV(house.plan.id, roomVolumes(house.plan), position),
    interiorExposureWeight(house.plan, position),
  ) : engine.pipeline.exposure
  const meta: BeautyMeta = {
    plan: house.plan.id,
    preset: sky.preset.id,
    camera: { position: position.toArray(), target: look, up: camera.up.toArray(), fov: camera.getEffectiveFOV() },
    exposure,
    backgroundScale: sky.preset.backgroundScale / sky.preset.envScale,
    interior: house.floorAt(position.x, position.z, position.y) !== null &&
      buildingSections(house.plan).some(({ plan, frame }) => {
        const [x, z] = framePoint(frame, position.x, position.z, true)
        return position.y >= plan.floorY && plan.blocks.some(block =>
          x >= block.rect[0] && x <= block.rect[2] && z >= block.rect[1] && z <= block.rect[3] &&
          position.y < plan.floorY + ceilingAt(block, x, z))
      }),
    sky: { width, height },
    sun: { direction: sky.sunDir.toArray(), color: [sky.sunColor.r, sky.sunColor.g, sky.sunColor.b], intensity: sky.sun.visible ? sky.sunIntensity : 0, radius: sky.preset.sunRadius },
    openings: beautyOpenings(house.plan),
    lamps: engine.lights.group.children.flatMap(light => {
      if (!(light instanceof THREE.PointLight || light instanceof THREE.SpotLight) || !light.visible || light.intensity <= 0) return []
      return [{
        position: light.getWorldPosition(new THREE.Vector3()).toArray(), color: [light.color.r, light.color.g, light.color.b] as Vec3, intensity: light.intensity,
        ...(light instanceof THREE.SpotLight
          ? { target: light.target.getWorldPosition(new THREE.Vector3()).toArray(), angle: light.angle, penumbra: light.penumbra } : {}),
      }]
    }),
  }

  const root = new THREE.Scene()
  const mats = new Map<string, Surface>()
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()
  const temporary: { dispose(): void }[] = []
  const ocean = new THREE.MeshPhysicalMaterial({
    name: 'Pacific Ocean', color: '#345e6d', roughness: 0.19, ior: 1.333, metalness: 0.1, clearcoat: 0.25,
  })
  temporary.push(ocean)
  const materialFor = (material: THREE.Material, mesh: THREE.Mesh, bevel: boolean, tint?: THREE.Color) => {
    const leaf = material.customProgramCacheKey().startsWith('leaf-wind-') || /coastal-scrub|Scanned garden shrubs|palm crowns/i.test(
      `${material.customProgramCacheKey()} ${mesh.name}`,
    )
    const key = [material.id, leaf, bevel, tint?.toArray().join(',')].join(':')
    let out = mats.get(key)
    if (!out) {
      out = beautyMaterial(mesh.name === 'Pacific Ocean' ? ocean : material, bevel, tint)
      if (leaf) out.userData.beautyFoliage = true
      if (mesh.name === 'Distant forest cards') out.userData.beautyForestCard = true
      if (mesh.name === 'Pacific Ocean') out.userData.beautyOcean = true
      mats.set(key, out)
    }
    return out
  }

  function add(mesh: THREE.Mesh, matrix: THREE.Matrix4, bevel: boolean, tint?: THREE.Color) {
    if (mesh.userData.shadowOnly) return
    let geometry = geometries.get(mesh.geometry)
    if (!geometry) {
      // Share vertex/index buffers. glTF only needs the standard vertex attributes, including UVs used by PBR maps.
      geometry = new THREE.BufferGeometry()
      geometry.setIndex(mesh.geometry.index)
      geometry.groups = mesh.geometry.groups
      geometry.drawRange = mesh.geometry.drawRange
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        if (/^(position|normal|tangent|color|uv\d*|skinIndex|skinWeight)$/.test(name)) geometry.setAttribute(name, attribute)
      }
      geometry.morphAttributes = mesh.geometry.morphAttributes
      geometry.morphTargetsRelative = mesh.geometry.morphTargetsRelative
      geometries.set(mesh.geometry, geometry)
    }
    const material = Array.isArray(mesh.material)
      ? mesh.material.map(m => materialFor(m, mesh, bevel, tint))
      : materialFor(mesh.material, mesh, bevel, tint)
    const copy = new THREE.Mesh(geometry, material)
    copy.name = mesh.name
    copy.morphTargetInfluences = mesh.morphTargetInfluences?.slice()
    copy.matrixAutoUpdate = false
    copy.matrix.copy(matrix)
    root.add(copy)
  }

  function collect(group: THREE.Object3D, isSite: boolean) {
    // Keep the whole house (and occluders off camera) for GI, reflections and 360° shots.
    const instanceMatrix = new THREE.Matrix4()
    const worldMatrix = new THREE.Matrix4()
    const instancePosition = new THREE.Vector3()
    const tint = new THREE.Color()
    group.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh)) return
      let mesh = object
      const bevel = !isSite && !/foliage|linen|fabric|rug|art|glass|bedding|shade|lamp:/i.test(
        Array.isArray(mesh.material) ? '' : mesh.material.name,
      )
      if (isSite && mesh.name === 'Coastal canyon' && mesh.material instanceof THREE.MeshStandardMaterial) {
        const canyon = bakeCanyon(engine.renderer, mesh as THREE.Mesh<THREE.BufferGeometry, Surface>, position)
        canyon.name = mesh.name
        temporary.push(canyon.geometry, canyon.material, canyon.material.map!, canyon.material.normalMap!)
        add(canyon, mesh.matrixWorld, false)
        return
      }
      if (mesh instanceof THREE.InstancedMesh) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, instanceMatrix)
          worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix)
          instancePosition.setFromMatrixPosition(worldMatrix)
          // Preserve the app's coarse hillside scrub behind the house. Fine grass and
          // garden scrub can still stop once their blades and leaf cards become subpixel.
          const range = mesh.name === 'Distant coastal scrub' ? 230 : /grass|scrub/i.test(mesh.name) ? 82 : 180
          if (isSite && Math.hypot(position.x - instancePosition.x, position.z - instancePosition.z) > range) continue
          if (mesh.instanceColor) {
            mesh.getColorAt(i, tint)
            // Share imported meshes among similar plant tints. Continuous random colors otherwise
            // give Blender a separate mesh and BVH for almost every shrub or tree.
            const quantize = (channel: number) => Math.round(channel * 12) / 12
            tint.setRGB(quantize(tint.r), quantize(tint.g), quantize(tint.b))
          }
          // Plain glTF nodes share their source geometry and retain instance tint in the imported material.
          add(mesh, worldMatrix, bevel, mesh.instanceColor ? tint : undefined)
        }
        return
      }
      if (mesh.geometry instanceof THREE.InstancedBufferGeometry) {
        if (mesh.name === 'forest') {
          const geometry = mesh.geometry
          if (!geometry.instanceCount) return
          const seed = beautyForestSeed(geometry.getAttribute('iTone'))
          const { near, far } = beautyForestPlacements(geometry, mesh.matrixWorld, position)
          if (near.length && seed !== undefined) {
            const variant = seed === 5
              ? makeVariant('Pine Large', 4417, engine.quality.treeDetail, 'pine')
              : coastalTreeVariant(forestKinds[seed - 9], 36 + (seed - 9) * 18, 0.45)
            const trees = treeInstances(variant, near, true)
            temporary.push(variant.branches, variant.leaves)
            treeTextures.push(leavesReady(variant.leafKind))
            for (const part of trees.children as THREE.InstancedMesh[]) {
              part.name = 'Hillside trees'
              part.applyMatrix4(mesh.matrixWorld)
              part.updateMatrixWorld(true)
              collect(part, true)
              part.dispose()
            }
          }
          const indices = seed === undefined ? Array.from({ length: geometry.instanceCount }, (_, i) => i) : far
          if (!indices.length) return
          const localEye = position.clone().applyMatrix4(mesh.matrixWorld.clone().invert())
          const cards = forestCards(geometry, indices, localEye, mesh.userData.aspect)
          const map = captureRenderTarget(engine.renderer, mesh.userData.target, true)
          const material = (mesh.material as Surface).clone()
          material.vertexColors = true
          material.map = map
          const fallback = new THREE.Mesh(cards, material)
          fallback.name = 'Distant forest cards'
          temporary.push(cards, material, map)
          add(fallback, mesh.matrixWorld, false)
          return
        } else if (mesh.geometry.hasAttribute('iRot')) {
          const base = new THREE.Color('#635b30')
          const tip = new THREE.Color('#a69357')
          const mat = mesh.material as Surface
          const fallback = expandShaderInstances(mesh.geometry, mat, mat.map ? undefined :
            (t, hue) => base.clone().lerp(tip, t * (0.7 + 0.3 * hue)))
          if (!fallback) return
          mesh = fallback
        } else {
          // Camera-following lawn uses GPU-only placement. The textured terrain remains beneath it.
          return
        }
        mesh.name = object.name
        temporary.push(mesh.geometry, mesh.material as Surface)
      }
      add(mesh, object.matrixWorld, bevel)
    })
  }

  const treeTextures: (Promise<void> | undefined)[] = []
  try {
    collect(house.group, false)
    if (interior) collect(interior.group, false)
    if (site) collect(site.group, true)
    await Promise.all(treeTextures)
    const glb = await new GLTFExporter().parseAsync(root, { binary: true }) as ArrayBuffer
    return { glb, sky: world, meta }
  } finally {
    for (const material of mats.values()) material.dispose()
    for (const geometry of geometries.values()) geometry.dispose()
    for (const resource of temporary) resource.dispose()
  }
}
