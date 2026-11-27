import * as THREE from 'three'
import type { HomePlan, Rect, Side, SiteSpec } from '../house/types'

const margin = 1.4
const cutWidth = 0.22
const terraceRun = 5.6
const { clamp, lerp, smoothstep } = THREE.MathUtils
const normals: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }

export function siteFootprints(plan: HomePlan): Rect[] {
  const stairs = plan.stairs.map(({ from: [x, z], dir, steps, width }): Rect => {
    const [dx, dz] = normals[dir]
    const run = steps * 0.3 + 0.1
    const ex = x + dx * run
    const ez = z + dz * run
    const w = width / 2
    return [Math.min(x, ex) - Math.abs(dz) * w, Math.min(z, ez) - Math.abs(dx) * w,
      Math.max(x, ex) + Math.abs(dz) * w, Math.max(z, ez) + Math.abs(dx) * w]
  })
  return [...plan.blocks, ...plan.decks, ...plan.porches, ...plan.terraces].map(p => p.rect)
    .concat(plan.landscape.driveway ?? [], stairs)
}

// The same shoreline drives the terrain profile, wet sand and surf.
export function shoreline(across: number, distance: number) {
  return distance + 9 * Math.sin(across * 0.025) + 8 * Math.sin(across * 0.009)
    + 133 * Math.exp(-((across + 270) ** 2) / 12000)
    + 245 * Math.exp(-((across - 450) ** 2) / 28000)
    + 410 * Math.exp(-((across - 1050) ** 2) / 180000)
}

export class Hillside {
  readonly cx: number
  readonly cz: number
  readonly dx: number
  readonly dz: number
  readonly grade: number
  readonly pad: Rect
  readonly seaLevel: number
  readonly oceanDistance?: number
  private readonly drivewayApproach: [number, number][]
  private beds: NonNullable<HomePlan['landscape']['berms']>
  private walkout?: { side: Side; edge: number; low: number; high: number; drop: number }

  constructor(plan: HomePlan, spec: SiteSpec, origin?: { cx: number; cz: number }) {
    this.beds = plan.landscape.berms ?? []
    const blocks = plan.blocks.map(b => b.rect)
    const x0 = Math.min(...blocks.map(b => b[0]))
    const z0 = Math.min(...blocks.map(b => b[1]))
    const x1 = Math.max(...blocks.map(b => b[2]))
    const z1 = Math.max(...blocks.map(b => b[3]))
    this.cx = origin?.cx ?? (x0 + x1) / 2
    this.cz = origin?.cz ?? (z0 + z1) / 2
    const angle = THREE.MathUtils.degToRad(spec.downhill)
    this.dx = Math.abs(Math.sin(angle)) < 1e-10 ? 0 : Math.sin(angle)
    this.dz = Math.abs(Math.cos(angle)) < 1e-10 ? 0 : Math.cos(angle)
    this.grade = Math.max(0, spec.grade ?? 0.14)
    const points = siteFootprints(plan).flatMap(([ax, az, bx, bz]) =>
      [[ax, az], [ax, bz], [bx, az], [bx, bz]].map(([x, z]) => this.local(x, z)))
    const drives = [...plan.terraces.filter(t => t.id === 'drive').map(t => t.rect), ...(plan.landscape.driveway ?? [])]
    this.drivewayApproach = this.dz < 0.9 ? [] : drives.map(([ax, , bx, bz]) =>
      [this.local(ax, bz)[0], this.local(bx, bz)[0]])
    this.pad = [
      Math.min(...points.map(p => p[0])) - margin, Math.min(...points.map(p => p[1])) - margin,
      Math.max(...points.map(p => p[0])) + margin, Math.max(...points.map(p => p[1])) + margin,
    ]
    // The developed lot needs room for both terraces even on a short coastal parcel.
    this.oceanDistance = spec.oceanDistance === undefined ? undefined : Math.max(this.pad[3] + 20, spec.oceanDistance)
    this.seaLevel = -(this.grade * ((this.oceanDistance ?? 0) - this.pad[3]) + 1.55 + (spec.walkout?.drop ?? 0))
    if (spec.walkout && spec.walkout.drop > 0) {
      const { side, drop } = spec.walkout
      const [nx, nz] = normals[side]
      const edge = Math.max(x0 * nx, x1 * nx) + Math.max(z0 * nz, z1 * nz)
      const faces = blocks.filter(b => Math.abs(Math.max(b[0] * nx, b[2] * nx) + Math.max(b[1] * nz, b[3] * nz) - edge) < 0.001)
      this.walkout = { side, edge, drop,
        low: Math.min(...faces.map(b => b[nx ? 1 : 0])),
        high: Math.max(...faces.map(b => b[nx ? 3 : 2])),
      }
    }
  }

  local(x: number, z: number): [number, number] {
    const rx = x - this.cx
    const rz = z - this.cz
    return [rx * this.dz - rz * this.dx, rx * this.dx + rz * this.dz]
  }

