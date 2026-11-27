import * as THREE from 'three'
import type { HomePlan, Rect } from '../house/types'
import type { QualitySettings } from '../quality'
import { rng } from '../materials/textures'
import { modelPieces } from '../models'
import { coastalPlantLayout, type Neighbor, type PlantSpot } from './coastalLayout'
import { canyonMoisture, drainage, type Hillside } from './hillside'
import { coastalHaze, type CoastalSky } from './ocean'
import { wind } from './grass'
import { coastalTreeVariant, impostorForest, leafMaterial, leavesReady, treeInstances, type CoastalTree, type TreePlacement } from './trees'

type Plant = PlantSpot
type Grass = [number, number, number, number]
const up = new THREE.Vector3(0, 1, 0)

function instances(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], plants: Plant[], shadows: boolean, name: string) {
  const mesh = new THREE.InstancedMesh(geometry, material, plants.length)
  mesh.name = name
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const tint = new THREE.Color()
  plants.forEach(({ x, y, z, size, yaw }, i) => {
    matrix.compose(position.set(x, y, z), rotation.setFromAxisAngle(up, yaw), scale.setScalar(size))
    mesh.setMatrixAt(i, matrix)
    const tone = 0.84 + 0.21 * Math.cos(x * 4.6 + z * 2.1)
    mesh.setColorAt(i, tint.setRGB(tone, tone, tone * (1 + 0.15 * Math.sin(z * 5.7))))
  })
  mesh.castShadow = shadows
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  return mesh
}

class PlantGeometry {
  positions: number[] = []
  colors: number[] = []
  triangles: number[] = []

  point(x: number, y: number, z: number, color: THREE.Color) {
    const i = this.positions.length / 3
    this.positions.push(x, y, z)
    this.colors.push(color.r, color.g, color.b)
    return i
  }

  /** A curved tapered leaf with a raised central rib and darker margins. */
  leaf(x: number, y: number, z: number, angle: number, reach: number, rise: number, arch: number, width: number, color: THREE.Color, steps: number) {
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    const start = this.positions.length / 3
    const edge = color.clone().multiplyScalar(0.75)
    const rib = color.clone().multiplyScalar(1.25)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const w = width * (0.02 + Math.sin(Math.PI * (0.17 + t * 0.83)) * (1 - t * 0.43))
      const ox = x + dx * reach * t
      const oz = z + dz * reach * t
      const h = y + rise * t + arch * Math.sin(Math.PI * t)
      this.point(ox - dz * w, h, oz + dx * w, edge)
      this.point(ox, h + w * 0.33, oz, rib)
      this.point(ox + dz * w, h, oz - dx * w, color)
      if (i) {
        const a = start + (i - 1) * 3
        this.triangles.push(a, a + 3, a + 4, a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 1, a + 5, a + 2)
      }
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    g.setIndex(this.triangles)
    g.computeVertexNormals()
    return g
  }
}

function rosette(aloe: boolean, low: boolean) {
  const g = new PlantGeometry()
  const rand = rng(aloe ? 57 : 18)
  const colors = (aloe ? ['#719554', '#526939', '#809b5d'] : ['#778d81', '#5d7766', '#657e71']).map(c => new THREE.Color(c))
  const leaves = low ? 13 : 20
  for (let i = 0; i < leaves; i++) {
    const t = i / leaves
    const size = 0.85 + rand() * 0.2
    g.leaf(0, 0.025 + t * 0.04, 0, i * 2.39996, (0.9 - t * 0.8) * size,
      (t - 0.18) * size, (0.27 + t * 0.25) * size, (aloe ? 0.063 : 0.125) * size, colors[i % 3], low ? 4 : 6)
  }
  return g.geometry()
}

