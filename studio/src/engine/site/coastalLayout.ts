import { MathUtils } from 'three'
import type { HomePlan, Rect } from '../house/types'
import { rng } from '../materials/textures'
import type { Tier } from '../quality'
import { Hillside, scrubCover, shoreline, siteFootprints } from './hillside'

const { clamp, smoothstep } = MathUtils

export interface PlantSpot {
  x: number
  y: number
  z: number
  size: number
  yaw: number
  radius: number
}

export interface Neighbor {
  u: number
  v: number
  width: number
  depth: number
  height: number
  tone: number
  roof: number
  yaw: number
  street: number
}

export const coastalStreetWidth = 4.5

export function inRect(x: number, z: number, [x0, z0, x1, z1]: Rect, r = 0) {
  return x >= x0 - r && x <= x1 + r && z >= z0 - r && z <= z1 + r
}

function pathDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1)
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

export function coastalKeepout(plan: HomePlan) {
  const built = [...siteFootprints(plan), ...(plan.landscape.clear ?? [])]
  const paths = (plan.landscape.paths ?? []).flatMap(({ pts, width }) =>
    pts.slice(1).map(([bx, bz], i) => ({ width, ax: pts[i][0], az: pts[i][1], bx, bz })))
  const markers = [...(plan.landscape.planters ?? []), ...(plan.landscape.lounge ?? []), ...(plan.landscape.dining ?? [])]
  return (x: number, z: number, r = 0) =>
    built.some(rect => inRect(x, z, rect, r)) ||
    paths.some(({ ax, az, bx, bz, width }) => pathDistance(x, z, ax, az, bx, bz) < width * 0.72 + r) ||
    markers.some(p => Math.hypot(x - p.x, z - p.z) < 0.65 + r)
}

export function coastalLawn(plan: HomePlan, hill: Hillside): Rect | undefined {
  const [u0, , u1, v1] = hill.pad
  const blocked = coastalKeepout(plan)
  // Two metres of level bench between the existing board-formed walls.
  for (const f of [0.35, 0.67, 0.52, 0.18, 0.82]) {
    const u = MathUtils.lerp(u0, u1, f)
    const [x, z] = hill.world(u, v1 + 3.3)
    if (!blocked(x, z, 3.6)) return [u - 3.2, v1 + 2.0, u + 3.2, v1 + 4.6]
  }
  return undefined
}

export function coastalNeighbors(hill: Hillside): Neighbor[] {
  if (hill.oceanDistance === undefined) return []
  const rand = rng(962)
  const [u0, , u1, v1] = hill.pad
  const neighbors: Neighbor[] = []
  for (const side of [-1, 1]) {
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 6; column++) {
        const u = (side < 0 ? u0 : u1) + side * (19 + column * 16 + rand() * 3 + row * 3.6)
        const v = v1 + 22 + row * 25 + Math.sin(column * 0.53 + row * 0.4) * 10 + rand() * 4
        if (v > shoreline(u, hill.oceanDistance) - 31 || rand() < 0.13) continue
        neighbors.push({
          u, v, width: 7 + rand() * 5, depth: 6 + rand() * 3, height: 2.8 + rand() * 2.5,
          tone: Math.floor(rand() * 5), roof: Math.floor(rand() * 3),
          yaw: side * (0.08 + Math.sin(column * 0.48 + row * 0.5) * 0.16),
          street: side * (row + 1),
        })
      }
    }
  }
  return neighbors
}

export function coastalStreets(neighbors: Neighbor[]) {
  return [-3, -1, 1, 3].map(street => neighbors.filter(n => n.street === street)
    .sort((a, b) => a.u - b.u).map(({ u, v }): [number, number] => [u, v - 10.7]))
}