  world(u: number, v: number): [number, number] {
    return [this.cx + u * this.dz + v * this.dx, this.cz - u * this.dx + v * this.dz]
  }

  heightAt(x: number, z: number) {
    return this.profile(...this.local(x, z), x, z)
  }

  private profile(u: number, v: number, x: number, z: number) {
    const [u0, v0, u1, v1] = this.pad
    const run = v - v1
    const side = Math.max(u0 - u, u - u1, 0)
    const back = Math.max(v0 - v, 0)
    const edge = Math.max(side, back, run)
    const landBlend = smoothstep(edge, 0, 14)
    const outer = smoothstep(edge, 10, 75)
    const folds = Math.sin(u * 0.14 + v * 0.037) * 1.2 + Math.sin(u * 0.058 - v * 0.071) * 1.15
    const canyons = 4.2 * Math.sin(u * 0.026 + Math.sin(v * 0.022) * 1.25) + 3.4 * Math.cos(u * 0.051 - v * 0.015)
    const uphill = this.grade * back * (0.3 + smoothstep(back, 22, 85) * 0.96)
    const width = 1 - smoothstep(side, 0, 8)
    const upper = Math.max(run, 0)
    const ramp = this.drivewayApproach.reduce((open, [a, b]) =>
      Math.max(open, 1 - smoothstep(Math.max(a - u, u - b, 0), 0.26, 1.35)), 0)
    const cuts = this.grade * 5 * width * (1 - ramp) * (smoothstep(run, 0, cutWidth) + 0.85 * smoothstep(run, terraceRun, terraceRun + cutWidth))
    const fall = lerp(upper, Math.max(0, upper - 2) - 0.65 * clamp(upper - 2, 0, terraceRun - 2), width)
    const canyonSides = smoothstep(side, 0, 35)
    const undulation = folds * lerp(0.49, 1, canyonSides) + canyons * outer * lerp(0.31, 1, canyonSides)
    let h = uphill - this.grade * fall - cuts + landBlend * undulation
    // A broad shoulder rises beside the lot, leaving the middle of the view corridor open.
    h += smoothstep(side, 7, 70) * (4 + 18 * smoothstep(back, 10, 95)) * (1 - smoothstep(run, 15, 140))

    if (this.walkout) {
      const { side: wall, edge: face, low, high, drop } = this.walkout
      const [nx, nz] = normals[wall]
      const along = nx ? z : x
      const out = x * nx + z * nz - face
      const ends = Math.max(low - along, along - high, 0)
      // Keep the cut on the exposed side of the foundation and taper the returns.
      const exposure = smoothstep(out, -0.04, 0) * (1 - smoothstep(ends, 0.08, 2.8)) * (1 - smoothstep(out, 11, 27))
      h = lerp(h, Math.min(h, 0) - drop, exposure)
    }

    if (this.oceanDistance === undefined || run <= 0) return h
    const coast = shoreline(u, this.oceanDistance)
    const inland = coast - v
    const extension = Math.max(0, coast - this.oceanDistance)
    const headland = smoothstep(extension, 16, 100)
    const taper = smoothstep(v, this.oceanDistance * 0.48, this.oceanDistance + extension * 0.12)
    const coastalRidge = (this.grade * extension + 23 * headland) * taper
    const coastalProfile = this.seaLevel + clamp(inland * 0.145, -8, 4)
    const bluff = smoothstep(inland, 7, 32)
    const aboveBeach = Math.max(0, coastalProfile - h - coastalRidge) * (1 - smoothstep(inland, 32, 62))
    return lerp(h, lerp(coastalProfile, h + coastalRidge + aboveBeach, bluff), smoothstep(run, 0, 9))
  }

  private terrainColor(u: number, v: number, y: number, color: THREE.Color) {
    const d = Math.max(this.pad[0] - u, u - this.pad[2], this.pad[1] - v, v - this.pad[3])
    const patch = 0.49 + 0.19 * Math.sin(u * 0.19 + Math.sin(v * 0.07) * 2.6)
      + 0.16 * Math.cos(v * 0.34 + u * 0.09) + 0.11 * Math.cos(u * 0.61 - v * 0.43)
      + 0.12 * Math.sin(u * 0.063 + v * 0.048)
    color.copy(sandstone).lerp(scrub, smoothstep(patch, 0.15, 0.92))
    color.lerp(garden, (1 - smoothstep(d, -2, 13)) * 0.57)
    if (d < 15) {
      const [x, z] = this.world(u, v)
      let cover = 0
      for (const bed of this.beds) {
        const r = Math.hypot((x - bed.x) / bed.rx, (z - bed.z) / bed.rz)
        cover = Math.max(cover, 1 - smoothstep(r + 0.07 * Math.sin(x * 3.8 + z), 0.61, 1.17))
      }
      color.lerp(mulch, cover * 0.79)
    }
    if (this.oceanDistance !== undefined) {
      const inland = shoreline(u, this.oceanDistance) - v
      color.lerp(sand, 1 - smoothstep(inland, 8, 25))
      color.lerp(wetSand, (1 - smoothstep(y - this.seaLevel, 0.12, 0.78)) * (1 - smoothstep(inland, 4, 11)))
    }
  }