function scrub(lavender: boolean, low: boolean) {
  const g = new PlantGeometry()
  const rand = rng(lavender ? 64 : 15)
  const colors = (lavender ? ['#7c8872', '#a5a993', '#69755a'] : ['#657347', '#9ba16c', '#4d6044']).map(c => new THREE.Color(c))
  const stem = new THREE.Color('#81714d')
  const flower = new THREE.Color('#9180a8')
  const sprigs = lavender ? (low ? 19 : 29) : (low ? 23 : 35)
  for (let i = 0; i < sprigs; i++) {
    const angle = i * 2.39996
    const r = Math.sqrt((i + 0.5) / sprigs) * 0.52
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    const height = 0.59 - r * 0.52 + rand() * 0.17
    g.leaf(dx * r * 0.22, 0, dz * r * 0.22, angle, r * 0.78, height, 0.04, 0.01, stem, 2)
    const leaves = low ? 5 : 7
    for (let j = 0; j < leaves; j++) {
      const t = (j + 2) / (leaves + 2)
      g.leaf(dx * r * t, height * t, dz * r * t, angle + (j % 2 ? 1.4 : -1.4),
        0.19 + rand() * 0.10, 0.065 + rand() * 0.10, 0.04, lavender ? 0.031 : 0.062, colors[(i + j) % 3], 2)
    }
    if (lavender) {
      for (let j = 0; j < 3; j++) {
        g.leaf(dx * r, height + 0.018 * j, dz * r, angle + j * 2.1, 0.018, 0.12, 0.012, 0.017, flower, 2)
      }
    }
  }
  return g.geometry()
}

const scrubColors = ['#878971', '#a9a688', '#7e8a64', '#999c75', '#889487']
const hedgeColors = ['#62775a', '#566f4a', '#70805b']

function dryGrassClump() {
  const g = new PlantGeometry()
  const rand = rng(712)
  const tones = ['#937a4e', '#b39661', '#81724c', '#ad986b'].map(c => new THREE.Color(c))
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39996
    const r = Math.sqrt(rand()) * 0.36
    g.leaf(Math.cos(a) * r, 0.025, Math.sin(a) * r, a + rand(),
      0.12 + rand() * 0.13, 0.11 + rand() * 0.26, 0.04, 0.016, tones[i % tones.length], 1)
  }
  return g.geometry()
}

function lawnTuft() {
  const g = new PlantGeometry()
  const shades = ['#536b3a', '#657a3f', '#73874a', '#526c40'].map(c => new THREE.Color(c))
  const rand = rng(57)
  for (let i = 0; i < 4; i++) {
    const a = i * 2.39996
    const r = rand() * 0.049
    const reach = 0.022 + 0.032 * rand()
    const rise = 0.030 + 0.037 * rand()
    g.leaf(Math.cos(a) * r, 0, Math.sin(a) * r, a, reach, rise, 0.014, 0.005, shades[i], 2)
  }
  return g.geometry()
}

function movingGrassMaterial(grassMotion: THREE.IUniform<number>) {
  const grassMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.88 })
  grassMaterial.onBeforeCompile = shader => {
    shader.uniforms.grassMotion = grassMotion
    shader.uniforms.siteWindTime = wind.uTime
    shader.uniforms.siteWind = wind.uWind
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float grassMotion, siteWindTime, siteWind;')
      .replace('#include <begin_vertex>', /* glsl */ `
        #include <begin_vertex>
        // Height-weighted vertex wind follows the approach used by GrassSystemThreeJS (MIT).
        vec3 root = (modelMatrix * instanceMatrix[3]).xyz;
        float distanceToCamera = length(root - cameraPosition);
        float windLod = 1.0 - smoothstep(11.0, 29.0, distanceToCamera);
        float phase = dot(root.xz, vec2(0.35, -0.23)) - siteWindTime * 1.4;
        vec2 breeze = vec2(sin(phase) * 0.65 + sin(phase * 1.72) * 0.35, cos(phase + 0.9) * 0.37);
        transformed.xz += breeze * transformed.y * transformed.y * siteWind * windLod * 0.81;
        transformed *= 1.0 - grassMotion * smoothstep(22.0, 42.0, distanceToCamera);
      `)
  }
  grassMaterial.customProgramCacheKey = () => 'coastal-grass-distance'
  return grassMaterial
}

