import * as THREE from 'three'
import type { Engine } from '../Engine'

export interface PhotoScene {
  scene: THREE.Scene
  textureLayers: number
  triangles: number
  dispose(): void
}

// WebGLPathTracer's material table supports these maps. Raster probes, baked GI and other shader-only inputs
// would occupy atlas layers without contributing any light to the path-traced image.
const tracedMaps = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap',
  'transmissionMap', 'thicknessMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap',
  'sheenColorMap', 'sheenRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap',
  'specularColorMap', 'specularIntensityMap',
]

function traceMaterial(source: THREE.Material, textures: Map<THREE.Texture, THREE.Texture>) {
  if (!('isMeshStandardMaterial' in source) && !('isMeshBasicMaterial' in source)) return null
  const material = source.clone() as THREE.MeshStandardMaterial
  const maps = material as unknown as Record<string, unknown>
  for (const key of Object.keys(maps)) {
    const map = maps[key]
    if (!(map instanceof THREE.Texture)) continue
    if (!tracedMaps.includes(key)) {
      maps[key] = null
      continue
    }
    let copy = textures.get(map)
    if (!copy) {
      // The atlas builder temporarily changes texture matrices. Clones share image data, but own those matrices.
      copy = map.clone()
      textures.set(map, copy)
    }
    maps[key] = copy
  }
  // House glazing is modeled as a single plane. Trace it as a thin dielectric.
  if (source.name === 'glass' && material instanceof THREE.MeshPhysicalMaterial) {
    material.transmission = 1
    material.thickness = 0
    material.side = THREE.DoubleSide
  }
  return material
}

/** Snapshot the visible architectural meshes without changing the live scene or sharing mutable materials. */
export function preparePhotoScene(engine: Engine): PhotoScene {
  const scene = new THREE.Scene()
  const materials = new Map<THREE.Material, THREE.Material | null>()
  const textures = new Map<THREE.Texture, THREE.Texture>()
  const layers = new Set<string>()
  let triangles = 0
  const materialFor = (source: THREE.Material) => {
    if (!materials.has(source)) {
      const copy = traceMaterial(source, textures)
      materials.set(source, copy)
      if (copy) {
        const values = copy as unknown as Record<string, unknown>
        for (const key of tracedMaps) {
          const tex = values[key]
          if (tex instanceof THREE.Texture) layers.add(`${tex.source.uuid}:${tex.colorSpace}`)
        }
      }
    }
    return materials.get(source)!
  }
  for (const group of [engine.house?.group, engine.interior?.group]) {
    group?.updateWorldMatrix(true, true)
    group?.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh ||
        object.geometry instanceof THREE.InstancedBufferGeometry || object.userData.shadowOnly ||
        !object.layers.test(engine.camera.layers)) return
      const originals = Array.isArray(object.material) ? object.material : [object.material]
      if (!originals.some(m => m.visible)) return
      const copies = originals.map(materialFor)
      if (copies.some(m => m === null)) return
      const geometry = object.geometry
      const mesh = new THREE.Mesh(geometry, Array.isArray(object.material) ? copies : copies[0])
      mesh.matrix.copy(object.matrixWorld)
      mesh.matrixAutoUpdate = false
      mesh.castShadow = object.castShadow
      scene.add(mesh)
      triangles += Math.floor((geometry.index?.count ?? geometry.getAttribute('position').count) / 3)
    })
  }
  engine.lights.group.updateWorldMatrix(true, true)
  engine.lights.group.traverseVisible(object => {
    if (!(object instanceof THREE.Light) || object.intensity <= 0) return
    const copy = object.clone()
    copy.position.setFromMatrixPosition(object.matrixWorld)
    if (object instanceof THREE.SpotLight && copy instanceof THREE.SpotLight) {
      copy.target.position.setFromMatrixPosition(object.target.matrixWorld)
      scene.add(copy.target)
    }
    scene.add(copy)
  })
  const lights = engine.sky
  const width = 512
  const height = width / 2
  const sky = lights.worldSky(width, height)
  if (sky && lights.sunIntensity > 0) paintSunDisk(sky, width, height, lights.sunDir,
    lights.sunColor.clone().multiplyScalar(lights.sunIntensity), lights.preset.sunRadius)
  if (sky) {
    const pixels = new Uint16Array(width * height * 4)
    for (let i = 0, j = 0; i < sky.length; i += 3, j += 4) {
      for (let c = 0; c < 3; c++) pixels[j + c] = THREE.DataUtils.toHalfFloat(Math.min(sky[i + c], 65000))
      pixels[j + 3] = 0x3c00
    }
    const map = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType)
    map.mapping = THREE.EquirectangularReflectionMapping
    map.colorSpace = THREE.LinearSRGBColorSpace
    map.flipY = true
    map.minFilter = map.magFilter = THREE.LinearFilter
    map.needsUpdate = true
    scene.environment = map
  }
  // A primary or transmitted ray that leaves the house is composited over the existing raster.
  scene.background = null

  return {
    scene,
    triangles,
    textureLayers: layers.size,
    dispose() {
      scene.environment?.dispose()
      for (const material of materials.values()) material?.dispose()
      for (const texture of textures.values()) texture.dispose()
      scene.clear()
    },
  }
}

/** Deposit the directional light's irradiance over a sampled disk in the equirectangular environment. */
export function paintSunDisk(
  pixels: Float32Array, width: number, height: number, direction: THREE.Vector3, energy: THREE.Color, degrees: number,
) {
  const stepX = Math.PI * 2 / width
  const stepY = Math.PI / height
  const radius = Math.max(THREE.MathUtils.degToRad(degrees), Math.hypot(stepX, stepY) * 0.7)
  const cosRadius = Math.cos(radius)
  const el = Math.asin(direction.y)
  const phi = Math.atan2(direction.z, direction.x)
  const cx = Math.floor((phi / (Math.PI * 2) + 0.5) * width)
  const cy = Math.floor((0.5 - el / Math.PI) * height)
  const xSpan = Math.min(width >> 1, Math.ceil(radius / (stepX * Math.max(0.001, Math.cos(el)))) + 1)
  const ySpan = Math.ceil(radius / stepY) + 1
  const disk: number[] = []
  let area = 0
  for (let y = Math.max(0, cy - ySpan); y <= Math.min(height - 1, cy + ySpan); y++) {
    const lat = (height / 2 - y - 0.5) * stepY
    const c = Math.cos(lat)
    for (let dx = -xSpan; dx < Math.min(xSpan + 1, width - xSpan); dx++) {
      const x = (cx + dx + width) % width
      const theta = (x + 0.5 - width / 2) * stepX
      const dot = c * (Math.cos(theta) * direction.x + Math.sin(theta) * direction.z) + Math.sin(lat) * direction.y
      if (dot >= cosRadius) {
        disk.push((y * width + x) * 3)
        area += stepX * stepY * c
      }
    }
  }
  if (!area) return
  for (const i of disk) {
    pixels[i] += energy.r / area
    pixels[i + 1] += energy.g / area
    pixels[i + 2] += energy.b / area
  }
}