  buildSurface(ground: THREE.Material, concrete: THREE.Material, low: boolean) {
    const [u0, v0, u1, v1] = this.pad
    const uFeatures: number[] = []
    const vFeatures = [v1 + cutWidth, v1 + terraceRun, v1 + terraceRun + cutWidth]
    if (this.walkout) {
      const { side, edge, low: start, high: end } = this.walkout
      const [nx, nz] = normals[side]
      const point = (d: number, along: number) => this.local(nx ? (edge + d) * nx : along, nz ? (edge + d) * nz : along)
      const face = point(0, start)
      const inner = point(-0.04, start)
      const other = point(0, end)
      if (face[0] === inner[0]) {
        uFeatures.push(face[0], other[0])
        vFeatures.push(inner[1], face[1])
      } else if (face[1] === inner[1]) {
        uFeatures.push(inner[0], face[0])
        vFeatures.push(face[1], other[1])
      }
    }
    const across = axis(u0, u1, low, -1520, 1640, uFeatures)
    const down = axis(v0, v1, low, -1410, this.oceanDistance === undefined ? 720 : this.oceanDistance + 540,
      vFeatures, [[v1, v1 + cutWidth], [v1 + terraceRun, v1 + terraceRun + cutWidth]])
    const positions: number[] = []
    const colors: number[] = []
    const uv: number[] = []
    const triangles: number[] = []
    const wallPos: number[] = []
    const wallUv: number[] = []
    const wallIdx: number[] = []
    const color = new THREE.Color()
    for (const v of down) {
      for (const u of across) {
        const [x, z] = this.world(u, v)
        const y = this.profile(u, v, x, z)
        positions.push(x, y, z)
        this.terrainColor(u, v, y, color)
        colors.push(color.r, color.g, color.b)
        uv.push(x, z)
      }
    }

    const stride = across.length
    for (let r = 0; r < down.length - 1; r++) {
      const cut = down[r] === v1 || down[r] === v1 + terraceRun
      for (let c = 0; c < stride - 1; c++) {
        const a = r * stride + c
        const b = a + 1
        const d = a + stride
        const e = d + 1
        const ramp = cut && this.drivewayApproach.some(([lo, hi]) => across[c] >= lo - 0.26 && across[c + 1] <= hi + 0.26)
        if (cut && !ramp && across[c] >= u0 - 4 && across[c + 1] <= u1 + 4 && this.grade > 0) {
          const start = wallPos.length / 3
          for (const s of [a, d, e, b]) {
            const i = s * 3
            wallPos.push(positions[i], positions[i + 1], positions[i + 2])
            wallUv.push(across[s % stride], positions[i + 1])
          }
          wallIdx.push(start, start + 1, start + 2, start, start + 2, start + 3)
        } else {
          triangles.push(a, d, e, a, e, b)
        }
      }
    }
    const terrain = surface(positions, uv, triangles, ground, 'Coastal canyon')
    terrain.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const wall = surface(wallPos, wallUv, wallIdx, concrete, 'Board-formed terrace walls')
    wall.castShadow = true
    const group = new THREE.Group()
    group.add(terrain, wall)
    return group
  }
}

const sandstone = new THREE.Color('#918472')
const scrub = new THREE.Color('#626d50')
const garden = new THREE.Color('#9e8d79')
const mulch = new THREE.Color('#776b50')
const sand = new THREE.Color('#c9b28c')
const wetSand = new THREE.Color('#9f9980')

function axis(lo: number, hi: number, low: boolean, start: number, end: number, exact: number[], cuts: [number, number][] = []) {
  const values = [lo, hi, ...exact]
  for (let p = start; p < end;) {
    if (exact.every(q => Math.abs(p - q) > 0.35) && Math.abs(p - lo) > 0.35 && Math.abs(p - hi) > 0.35) values.push(p)
    const distance = Math.max(lo - p, p - hi, 0)
    p += distance < 12 ? (low ? 0.62 : 0.44) : distance < 40 ? 1.45 : distance < 110 ? 4 : distance < 540 ? 10 : 23
  }
  values.push(end)
  // Each narrow retaining face must occupy exactly one row.
  return [...new Set(values)].sort((a, b) => a - b).filter(p => cuts.every(([a, b]) => p <= a || p >= b))
}

export function surface(positions: number[], uv: number[], triangles: number[], material: THREE.Material, name: string) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(triangles)
  g.computeVertexNormals()
  const mesh = new THREE.Mesh(g, material)
  mesh.name = name
  mesh.receiveShadow = true
  return mesh
}