export function buildLawnTufts(lawn: Rect, hill: Hillside, low: boolean, grassMotion: THREE.IUniform<number>) {
  const [left, top, right, bottom] = lawn
  const grass: Plant[] = []
  const rand = rng(28076)
  const spacing = low ? 0.16 : 0.105
  for (let u = left + 0.17; u < right - 0.17; u += spacing) {
    for (let v = top + 0.11; v < bottom - 0.11; v += spacing) {
      const [x, z] = hill.world(u + (rand() - 0.5) * spacing, v + (rand() - 0.5) * spacing)
      grass.push({
        x, y: hill.surfaceHeight(...hill.local(x, z)) - 0.007, z, size: 0.68 + rand() * 0.45,
        radius: spacing * 0.48, yaw: rand() * Math.PI * 2,
      })
    }
  }
  return instances(lawnTuft(), movingGrassMaterial(grassMotion), grass, false, 'Short lawn blades')
}

async function outcrops(hill: Hillside, low: boolean, open: (x: number, z: number, r: number, garden?: boolean) => boolean, plan: HomePlan) {
  const rand = rng(1986)
  const places: Plant[][] = [[], []]
  for (let i = 0; i < (low ? 26 : 48); i++) {
    const u = (rand() - 0.5) * 225
    const v = hill.pad[1] - 112 + rand() * (hill.pad[3] - hill.pad[1] + 205)
    const [x, z] = hill.world(u, v)
    const y = hill.surfaceHeight(u, v)
    const slope = Math.max(Math.abs(hill.heightAt(x + 1, z) - y), Math.abs(hill.heightAt(x, z + 1) - y))
    if ((slope < 0.31 && drainage(u, v) < 0.46) || !open(x, z, 3.7)) continue
    for (let j = 0; j < 3; j++) {
      const size = 0.85 + rand() * (j === 0 ? 3.7 : 1.9)
      const dx = x + (j ? (rand() - 0.5) * 4.8 : 0)
      const dz = z + (j ? (rand() - 0.5) * 3.4 : 0)
      if (!open(dx, dz, size * 0.64)) continue
      places[(i + j) % 2].push({
        x: dx, z: dz, y: hill.surfaceHeight(...hill.local(dx, dz)) - size * 0.17,
        size, radius: size * 0.65, yaw: rand() * 6.283,
      })
    }
  }
  for (const bed of plan.landscape.berms ?? []) {
    if (bed.h <= 0) continue
    for (let i = 0; i < 3; i++) {
      const x = bed.x + (i - 1) * bed.rx * 0.51
      const z = bed.z + hill.dz * bed.rz * (0.48 + 0.24 * rand())
      const size = 0.58 + rand() * 0.91
      if (open(x, z, size * 0.47, true)) places[i % 2].push({
        x, z, y: hill.surfaceHeight(...hill.local(x, z)) - size * 0.16,
        size, radius: size * 0.55, yaw: rand() * 6.283,
      })
    }
  }
  return (await Promise.all(['rock_07', low ? 'rock_09' : 'namaqualand_boulder_02'].map(async (id, i) => {
    if (!places[i].length) return []
    const pieces = await modelPieces(id).catch(() => [])
    return pieces.map(({ geometry, material }) => {
      const bb = geometry.boundingBox!
      const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
      geometry.scale(1 / width, 0.74 / width, 1 / width)
      return instances(geometry, material, places[i], false, 'Sandstone ledges and float boulders')
    })
  }))).flat()
}

