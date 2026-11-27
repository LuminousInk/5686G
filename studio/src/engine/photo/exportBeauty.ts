import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { Engine } from '../Engine'
import { buildingSections, framePoint } from '../house/levels'
import { ceilingAt, roofHeightAt, roofThickness, sideIntervals, sidePoint, WALL_T } from '../house/massing'
import type { HomePlan } from '../house/types'
import { roomVolumes } from '../env/roomVolumes'
import { anchoredExposure, interiorExposureWeight, roomExposureEV } from '../render/exposureAnchors'
import { expandImpostors, expandShaderInstances } from './bake'

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

function captureRenderTarget(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
  const { width, height } = target
  const pixels = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
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
  map.colorSpace = target.texture.colorSpace
  return map
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
    const key = [material.id, mesh.name === 'Coastal canyon', bevel, tint?.toArray().join(',')].join(':')
    let out = mats.get(key)
    if (!out) {
      out = beautyMaterial(mesh.name === 'Pacific Ocean' ? ocean : material, bevel, tint)
      if (mesh.name === 'Coastal canyon') out.userData.beautyCanyon = true
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
      if (mesh instanceof THREE.InstancedMesh) {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, instanceMatrix)
          worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix)
          instancePosition.setFromMatrixPosition(worldMatrix)
          const range = /grass|scrub/i.test(mesh.name) ? 82 : 180
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
          const fallback = expandImpostors(mesh, camera, mesh.userData.aspect)
          if (!fallback) return
          const mat = fallback.material as Surface
          mat.map = captureRenderTarget(engine.renderer, mesh.userData.target)
          temporary.push(mat.map)
          mesh = fallback
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

  try {
    collect(house.group, false)
    if (interior) collect(interior.group, false)
    if (site) collect(site.group, true)
    const glb = await new GLTFExporter().parseAsync(root, { binary: true }) as ArrayBuffer
    return { glb, sky: world, meta }
  } finally {
    for (const material of mats.values()) material.dispose()
    for (const geometry of geometries.values()) geometry.dispose()
    for (const resource of temporary) resource.dispose()
  }
}
