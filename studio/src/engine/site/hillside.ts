import * as THREE from 'three'
import { framePoint, levelFloor, levelId } from '../house/levels'
import type { HomePlan, Rect, Side, SiteSpec } from '../house/types'

const margin = 1.4
const cutWidth = 0.22
const terraceRun = 5.6
const foundationCut = 0.04
const { clamp, lerp, smoothstep } = THREE.MathUtils
const normals: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }

function corners([x0, z0, x1, z1]: Rect): [number, number][] {
  return [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]
}

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
  const framed = [...plan.porches, ...plan.terraces].map(p => ({ rect: p.rect, frame: plan.blocks.find(b => b.id === p.frame) }))
  const footprints = [...plan.blocks.map(b => ({ rect: b.rect, frame: b })), ...framed].map(({ rect, frame }): Rect => {
    if (!frame?.yaw) return rect
    const points = corners(rect).map(([x, z]) => framePoint(frame, x, z))
    const xs = points.map(p => p[0])
    const zs = points.map(p => p[1])
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
  })
  return footprints.concat(plan.decks.map(d => d.rect), plan.landscape.driveway ?? [], stairs)
}

interface WalkoutCut {
  edge: number
  back: number
  low: number
  high: number
}

// The same shoreline drives the terrain profile, wet sand and surf.
export function shoreline(across: number, distance: number) {
  return distance + 9 * Math.sin(across * 0.025) + 8 * Math.sin(across * 0.009)
    + 133 * Math.exp(-((across + 270) ** 2) / 12000)
    + 245 * Math.exp(-((across - 450) ** 2) / 28000)
    + 410 * Math.exp(-((across - 1050) ** 2) / 180000)
}

/** Broad stands of sage and chaparral share the same pattern in the ground and the planting. */
export function scrubCover(u: number, v: number) {
  const broad = Math.sin(u * 0.102 + 1.4 * Math.sin(v * 0.044)) * Math.cos(v * 0.072 - u * 0.031)
  const pockets = Math.sin(u * 0.32 + v * 0.19) * Math.cos(v * 0.29 - u * 0.12)
  const stands = Math.sin(u * 0.048 + v * 0.028) * Math.sin(v * 0.054 - u * 0.019 + 1.2)
  return clamp(0.56 + 0.22 * broad + 0.13 * pockets + 0.19 * stands + 0.25 * canyonMoisture(u, v), 0, 1)
}

export function canyonMoisture(u: number, v: number) {
  const channel = u + 68 - Math.sin(v * 0.021) * 29
  const tributary = u - 88 + Math.sin(v * 0.014 + 0.6) * 31
  return Math.max(Math.exp(-1 * (channel / 27) ** 2), Math.exp(-1 * (tributary / 22) ** 2))
}