export function coastalPlantLayout(plan: HomePlan, hill: Hillside, tier: Tier, neighbors: Neighbor[]) {
  const seed = 481 + plan.id.length * 17
  const blocked = coastalKeepout(plan)
  const lawn = coastalLawn(plan, hill)
  const [u0, v0, u1, v1] = hill.pad
  const sea = hill.oceanDistance
  const streets = coastalStreets(neighbors).flatMap(street => street.slice(1)
    .map(([bx, bz], i) => [street[i][0], street[i][1], bx, bz] as const))
  const open = (x: number, z: number, r: number, garden = false) => {
    const [u, v] = hill.local(x, z)
    const wall = u > u0 - 4 - r && u < u1 + 4 + r
    return !(!garden && inRect(u, v, hill.pad, r) ||
      lawn && inRect(u, v, lawn, r) ||
      wall && [v1 + 0.11, v1 + 5.71].some(edge => Math.abs(v - edge) < r + 0.2) ||
      sea !== undefined && v > shoreline(u, sea) - 13 - r ||
      neighbors.some(n => Math.abs(n.u - u) < n.width * 0.5 + r + 2.2 && Math.abs(n.v - v) < n.depth * 0.5 + r + 2) ||
      streets.some(segment => pathDistance(u, v, ...segment) < coastalStreetWidth * 0.5 + r) ||
      blocked(x, z, r))
  }
  const spot = (x: number, z: number, size: number, radius: number, yaw: number): PlantSpot =>
    ({ x, z, size, radius, yaw, y: hill.heightAt(x, z) - 0.025 })

  const near: PlantSpot[] = [], far: PlantSpot[] = []
  const [nearBudget, farBudget] = { low: [690, 2220], medium: [900, 2980], high: [1110, 3610] }[tier]
  // Sample the two bands independently to preserve the silhouettes and colour balance on phone.
  for (const [list, budget, range, isFar] of [[near, nearBudget, 88, false], [far, farBudget, 242, true]] as const) {
    const rand = rng(seed + (isFar ? 101 : 0))
    for (let i = 0; i < budget * 6 && list.length < budget; i++) {
      const u = (rand() * 2 - 1) * range
      const v = v0 - range * 0.52 + rand() * (range * 1.65 + v1 - v0)
      const distance = Math.hypot(Math.max(u0 - u, u - u1, 0), Math.max(v0 - v, v - v1, 0))
      if ((distance >= 54) !== isFar || (isFar && distance < 73 && rand() < 0.24)) continue
      const cover = scrubCover(u, v)
      if (rand() > smoothstep(cover, 0.30, 0.78)) continue
      const size = (isFar ? 1.4 : 0.68) + rand() ** 1.25 * (isFar ? 3.1 : 1.9)
      const radius = size * 0.93
      const [x, z] = hill.world(u, v)
      if (open(x, z, radius)) list.push(spot(x, z, size, radius, rand() * Math.PI * 2))
    }
  }

  const dryGrass: PlantSpot[] = []
  const grassRandom = rng(seed + 171)
  const grassBudget = { low: 820, medium: 1160, high: 1600 }[tier]
  for (let i = 0; i < grassBudget * 4 && dryGrass.length < grassBudget; i++) {
    const u = u0 - 24 + grassRandom() * (u1 - u0 + 48)
    const v = v0 - 24 + grassRandom() * (v1 - v0 + 69)
    const cover = scrubCover(u, v)
    if (grassRandom() < cover * 0.72) continue
    const [x, z] = hill.world(u, v)
    const size = 0.55 + grassRandom() * 0.68
    const radius = size * 0.62
    if (open(x, z, radius)) dryGrass.push(spot(x, z, size, radius, grassRandom() * Math.PI * 2))
  }

  const rand = rng(seed + 193)
  const hedges: PlantSpot[] = []
  for (const u of [u0 - 2.35, u1 + 2.35]) {
    for (let v = v0 + 2; v < v1 - 4; v += 0.97) {
      const [x, z] = hill.world(u, v)
      if (open(x, z, 0.95)) hedges.push(spot(x, z, 1.25 + rand() * 0.15, 0.95, rand() * Math.PI * 2))
    }
  }
  const low = tier === 'low'
  const forms: PlantSpot[][] = [[], [], [], [], [], [], [], [], []]
  const occupied: PlantSpot[] = []
  const addGarden = (form: number, x: number, z: number, size: number, radius = size * 0.83) => {
    if (!open(x, z, radius, true) || occupied.some(p => Math.hypot(p.x - x, p.z - z) < (p.radius + radius) * 0.85)) return
    const item = spot(x, z, size, radius, rand() * Math.PI * 2)
    forms[form].push(item)
    occupied.push(item)
  }
  const beds = plan.landscape.berms ?? []
  for (const bed of beds) {
    const c = Math.cos(bed.rot ?? 0)
    const s = Math.sin(bed.rot ?? 0)
    for (let i = 0; i < (low ? 70 : 105); i++) {
      const a = rand() * Math.PI * 2
      const radius = Math.sqrt(rand()) * 0.93
      const form = [0, 1, 2, 3, 3, 4, 6, 7, 7, 8][i % 10]
      const dx = Math.cos(a) * bed.rx * radius
      const dz = Math.sin(a) * bed.rz * radius
      const x = bed.x + dx * c - dz * s
      const z = bed.z + dx * s + dz * c
      addGarden(form, x, z, 0.50 + rand() * 0.73)
    }
  }
  for (let i = 0; i < (low ? 290 : 430); i++) {
    const u = u0 - 4 + rand() * (u1 - u0 + 8)
    const v = i % 5 === 0 ? v0 - (0.4 + rand() * 6) : v1 + (i % 2 === 0 ? 1.1 + rand() * 4.0 : 6.8 + rand() * 4.4)
    const form = [0, 1, 2, 3, 4, 6, 7, 8][i % 8]
    const [x, z] = hill.world(u, v)
    addGarden(form, x, z, 0.46 + rand() * 0.70)
  }
  for (const u of [u0 + 2.5, u1 - 2.5]) {
    for (let i = 0; i < 5; i++) {
      const [x, z] = hill.world(u + i * 0.85 - 1.7, v1 + 1.1)
      addGarden(5, x, z, 0.95, 0.72)
    }
  }
  return { near, far, hedges, dryGrass, garden: forms, lawn, open, spot }
}
