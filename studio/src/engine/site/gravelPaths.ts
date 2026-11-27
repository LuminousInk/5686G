import * as THREE from 'three'
import type { LandscapeSpec } from '../house/types'
import { scanMaterial, type CoastalMaps } from './groundMaterials'
import { surface, type Hillside } from './hillside'

export function buildGravelPaths(paths: NonNullable<LandscapeSpec['paths']>, hill: Hillside, maps: CoastalMaps) {
  const material = scanMaterial(maps.gravel, new THREE.Color().setRGB(1.65, 1.93, 2.26), 0.58)
  material.vertexColors = true
  const positions: number[] = []
  const colors: number[] = []
  const uv: number[] = []
  const triangles: number[] = []
  for (const path of paths) {
    const points = path.pts.map(([x, z]) => new THREE.Vector2(x, z))
      .filter((p, i, all) => !i || p.distanceToSquared(all[i - 1]) > 0.0001)
    const offsets = points.map((p, i) => {
      const incoming = p.clone().sub(points[Math.max(i - 1, 0)]).normalize()
      const outgoing = points[Math.min(i + 1, points.length - 1)].clone().sub(p).normalize()
      const tangent = incoming.add(outgoing).normalize()
      return new THREE.Vector2(-tangent.y, tangent.x)
        .multiplyScalar(path.width * 0.5 / Math.max(0.7, tangent.dot(outgoing)))
    })
    let previous: number | undefined
    for (let i = 1; i < points.length; i++) {
      const steps = Math.ceil(points[i - 1].distanceTo(points[i]) * 6)
      for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
        const t = j / steps
        const center = points[i - 1].clone().lerp(points[i], t)
        const width = offsets[i - 1].clone().lerp(offsets[i], t)
        const row = positions.length / 3
        for (const side of [-1, -0.83, 0.83, 1]) {
          const [x, z] = center.clone().addScaledVector(width, side)
          const edge = Math.abs(side) > 0.9
          // The thin compacted course is raised at the center and feathered into the surrounding soil.
          positions.push(x, hill.surfaceHeight(...hill.local(x, z)) + (edge ? 0.012 : 0.036), z)
          uv.push(x * 2.8, z * 2.8)
          const tone = edge ? 0.66 : 0.89 + 0.08 * Math.cos(x * 1.9 + z * 0.42)
          colors.push(tone, tone, tone)
        }
        if (previous !== undefined) {
          for (let k = 0; k < 3; k++) {
            const a = previous + k
            const b = row + k
            triangles.push(a, a + 1, b + 1, a, b + 1, b)
          }
        }
        previous = row
      }
    }
  }
  const mesh = surface(positions, uv, triangles, material, 'Decomposed granite paths')
  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return mesh
}

/** Short sandstone treads on the steep parts of a garden path. Level stretches keep their DG surface. */
export function buildGardenSteps(paths: NonNullable<LandscapeSpec['paths']>, hill: Hillside, maps: CoastalMaps) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  const tread = 0.60
  for (const { pts, width } of paths) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i]
      const length = Math.hypot(bx - ax, bz - az)
      if (length < 2 * tread) continue
      const dx = (bx - ax) / length, dz = (bz - az) / length
      for (let d = tread; d < length - 0.3; d += tread) {
        const x = ax + d * dx, z = az + d * dz
        const edges = [-0.48, 0.48].map(side => {
          const qx = x + dx * tread * side, qz = z + dz * tread * side
          return hill.surfaceHeight(...hill.local(qx, qz))
        })
        if (Math.abs(edges[0] - edges[1]) < 0.105) continue
        const top = Math.max(...edges) + 0.075
        const base = positions.length / 3
        const half = width * 0.44
        for (const [along, across] of [[-0.4, -half], [0.4, -half], [0.4, half], [-0.4, half]]) {
          const qx = x + dx * along * tread - dz * across, qz = z + dz * along * tread + dx * across
          positions.push(qx, top, qz)
          uv.push(qx * 0.92, qz * 0.92)
        }
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
        for (let j = 0; j < 4; j++) {
          const a = (base + j) * 3, b = (base + (j + 1) % 4) * 3
          const k = positions.length / 3
          const y = Math.min(...edges) - 0.04
          positions.push(positions[a], y, positions[a + 2], positions[b], y, positions[b + 2],
            positions[b], top, positions[b + 2], positions[a], top, positions[a + 2])
          const u = Math.hypot(positions[a] - positions[b], positions[a + 2] - positions[b + 2])
          uv.push(d, y, d + u, y, d + u, top, d, top)
          indices.push(k, k + 2, k + 1, k, k + 3, k + 2)
        }
      }
    }
  }
  if (!indices.length) return null
  const material = scanMaterial(maps.rock, new THREE.Color().setRGB(1.75, 1.58, 1.52), 0.46)
  const mesh = surface(positions, uv, indices, material, 'Sandstone garden treads')
  mesh.castShadow = true
  return mesh
}
