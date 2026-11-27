import * as THREE from 'three'
import { coastalStreets, coastalStreetWidth, type Neighbor } from './coastalLayout'
import { type Hillside, surface } from './hillside'
import { coastalHaze, type CoastalSky } from './ocean'

const roofColors = ['#756863', '#8c5944', '#505858', '#8f7460', '#5f5555']
const houseColors = ['#c4b7a9', '#b9aa9e', '#c8b99f', '#b3a393', '#c7c5b7']

export function buildCoastalStreets(hill: Hillside, neighbors: Neighbor[], sky: CoastalSky) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  for (const street of coastalStreets(neighbors)) {
    for (let i = 1; i < street.length; i++) {
      const [u0, v0] = street[i - 1]
      const [u1, v1] = street[i]
      const steps = Math.ceil((u1 - u0) * 1.45)
      for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
        const u = THREE.MathUtils.lerp(u0, u1, j / steps)
        const v = THREE.MathUtils.lerp(v0, v1, j / steps)
        const start = positions.length / 3
        for (const edge of [-1, 0, 1]) {
          const acrossStreet = v + edge * coastalStreetWidth * 0.5
          const [x, z] = hill.world(u, acrossStreet)
          positions.push(x, hill.surfaceHeight(u, acrossStreet) + 0.095, z)
          uv.push(x, z)
        }
        if (i > 1 || j > 0) {
          indices.push(start - 3, start - 2, start, start - 2, start + 1, start,
            start - 2, start - 1, start + 1, start - 1, start + 2, start + 1)
        }
      }
    }
  }
  const material = coastalHaze(new THREE.MeshStandardMaterial({ color: '#716f66', roughness: 0.96 }), sky, 'coastal-streets')
  return surface(positions, uv, indices, material, 'Hillside residential streets')
}

function hipRoof() {
  const points = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
    -0.27, 1, 0, 0.27, 1, 0,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  geometry.setIndex([0, 4, 5, 0, 5, 1, 1, 5, 2, 2, 5, 4, 2, 4, 3, 3, 4, 0])
  const flat = geometry.toNonIndexed()
  geometry.dispose()
  flat.computeVertexNormals()
  return flat
}

/** Low-poly stucco houses and terraced lots on both shoulders of the view corridor. */
export function buildCoastalLots(hill: Hillside, neighbors: Neighbor[], sky: CoastalSky) {
  const material = coastalHaze(new THREE.MeshStandardMaterial({ roughness: 0.94 }), sky, 'coastal-lots')
  const count = neighbors.length
  const lots = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, count)
  const houses = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, count)
  const roofs = new THREE.InstancedMesh(hipRoof(), material, count)
  const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(), material, count * 5)
  const orientation = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const bearing = Math.atan2(hill.dx, hill.dz)
  const matrix = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const color = new THREE.Color()
  const place = (mesh: THREE.InstancedMesh, index: number, u: number, v: number, y: number,
    w: number, h: number, d: number, tint: string) => {
    const [x, z] = hill.world(u, v)
    mesh.setMatrixAt(index, matrix.compose(pos.set(x, y, z), orientation, scale.set(w, h, d)))
    mesh.setColorAt(index, color.set(tint))
  }
  neighbors.forEach((n, i) => {
    const { u, v, width, depth, height } = n
    const grade = [-1, 1].flatMap(side => [-1, 1].map(end =>
      hill.heightAt(...hill.world(u + side * (width * 0.5 + 1.25), v + end * (depth * 0.5 + 1.7)))))
    const floor = Math.max(...grade) + 0.16
    const base = Math.min(...grade) - 0.75
    orientation.setFromAxisAngle(up, bearing)
    place(lots, i, u, v, (floor + base) * 0.5, width + 3.1, floor - base, depth + 3.6, '#9b927d')
    orientation.setFromAxisAngle(up, bearing + n.yaw)
    place(houses, i, u, v, floor + height * 0.5, width, height, depth, houseColors[n.tone])
    place(roofs, i, u, v, floor + height - 0.04, width + 0.73, [0.26, 1.23, 1.75][n.roof], depth + 0.67, roofColors[n.tone])
    const windowAt = (slot: number, x: number, z: number, w: number, h: number, d: number) => {
      const c = Math.cos(n.yaw), s = Math.sin(n.yaw)
      place(glass, i * 5 + slot, u + c * x + s * z, v - s * x + c * z,
        floor + height * 0.58, w, h, d, '#485253')
    }
    windowAt(0, -width * 0.23, depth * 0.5, width * 0.32, height * 0.37, 0.09)
    windowAt(1, width * 0.23, depth * 0.5, width * 0.27, height * 0.37, 0.09)
    windowAt(2, -width * 0.5, 0, 0.09, height * 0.35, depth * 0.47)
    windowAt(3, width * 0.5, -depth * 0.11, 0.09, height * 0.28, depth * 0.32)
    windowAt(4, width * 0.15, -depth * 0.5, width * 0.31, height * 0.37, 0.09)
  })
  const meshes = [lots, houses, roofs, glass]
  for (const [index, mesh] of meshes.entries()) {
    mesh.name = ['Neighbor terraces', 'Stucco hillside houses', 'Neighborhood rooftops', 'Neighbor windows'][index]
    mesh.computeBoundingSphere()
  }
  return { meshes, material }
}