/** Assemble twig cards into irregular, leafy silhouettes with a low-cost version for the farther slopes. */
function woodyFoliage(seed: number, detail: number, hedge = false) {
  const rand = rng(seed)
  // California sagebrush, coyote brush and coffeeberry inform the dryland tones.
  const colors = (hedge ? hedgeColors : scrubColors).map(c => new THREE.Color(c))
  const positions: number[] = [], tones: number[] = [], uvs: number[] = [], indices: number[] = []
  const horizontal = new THREE.Vector3()
  const vertical = new THREE.Vector3()
  const center = new THREE.Vector3()
  const point = new THREE.Vector3()
  const count = hedge ? 72 : detail === 0 ? 11 : detail === 1 ? 33 : 49
  for (let i = 0; i < count; i++) {
    const radial = Math.sqrt(rand())
    const angle = i * 2.39996
    const spread = hedge ? 0.55 : 0.72
    const height = hedge ? 1.60 : 0.72
    const ring = (0.81 - 0.27 * Math.cos(angle * 3 + seed)) * radial * spread
    const y = (0.14 + 0.72 * rand()) * height * (1 - radial * (hedge ? 0.25 : 0.56))
    center.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring)
    const yaw = rand() * 6.283
    const pitch = (rand() - 0.5) * 2.7
    const width = (0.33 + rand() * 0.23) * (detail === 0 ? 1.42 : 1)
    const length = width * (hedge ? 1.23 : 0.95 + rand() * 0.35)
    horizontal.set(Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(width)
    vertical.set(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)).multiplyScalar(length)
    const tint = colors[(i + seed) % colors.length].clone().multiplyScalar(0.52 + y / height * 0.65 + rand() * 0.24)
    const base = positions.length / 3
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      point.copy(center).addScaledVector(horizontal, u - 0.5).addScaledVector(vertical, v - 0.42)
      positions.push(point.x, point.y, point.z)
      tones.push(tint.r, tint.g, tint.b)
      uvs.push(u, v)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(tones, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function floweringPlant(wall: boolean, low: boolean) {
  const g = new PlantGeometry()
  const rand = rng(wall ? 62 : 98)
  const leaves = ['#4b603d', '#667247', '#566943'].map(c => new THREE.Color(c))
  const flowers = (wall ? ['#b73f65', '#974362', '#d06a86'] : ['#9d3f32', '#c6683d', '#9b623b']).map(c => new THREE.Color(c))
  const count = low ? 18 : 28
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996
    const r = 0.18 + rand() * (wall ? 0.49 : 0.26)
    const h = 0.29 + rand() * (wall ? 0.60 : 0.53)
    const x = r * Math.cos(a), z = r * Math.sin(a)
    const leaf = leaves[i % leaves.length]
    g.leaf(0, 0.02, 0, a, r, h, 0.09, 0.018, leaf, 3)
    for (let j = 1; j < 4; j++) {
      const t = j / 4
      g.leaf(x * t, h * t, z * t, a + j * 1.6, wall ? 0.20 : 0.24, 0.10, 0.06, wall ? 0.07 : 0.025, leaf, 2)
    }
    for (let j = 0; j < 3; j++) {
      g.leaf(x, h - j * 0.033, z, a + j * 2.1, wall ? 0.12 : 0.068, 0.045, 0.028, 0.029, flowers[(i + j) % 3], 2)
    }
  }
  return g.geometry()
}

function palms(low: boolean, queen: boolean) {
  const trunk = new THREE.CylinderGeometry(queen ? 0.013 : 0.018, queen ? 0.026 : 0.033, 0.80, 8, 12)
  trunk.translate(0, 0.4, 0)
  const p = trunk.getAttribute('position')
  const barkColors = []
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    const band = Math.round(y * 28)
    const color = new THREE.Color('#8e765d').multiplyScalar(0.68 + 0.32 * Math.sin(band * 2.12) ** 2)
    barkColors.push(color.r, color.g, color.b)
    p.setXYZ(i, p.getX(i) * (band % 2 ? 0.89 : 1.1) + y * y * 0.07, y, p.getZ(i))
  }
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(barkColors, 3))
  trunk.computeVertexNormals()

  const crown = new PlantGeometry()
  const rand = rng(401)
  const stem = new THREE.Color('#889155')
  for (let i = 0; i < (low ? 12 : 17); i++) {
    const a = 2.39996 * i
    const r = 0.08 + 0.085 * rand()
    const z = Math.sin(a) * r
    const y = 0.77 + 0.17 * (i / 17) + rand() * 0.045
    const leaf = new THREE.Color(i < 4 ? '#82794b' : i % 3 === 0 ? '#87964b' : '#546a38')
    crown.leaf(0.05, 0.78, 0, a, r, y - 0.78, 0.028, 0.008, stem, 3)
    const count = low ? 9 : 12
    for (let j = 0; j < count; j++) {
      const fan = (j / (count - 1) - 0.5) * 2
      const spread = queen ? 0.065 : 0.13
      const reach = queen ? r * (0.15 + 0.75 * j / count) : r
      crown.leaf(0.05 + Math.cos(a) * reach, y - (queen ? 0.025 * Math.abs(fan) : 0), queen ? Math.sin(a) * reach : z,
        a + (queen ? (j % 2 ? 1 : -1) * 0.84 : fan * 1.45), spread - 0.027 * Math.abs(fan),
        (i / 17 - 0.68) * 0.16 - (queen ? 0.075 : 0), 0.036, queen ? 0.009 : 0.014, leaf, 3)
    }
  }
  if (!queen) {
    const straw = new THREE.Color('#8e7650')
    for (let i = 0; i < (low ? 12 : 18); i++) {
      const a = i * 2.39996
      crown.leaf(0.047, 0.803, 0, a, 0.05 + rand() * 0.052,
        -0.045 - rand() * 0.095, 0.041, 0.009, straw, 3)
    }
  }
  return [trunk, crown.geometry()]
}

