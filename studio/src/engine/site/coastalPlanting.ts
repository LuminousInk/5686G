import * as THREE from 'three'
import type { HomePlan } from '../house/types'
import type { QualitySettings } from '../quality'
import { rng } from '../materials/textures'
import { modelPieces } from '../models'
import { Hillside, siteFootprints } from './hillside'
import { makeVariant, treeInstances, type TreePlacement } from './trees'

type Plant = { x: number; y: number; z: number; size: number; yaw: number }
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
  const colors = (aloe ? ['#719554', '#526939', '#809b5d'] : ['#73978d', '#547f74', '#577d76']).map(c => new THREE.Color(c))
  const leaves = low ? 13 : 20
  for (let i = 0; i < leaves; i++) {
    const t = i / leaves
    const size = 0.85 + rand() * 0.2
    g.leaf(0, 0.025 + t * 0.04, 0, i * 2.39996, (0.9 - t * 0.8) * size,
      (t - 0.18) * size, (0.27 + t * 0.25) * size, (aloe ? 0.063 : 0.125) * size, colors[i % 3], low ? 4 : 6)
  }
  return g.geometry()
}

function scrub(lavender: boolean, low: boolean, distant = false) {
  const g = new PlantGeometry()
  const rand = rng(lavender ? 64 : 15)
  const colors = (lavender ? ['#7c8872', '#a5a993', '#69755a'] : ['#657347', '#9ba16c', '#4d6044']).map(c => new THREE.Color(c))
  const stem = new THREE.Color('#81714d')
  const flower = new THREE.Color('#9180a8')
  const sprigs = distant ? (low ? 8 : 11) : lavender ? (low ? 19 : 29) : (low ? 23 : 35)
  for (let i = 0; i < sprigs; i++) {
    const angle = i * 2.39996
    const r = Math.sqrt((i + 0.5) / sprigs) * (distant ? 0.59 : 0.52)
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    const height = 0.59 - r * 0.52 + rand() * 0.17
    g.leaf(dx * r * 0.22, 0, dz * r * 0.22, angle, r * 0.78, height, 0.04, 0.01, stem, 2)
    const leaves = distant ? 3 : low ? 5 : 7
    for (let j = 0; j < leaves; j++) {
      const t = (j + 2) / (leaves + 2)
      g.leaf(dx * r * t, height * t, dz * r * t, angle + (j % 2 ? 1.4 : -1.4),
        0.19 + rand() * 0.10, 0.065 + rand() * 0.10, 0.04, lavender ? 0.031 : 0.062, colors[(i + j) % 3], distant ? 1 : 2)
    }
    if (lavender) {
      for (let j = 0; j < 3; j++) {
        g.leaf(dx * r, height + 0.018 * j, dz * r, angle + j * 2.1, 0.018, 0.12, 0.012, 0.017, flower, 2)
      }
    }
  }
  return g.geometry()
}

function dryGroundcover() {
  const g = new PlantGeometry()
  const tones = ['#837b50', '#887447', '#8e8c5f', '#b09a65', '#696c43'].map(c => new THREE.Color(c))
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39996
    const together = Math.cos(i * 43.7) * 0.5 + 0.5
    const radius = 0.48 * Math.sqrt(i / 11)
    g.leaf(Math.cos(a) * radius, 0.006, Math.sin(a) * radius,
      a + 0.7, 0.13 + together * 0.2, 0.045 + together * 0.14, 0.07, 0.031, tones[i % 5], 2)
  }
  return g.geometry()
}

function palms(low: boolean) {
  const trunk = new THREE.CylinderGeometry(0.022, 0.04, 0.80, 8, 12)
  trunk.translate(0, 0.4, 0)
  const p = trunk.getAttribute('position')
  const barkColors = []
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    const band = Math.round(y * 15)
    const color = new THREE.Color('#88735a').multiplyScalar(0.78 + 0.26 * Math.sin(band * 2.12) ** 2)
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
    const x = Math.cos(a) * r + 0.05
    const z = Math.sin(a) * r
    const y = 0.77 + 0.17 * (i / 17) + rand() * 0.045
    const leaf = new THREE.Color(i < 4 ? '#82794b' : i % 3 === 0 ? '#87964b' : '#546a38')
    crown.leaf(0.05, 0.78, 0, a, r, y - 0.78, 0.028, 0.008, stem, 3)
    const count = low ? 9 : 12
    for (let j = 0; j < count; j++) {
      const fan = (j / (count - 1) - 0.5) * 2
      crown.leaf(x, y, z, a + fan * 1.45, 0.13 - 0.047 * Math.abs(fan),
        (i / 17 - 0.68) * 0.16, 0.036, 0.016, leaf, 3)
    }
  }
  return [trunk, crown.geometry()]
}

function pathDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1)
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

export async function plantHillside(plan: HomePlan, hill: Hillside, quality: QualitySettings) {
  const rand = rng(116 + plan.id.length * 34)
  const low = quality.tier === 'low'
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.88 })
  const meshes: THREE.InstancedMesh[] = []
  const grasses: Grass[] = []
  const footprint = siteFootprints(plan)
  const lowCameras = plan.views.filter(view => view.kind === 'orbit' && view.pos[1] < 5)
  const paths = (plan.landscape.paths ?? []).flatMap(({ pts, width }) =>
    pts.slice(1).map(([bx, bz], i) => ({ width, ax: pts[i][0], az: pts[i][1], bx, bz })))
  const occupied: { x: number; z: number; r: number }[] = []
  const protectedPoint = (x: number, z: number, pad: number) =>
    footprint.some(([x0, z0, x1, z1]) => x >= x0 - pad && x <= x1 + pad && z >= z0 - pad && z <= z1 + pad) ||
    (plan.landscape.clear ?? []).some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1) ||
    lowCameras.some(({ pos: [cx, , cz] }) => Math.hypot(x - cx, z - cz) < 1.36 + pad) ||
    paths.some(({ ax, az, bx, bz, width }) => pathDistance(x, z, ax, az, bx, bz) < width / 2 + pad)
  const beds = plan.landscape.berms ?? []
  const forms: Plant[][] = [[], [], [], [], []]
  const groundcover: Plant[] = []
  const [u0, v0, u1, v1] = hill.pad
  const add = (form: number, x: number, z: number, size: number, distant = false) => {
    const r = size * (form < 2 ? 0.57 : 0.30)
    const [, v] = hill.local(x, z)
    const edge = v - v1
    if ((edge > -0.35 && edge < 0.6) || (edge > 5.4 && edge < 6.1) ||
      protectedPoint(x, z, r + 0.18) ||
      occupied.some(p => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.88)) return
    occupied.push({ x, z, r })
    const y = hill.heightAt(x, z) - 0.035
    if (form === 5) {
      if (grasses.length < quality.ornamentalClumps) grasses.push([x, y, z, size])
    } else {
      forms[distant ? 4 : form].push({ x, y, z, size, yaw: rand() * Math.PI * 2 })
    }
  }

  for (const b of beds) {
    for (let i = 0; i < (low ? 70 : 102); i++) {
      const a = rand() * Math.PI * 2
      const radius = Math.sqrt(rand())
      const x = b.x + Math.cos(a) * b.rx * radius
      const z = b.z + Math.sin(a) * b.rz * radius
      const form = [0, 1, 2, 2, 3, 3, 5, 5][Math.floor(rand() * 8)]
      add(form, x, z, (0.40 + rand() * 0.92) * (form === 3 ? 0.87 : 1))
    }
  }
  // Irregular chaparral groups follow the retaining terraces and spill down the canyon.
  for (let i = 0; i < (low ? 240 : 340); i++) {
    const u = u0 - 5 + rand() * (u1 - u0 + 10)
    const near = i % 4
    const v = near === 0 ? v0 - rand() * 12 : v1 + (near === 1 ? -2.5 : near === 2 ? 1.1 : 6.8) + rand() * 2.9
    const [x, z] = hill.world(u, v)
    const form = [0, 1, 2, 3, 3, 5, 5, 5][Math.floor(rand() * 8)]
    add(form, x, z, 0.50 + rand() * 0.8)
  }
  for (let c = 0; c < (low ? 99 : 165); c++) {
    const u = (rand() - 0.5) * 155
    const v = c % 4 === 0
      ? v0 - 6 - rand() ** 2 * 93
      : v1 + 9 + rand() ** 1.85 * Math.min(112, (hill.oceanDistance ?? 150) - v1 - 20)
    for (let i = 0; i < 4; i++) {
      const [x, z] = hill.world(u + (rand() - 0.5) * 7, v + rand() * 5)
      add(2, x, z, 0.9 + rand() * 2.35, true)
    }
  }

  for (let i = 0; i < (low ? 570 : 1150); i++) {
    const b = i % 2 ? beds[i % beds.length] : undefined
    const a = rand() * Math.PI * 2
    const radius = Math.sqrt(rand())
    const u = u0 - 17 + rand() * (u1 - u0 + 34)
    const v = i % 3 === 0 ? v0 - rand() * 45 : v1 + (rand() - 0.07) * 66
    const [x, z] = b ? [b.x + Math.cos(a) * b.rx * radius, b.z + Math.sin(a) * b.rz * radius] : hill.world(u, v)
    const [, down] = hill.local(x, z)
    const run = down - v1
    if ((run > -0.26 && run < 0.5) || (run > 5.2 && run < 6.2) || protectedPoint(x, z, 0.23)) continue
    groundcover.push({ x, z, y: hill.heightAt(x, z) - 0.013, size: 0.42 + rand() * 0.94, yaw: a })
  }
  if (groundcover.length) meshes.push(instances(dryGroundcover(), material, groundcover, false, 'Dry hillside groundcover'))

  for (const [index, geometry, name] of [
    [0, rosette(false, low), 'Blue agave'],
    [1, rosette(true, low), 'Coastal aloe'],
    [2, scrub(false, low), 'Rosemary and sage'],
    [3, scrub(true, low), 'Lavender'],
    [4, scrub(false, true, true), 'Canyon chaparral'],
  ] as const) {
    if (forms[index].length) meshes.push(instances(geometry, material, forms[index], index !== 4, name))
    else geometry.dispose()
  }

  const trees = new Map<string, TreePlacement[]>()
  const palmPlants: Plant[] = []
  for (const tr of plan.landscape.trees ?? []) {
    if (protectedPoint(tr.x, tr.z, 0.65)) continue
    const size = tr.s ?? 1
    const y = hill.heightAt(tr.x, tr.z)
    const yaw = rand() * Math.PI * 2
    // An unqualified accent tree is a fan palm on coastal lots.
    if (!tr.kind) {
      palmPlants.push({ ...tr, y, size: size * 6.5, yaw })
      continue
    }
    const height = ({ pine: 8.7, 'pine-small': 4.8, aspen: 7.5, bush: 3.3 })[tr.kind] * size
    const items = trees.get(tr.kind) ?? []
    items.push({ ...tr, y, height, yaw })
    trees.set(tr.kind, items)
  }
  for (const [kind, items] of trees) {
    const pine = kind.startsWith('pine')
    const tree = makeVariant(pine ? 'Pine Medium' : 'Oak Medium', kind === 'bush' ? 811 : 74, quality.treeDetail, pine ? 'pine' : 'oak')
    for (const geo of [tree.branches, tree.leaves]) {
      if (pine) geo.scale(1.35, 0.82, 1.35)
      if (kind === 'bush') geo.scale(0.86, 0.86, 0.86)
      geo.computeVertexNormals()
    }
    for (const mesh of treeInstances(tree, items, true).children) {
      mesh.name = pine ? 'Stone pine' : kind === 'bush' ? 'Olive' : 'Coastal live oak'
      meshes.push(mesh as THREE.InstancedMesh)
    }
  }
  if (palmPlants.length) {
    const [trunk, crown] = palms(low)
    meshes.push(instances(trunk, material, palmPlants, true, 'Fan palm trunks'), instances(crown, material, palmPlants, true, 'Fan palm crowns'))
  }

  const rockPieces = (await Promise.all(['rock_09', 'rock_07'].map(id => modelPieces(id).catch(() => [])))).flat()
  const rockSpots: Plant[] = []
  for (let i = 0; i < (low ? 33 : 68); i++) {
    const b = beds[i % beds.length]
    const a = rand() * Math.PI * 2
    const [x, z] = b && i % 3 !== 0
      ? [b.x + Math.cos(a) * b.rx * 0.86, b.z + Math.sin(a) * b.rz * 0.83]
      : hill.world(u0 - 5 + rand() * (u1 - u0 + 10), v1 + 2 + rand() * 9.4)
    if (protectedPoint(x, z, 0.45)) continue
    rockSpots.push({ x, z, y: hill.heightAt(x, z) - 0.11, size: 0.41 + rand() ** 1.48 * 1.72, yaw: a })
  }
  rockPieces.forEach(({ geometry, material: rockMat }, i) => {
    const bb = geometry.boundingBox!
    const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
    geometry.scale(1 / width, 0.83 / width, 1 / width)
    const spots = rockSpots.filter((_, j) => j % rockPieces.length === i)
    if (spots.length) meshes.push(instances(geometry, rockMat, spots, true, 'Sandstone outcrops'))
    else geometry.dispose()
  })
  return { meshes, grasses, material }
}