/** The narrow washes follow the broader canyon floors and collect smaller side channels. */
export function drainage(u: number, v: number) {
  const sinuous = v * 0.034
  const west = u + 68 - Math.sin(v * 0.021) * 29 - Math.sin(sinuous * 1.9) * 3.1
  const east = u - 88 + Math.sin(v * 0.014 + 0.6) * 31 - Math.sin(sinuous + 1.6) * 4.2
  const branch = west - Math.max(0, 23 + 0.33 * (v + 25)) - 5 * Math.sin(sinuous)
  const channel = Math.max(Math.exp(-((west / 4.1) ** 2)), Math.exp(-((east / 5.3) ** 2)))
  const tributary = Math.exp(-((branch / 3.2) ** 2)) * (1 - smoothstep(Math.abs(v + 32), 32, 95))
  return Math.max(channel, tributary * 0.73)
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
  private readonly beds: NonNullable<HomePlan['landscape']['berms']>
  private walkout?: { side: Side; drop: number; cuts: WalkoutCut[] }
  private grid?: { across: number[]; down: number[] }

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
    const points = siteFootprints(plan).flatMap(rect => corners(rect).map(([x, z]) => this.local(x, z)))
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
      const face = (b: Rect) => Math.max(b[0] * nx, b[2] * nx) + Math.max(b[1] * nz, b[3] * nz)
      const lower = plan.blocks.filter(b => levelFloor(plan, levelId(plan, b.level)) < 0 && !b.yaw)
      const cuts = lower.length ? lower.map(({ rect: b }) => ({
        edge: face(b), back: Math.min(b[0] * nx, b[2] * nx) + Math.min(b[1] * nz, b[3] * nz),
        low: b[nx ? 1 : 0], high: b[nx ? 3 : 2],
      })) : blocks.filter(b => Math.abs(face(b) - edge) < 0.001).map(b => ({
        edge, back: edge, low: b[nx ? 1 : 0], high: b[nx ? 3 : 2],
      }))
      this.walkout = { side, drop, cuts }
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

  /** Height of the rendered triangles for thin surfaces that follow the relief. */
  surfaceHeight(u: number, v: number) {
    if (!this.grid) return this.heightAt(...this.world(u, v))
    const { across, down } = this.grid
    const i = upperBound(across, u)
    const j = upperBound(down, v)
    if (i < 1 || j < 1 || i === across.length || j === down.length) return this.heightAt(...this.world(u, v))
    const a = across[i - 1], b = across[i], c = down[j - 1], d = down[j]
    const f = (u - a) / (b - a), g = (v - c) / (d - c)
    const origin = this.heightAt(...this.world(a, c))
    const end = this.heightAt(...this.world(b, d))
    if (f >= g) return origin * (1 - f) + end * g + this.heightAt(...this.world(b, c)) * (f - g)
    return origin * (1 - g) + end * f + this.heightAt(...this.world(a, d)) * (g - f)
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
    const canyons = 5.7 * Math.sin(u * 0.026 + Math.sin(v * 0.022) * 1.25) + 4.6 * Math.cos(u * 0.051 - v * 0.015)
    const uphill = this.grade * back * (0.3 + smoothstep(back, 22, 85) * 0.96)
    const width = 1 - smoothstep(side, 0, 8)
    const upper = Math.max(run, 0)
    const ramp = this.drivewayApproach.reduce((open, [a, b]) =>
      Math.max(open, 1 - smoothstep(Math.max(a - u, u - b, 0), 0.26, 1.35)), 0)
    const retainingDrops = this.grade * 5 * width * (1 - ramp) * (smoothstep(run, 0, cutWidth) + 0.85 * smoothstep(run, terraceRun, terraceRun + cutWidth))
    const fall = lerp(upper, Math.max(0, upper - 2) - 0.65 * clamp(upper - 2, 0, terraceRun - 2), width)
    const canyonSides = smoothstep(side, 0, 35)
    const undulation = folds * lerp(0.49, 1, canyonSides) + canyons * outer * lerp(0.31, 1, canyonSides)
    let h = uphill - this.grade * fall - retainingDrops + landBlend * undulation
    // Drainages cut through the side slopes, with wooded shoulders above their floors.
    h -= 8.8 * canyonMoisture(u, v) * outer
    const ravine = drainage(u, v)
    const ridges = Math.sin(u * 0.29 + 0.79 * Math.sin(v * 0.15)) * Math.cos(v * 0.22 - u * 0.08)
    h += smoothstep(edge, 11, 36) * (ridges * 0.58 - ravine * (1.2 + outer * 1.6))
    // A broad shoulder rises beside the lot, leaving the middle of the view corridor open.
    h += smoothstep(side, 7, 70) * (4 + 18 * smoothstep(back, 10, 95)) * (1 - smoothstep(run, 15, 140))

    if (this.oceanDistance !== undefined && run > 0) {
      const coast = shoreline(u, this.oceanDistance)
      const inland = coast - v
      const extension = Math.max(0, coast - this.oceanDistance)
      const headland = smoothstep(extension, 16, 100)
      const taper = smoothstep(v, this.oceanDistance * 0.48, this.oceanDistance + extension * 0.12)
      const coastalRidge = (this.grade * extension + 23 * headland) * taper
      const coastalProfile = this.seaLevel + clamp(inland * 0.145, -8, 4)
      const bluff = smoothstep(inland, 7, 32)
      const aboveBeach = Math.max(0, coastalProfile - h - coastalRidge) * (1 - smoothstep(inland, 32, 62))
      h = lerp(h, lerp(coastalProfile, h + coastalRidge + aboveBeach, bluff), smoothstep(run, 0, 9))
    }

    if (!this.walkout) return h
    const { side: wall, drop, cuts } = this.walkout
    const [nx, nz] = normals[wall]
    const along = nx ? z : x
    const outward = x * nx + z * nz
    let excavation = 0
    for (const { edge, back, low, high } of cuts) {
      const out = outward - edge
      const ends = Math.max(low - along, along - high, 0)
      // The walls retain grade around the buried sides. The banks flare out beyond the walkout.
      const returnWidth = lerp(foundationCut, 2.8, smoothstep(out, 0, 2))
      const exposure = smoothstep(outward, back - foundationCut, back) *
        (1 - smoothstep(ends, 0, returnWidth)) * (1 - smoothstep(out, 11, 27))
      excavation = Math.max(excavation, exposure)
    }
    h = lerp(h, -drop, excavation)
    if (edge > 0) {
      // Raised beds are low earth benches with a flatter crown and a soft outer batter.
      for (const bed of this.beds) {
        if (bed.h <= 0) continue
        const dx = x - bed.x, dz = z - bed.z
        const angle = bed.rot ?? 0
        const r = Math.hypot((dx * Math.cos(angle) + dz * Math.sin(angle)) / bed.rx,
          (dz * Math.cos(angle) - dx * Math.sin(angle)) / bed.rz)
        h += bed.h * (1 - smoothstep(r, 0.62, 1.05)) * smoothstep(edge, 0, 2)
      }
    }
    return h
  }

  private terrainColor(u: number, v: number, y: number, color: THREE.Color) {
    const d = Math.max(this.pad[0] - u, u - this.pad[2], this.pad[1] - v, v - this.pad[3])
    const patch = scrubCover(u, v)
    const moisture = canyonMoisture(u, v)
    color.copy(dryGrass).lerp(scrub, smoothstep(patch, 0.24, 0.69))
    color.lerp(canyonGreen, moisture * smoothstep(d, 6, 35) * 0.75)
    color.lerp(garden, (1 - smoothstep(d, 0, 9)) * 0.43)
    let cover = 0
    if (d < 32) {
      const [x, z] = this.world(u, v)
      for (const bed of this.beds) {
        const angle = bed.rot ?? 0
        const dx = x - bed.x
        const dz = z - bed.z
        const r = Math.hypot((dx * Math.cos(angle) + dz * Math.sin(angle)) / bed.rx,
          (dz * Math.cos(angle) - dx * Math.sin(angle)) / bed.rz)
        cover = Math.max(cover, 1 - smoothstep(r + 0.045 * Math.sin(x * 3.8 + z), 0.82, 1.10))
      }
      const side = Math.min(Math.abs(u - this.pad[0] + 2.35), Math.abs(u - this.pad[2] - 2.35))
      const borders = smoothstep(v, this.pad[1], this.pad[1] + 3) *
        (1 - smoothstep(v, this.pad[3] - 6, this.pad[3] - 3))
      cover = Math.max(cover, (1 - smoothstep(side, 0.68, 1.18)) * borders)
      color.lerp(mulch, cover)
    }
    let beach = 0
    if (this.oceanDistance !== undefined) {
      const inland = shoreline(u, this.oceanDistance) - v
      beach = 1 - smoothstep(inland, 7, 16)
      color.lerp(sand, beach)
      color.lerp(wetSand, (1 - smoothstep(y - this.seaLevel, 0.12, 0.78)) * (1 - smoothstep(inland, 4, 11)))
    }
    return [cover, beach, patch, drainage(u, v) * smoothstep(d, 8, 36)]
  }

  buildSurface(ground: THREE.Material, concrete: THREE.Material, low: boolean) {
    const [u0, v0, u1, v1] = this.pad
    const uFeatures: number[] = []
    const vFeatures = [v1 + cutWidth, v1 + terraceRun, v1 + terraceRun + cutWidth]
    if (this.walkout) {
      const { side, cuts } = this.walkout
      const [nx, nz] = normals[side]
      // Pin grid lines to the foundation so triangles do not cross into the lower rooms.
      if (this.dx === 0 || this.dz === 0) {
        const point = (d: number, along: number) => this.local(nx ? d * nx : along, nz ? d * nz : along)
        for (const { back, edge, low, high } of cuts) {
          for (const d of [back - foundationCut, back, edge, edge + 2, edge + 11, edge + 27]) {
            for (const along of [low - foundationCut, low, high, high + foundationCut]) {
              const [u, v] = point(d, along)
              uFeatures.push(u)
              vFeatures.push(v)
            }
          }
        }
      }
    }
    const across = axis(u0, u1, low, -1520, 1640, uFeatures)
    const down = axis(v0, v1, low, -1410, this.oceanDistance === undefined ? 720 : this.oceanDistance + 540,
      vFeatures, [[v1, v1 + cutWidth], [v1 + terraceRun, v1 + terraceRun + cutWidth]])
    this.grid = { across, down }
    const positions: number[] = []
    const colors: number[] = []
    const cover: number[] = []
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
        cover.push(...this.terrainColor(u, v, y, color))
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
    const curvature = new Float32Array(across.length * down.length)
    for (let r = 1; r < down.length - 1; r++) {
      for (let c = 1; c < stride - 1; c++) {
        const edge = Math.max(u0 - across[c], across[c] - u1, v0 - down[r], down[r] - v1)
        if (edge < 7) continue
        const i = r * stride + c
        const y = positions[i * 3 + 1]
        const a = elevationCurve(positions[(i - 1) * 3 + 1], y, positions[(i + 1) * 3 + 1],
          across[c] - across[c - 1], across[c + 1] - across[c])
        const b = elevationCurve(positions[(i - stride) * 3 + 1], y, positions[(i + stride) * 3 + 1],
          down[r] - down[r - 1], down[r + 1] - down[r])
        curvature[i] = clamp((a + b) * 2.1, -1, 1) * smoothstep(edge, 7, 22)
      }
    }
    const terrain = surface(positions, uv, triangles, ground, 'Coastal canyon')
    terrain.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    terrain.geometry.setAttribute('groundCover', new THREE.Float32BufferAttribute(cover, 4))
    terrain.geometry.setAttribute('curvature', new THREE.BufferAttribute(curvature, 1))
    const wall = surface(wallPos, wallUv, wallIdx, concrete, 'Board-formed terrace walls')
    wall.castShadow = true
    const group = new THREE.Group()
    group.add(terrain, wall)
    return group
  }
}

const dryGrass = new THREE.Color('#88744d')
const scrub = new THREE.Color('#3e5136')
const canyonGreen = new THREE.Color('#243a29')
const garden = new THREE.Color('#635b42')
const mulch = new THREE.Color('#544032')
const sand = new THREE.Color('#c9b28c')
const wetSand = new THREE.Color('#9f9980')

function elevationCurve(left: number, center: number, right: number, leftRun: number, rightRun: number) {
  return ((right - center) / rightRun - (center - left) / leftRun) * 2 / (leftRun + rightRun)
}

function upperBound(values: number[], value: number) {
  let lo = 0, hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}

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