const treeKinds: Record<NonNullable<NonNullable<HomePlan['landscape']['trees']>[number]['kind']>, CoastalTree> = {
  pine: 'stone-pine', 'pine-small': 'canary-pine', aspen: 'sycamore', bush: 'olive',
}
const heights: Record<CoastalTree, number> = {
  'live-oak': 10.4, sycamore: 13.5, 'stone-pine': 11.5, 'canary-pine': 15, olive: 3.4, eucalyptus: 14.6,
}

export async function plantHillside(plan: HomePlan, hill: Hillside, quality: QualitySettings,
  neighbors: Neighbor[], sky: CoastalSky, renderer: THREE.WebGLRenderer, grassMotion: THREE.IUniform<number>) {
  const rand = rng(116 + plan.id.length * 34)
  const low = quality.tier === 'low'
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.88 })
  const scrubMaterial = new THREE.MeshStandardMaterial({
    map: leafMaterial('oak').map, alphaTest: 0.36,
    side: THREE.DoubleSide, vertexColors: true, roughness: 0.94,
  })
  scrubMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', /* glsl */`
      #include <normal_fragment_begin>
      normal = normalize(normal * 0.64 + mat3(viewMatrix) * vec3(0.0, 0.62, 0.0));
    `)
  }
  coastalHaze(scrubMaterial, sky, 'coastal-scrub')
  const meshes: THREE.InstancedMesh[] = []
  const impostors: THREE.Mesh[] = []
  const grasses: Grass[] = []
  const { near, far, hedges, dryGrass, gardenGrass, garden: forms, open, spot } = coastalPlantLayout(plan, hill, quality.tier, neighbors)
  const [u0, v0, u1, v1] = hill.pad

  for (let variant = 0; variant < 3; variant++) {
    const close = near.filter((_, i) => i % 3 === variant)
    const distant = far.filter((_, i) => i % 3 === variant)
    meshes.push(instances(woodyFoliage(variant + 2, low ? 1 : 2), scrubMaterial, close, false, 'Chaparral and sage scrub'),
      instances(woodyFoliage(variant + 3, 0), scrubMaterial, distant, false, 'Distant coastal scrub'))
  }
  if (hedges.length) {
    meshes.push(instances(woodyFoliage(3, 2, true), scrubMaterial, hedges, true, 'Lot line hedges'))
  }
  const materials = [material, scrubMaterial]
  if (dryGrass.length) {
    const grassMaterial = movingGrassMaterial(grassMotion)
    materials.push(grassMaterial)
    meshes.push(instances(dryGrassClump(), grassMaterial, [...gardenGrass, ...dryGrass], false, 'Summer grass drifts'))
  }

  grasses.push(...forms[8].slice(0, quality.ornamentalClumps).map(({ x, y, z, size }): Grass => [x, y, z, size]))

  for (const [index, geometry, name] of [
    [0, rosette(false, low), 'Blue agave'],
    [1, rosette(true, low), 'Coastal aloe'],
    [2, scrub(false, low), 'Rosemary and sage'],
    [3, scrub(true, low), 'Lavender'],
    [4, floweringPlant(false, low), 'Kangaroo paw'],
    [5, floweringPlant(true, low), 'Bougainvillea on retaining walls'],
  ] as const) {
    if (forms[index].length) meshes.push(instances(geometry, material, forms[index], true, name))
    else geometry.dispose()
  }

  const palmsNear: Plant[] = [], queenNear: Plant[] = []
  const trees = new Map<CoastalTree, TreePlacement[]>()
  const orbitCameras = plan.views.filter(v => v.kind === 'orbit' && v.pos[1] > 3 && v.pos[1] < 17)
  const cameraClear = (x: number, z: number, radius: number, height: number) => {
    const y = hill.heightAt(x, z)
    return !orbitCameras.some(({ id, pos: [cx, cy, cz], target: [tx, ty, tz] }) => {
      if (cy < y + height + 0.65 && Math.hypot(x - cx, z - cz) < radius + 1.9) return true
      if (id !== 'hero' && id !== 'corner') return false
      const dx = tx - cx, dz = tz - cz
      const t = ((x - cx) * dx + (z - cz) * dz) / (dx * dx + dz * dz || 1)
      const lineHeight = THREE.MathUtils.lerp(cy, ty, t)
      return t > 0 && t < 0.72 && lineHeight > y + height * 0.47 && lineHeight < y + height &&
        Math.hypot(x - (cx + dx * t), z - (cz + dz * t)) < radius * 0.68
    })
  }
  const addTree = (kind: CoastalTree, x: number, z: number, height: number) => {
    // The base of the trunk and roots need to clear hardscape; crowns can overhang it.
    if (!open(x, z, 0.78, true) || !cameraClear(x, z, height * 0.51, height)) return
    const items = trees.get(kind) ?? []
    if (items.some(p => Math.hypot(p.x - x, p.z - z) < 3.5)) return
    items.push({ x, z, y: hill.heightAt(x, z), height, yaw: rand() * 6.283 })
    trees.set(kind, items)
  }
  const addPalm = (list: Plant[], x: number, z: number, height: number) => {
    if (open(x, z, 0.65, true) && cameraClear(x, z, height * 0.24, height)) list.push(spot(x, z, height, 0.65, rand() * 6.283))
  }
  for (const tr of plan.landscape.trees ?? []) {
    const scale = tr.s ?? 1
    if (!tr.kind) {
      addPalm(palmsNear, tr.x, tr.z, scale * 11.4)
    } else {
      const kind = treeKinds[tr.kind]
      addTree(kind, tr.x, tr.z, scale * heights[kind])
    }
  }
  for (const [u, v, kind, height] of [
    [u0 - 6.8, v0 - 3.5, 'live-oak', 11.2],
    [u1 + 7.4, v0 - 7.2, 'stone-pine', 13.3],
    [u1 + 4.2, v1 - 1.5, 'sycamore', 11.8],
    [u0 - 7.7, v1 + 6.2, 'live-oak', 9.1],
    [u1 + 12, v1 + 16.4, 'eucalyptus', 13.7],
    [u0 - 15, v0 - 18.5, 'eucalyptus', 16.2],
    [u1 + 20, v0 - 14.5, 'live-oak', 10.9],
    [u0 - 18, v1 + 19.4, 'sycamore', 10.2],
  ] as const) addTree(kind, ...hill.world(u, v), height)
  for (const [u, v, height] of [[u0 - 6.3, v1 + 1.2, 11.4], [u1 + 4.8, v1 + 6.3, 12.7]]) {
    addPalm(queenNear, ...hill.world(u, v), height)
  }
  for (const [kind, items] of trees) {
    const variants = items.length >= 3 ? 2 : 1
    for (let i = 0; i < variants; i++) {
      const variant = coastalTreeVariant(kind, 74 + kind.length + i * 59, quality.treeDetail)
      for (const child of treeInstances(variant, items.filter((_, j) => j % variants === i), true).children) {
        child.name = kind
        meshes.push(child as THREE.InstancedMesh)
      }
    }
  }
  for (const [list, queen] of [[palmsNear, false], [queenNear, true]] as const) {
    if (!list.length) continue
    const [trunk, crown] = palms(low, queen)
    meshes.push(instances(trunk, material, list, true, 'Palm trunks'),
      instances(crown, material, list, true, queen ? 'Queen palm crowns' : 'Mexican fan palm crowns'))
  }

  const forestKinds = ['live-oak', 'canary-pine', 'sycamore', 'live-oak', 'stone-pine'] as const
  const sketched: TreePlacement[][] = forestKinds.map(() => [])
  const budget = Math.round(quality.forestTrees * 2.2)
  for (let i = 0; i < budget * 8 && sketched.reduce((count, items) => count + items.length, 0) < budget; i++) {
    const u = (rand() - 0.5) * 460
    const v = v0 - 180 + rand() * (v1 - v0 + 350)
    const distance = Math.hypot(Math.max(u0 - u, u - u1, 0), Math.max(v0 - v, v - v1, 0))
    if (distance < 30 || (v > v1 && Math.abs(u) < 24) || rand() > 0.16 + 0.79 * canyonMoisture(u, v)) continue
    const [x, z] = hill.world(u, v)
    if (!open(x, z, 2.8)) continue
    const variant = i % forestKinds.length
    const size = 0.50 + rand() ** 1.3 * 0.86
    sketched[variant].push({ x, z, y: hill.surfaceHeight(u, v), height: heights[forestKinds[variant]] * size, yaw: 0 })
  }

  const loads = Promise.all(['shrub_03', 'grass_medium_01'].map(id => modelPieces(id).catch(() => [])))
  for (let i = 0; i < sketched.length; i++) {
    if (!sketched[i].length) continue
    const variant = coastalTreeVariant(forestKinds[i], 36 + i * 18, 0.45)
    await leavesReady(variant.leafKind)
    const mesh = impostorForest(renderer, variant, sketched[i], i + 9)
    const cards = mesh.material as THREE.MeshStandardMaterial
    coastalHaze(cards, sky, `coastal-tree-${cards.customProgramCacheKey()}`)
    variant.branches.dispose()
    variant.leaves.dispose()
    impostors.push(mesh)
  }

  await Promise.all([...trees.keys()].map(kind => leavesReady(kind === 'live-oak' ? 'oak' : kind === 'sycamore' || kind === 'olive' || kind === 'eucalyptus' ? kind : 'pine')))
  const models = await loads
  models.forEach((pieces, i) => {
    const locations = forms[i + 6]
    pieces.forEach(({ geometry, material: plantMaterial }, j) => {
      const places = locations.filter((_, k) => k % pieces.length === j)
      if (!places.length) {
        geometry.dispose()
        return
      }
      const bb = geometry.boundingBox!
      const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
      geometry.scale(1 / width, 1 / width, 1 / width)
      meshes.push(instances(geometry, plantMaterial, places, true, i === 0 ? 'Scanned garden shrubs' : 'Scanned ornamental grasses'))
    })
  })
  meshes.push(...await outcrops(hill, low, open, plan))
  return { meshes, grasses, impostors, materials }
}
