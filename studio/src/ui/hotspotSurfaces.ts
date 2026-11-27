import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { Engine } from '../engine/Engine'

export const MAX_HOTSPOTS = 6

interface Surface {
  mesh: THREE.Mesh
  bounds: THREE.Box3
}

export interface HotspotAnchor {
  key: string
  zone: string
  point: THREE.Vector3
  x: number
  y: number
  opacity: number
}

const trees = new WeakMap<THREE.BufferGeometry, MeshBVH>()

export function finishSurface(material: string): { key: string; zone: string } | undefined {
  if (material === 'cabinet') return { key: 'cabinet', zone: 'palette' }
  if (material === 'floor') return { key: 'floor', zone: 'palette' }
  if (material.startsWith('zone:')) {
    const zone = material.slice(5)
    return { key: zone, zone }
  }
}

export function hotspotArea(x: number, y: number, width: number, height: number) {
  if (width < 600) {
    // Keep the minimap, vertical tools, dock and central part of the composition clear.
    return x > 25 && x < width - 64 && y > 91 && y < height - 118 &&
      !(x < 151 && y < 174) &&
      (Math.abs(x - width / 2) > width * 0.17 || Math.abs(y - height / 2) > height * 0.16)
  }
  return x > 26 && x < width - 26 && y > 85 && y < height - 117 &&
    !(x > width - 198 && y < 206)
}

export class HotspotSurfaces {
  private readonly surfaces: Surface[] = []
  private readonly ray = Object.assign(new THREE.Raycaster(), { firstHitOnly: true })
  private readonly hits: THREE.Intersection[] = []
  private readonly ndc = new THREE.Vector2()
  private readonly boundsHit = new THREE.Vector3()
  private previous: HotspotAnchor[] = []

  constructor(engine: Engine) {
    for (const group of [engine.house?.group, engine.interior?.group, engine.site?.group]) {
      group?.traverseVisible(object => {
        const mesh = object as THREE.InstancedMesh
        if (!mesh.isMesh || Array.isArray(mesh.material) || !mesh.material.visible ||
            mesh.userData.shadowOnly || !mesh.material.colorWrite || mesh.material.transparent ||
            mesh.geometry instanceof THREE.InstancedBufferGeometry) return
        const geometry = mesh.geometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (!geometry.boundingBox) return
        if (mesh.isInstancedMesh) {
          // Per-instance bounds keep foliage and small outdoor props out of unrelated rays.
          const matrix = new THREE.Matrix4()
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix)
            matrix.premultiply(mesh.matrixWorld)
            const instance = new THREE.Mesh(geometry, mesh.material)
            instance.matrixWorld.copy(matrix)
            this.surfaces.push({ mesh: instance, bounds: geometry.boundingBox.clone().applyMatrix4(matrix) })
          }
        } else this.surfaces.push({ mesh, bounds: geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld) })
      })
    }
  }

  private visibleSurface(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number) {
    this.ndc.set(x / width * 2 - 1, 1 - y / height * 2)
    this.ray.setFromCamera(this.ndc, camera)
    this.ray.far = 88
    let hit: THREE.Intersection | undefined
    for (const { mesh, bounds } of this.surfaces) {
      if (!this.ray.ray.intersectBox(bounds, this.boundsHit)) continue
      if (!bounds.containsPoint(this.ray.ray.origin) &&
          this.ray.ray.origin.distanceToSquared(this.boundsHit) > this.ray.far ** 2) continue
      const geometry = mesh.geometry
      this.hits.length = 0
      if ((geometry.index?.count ?? geometry.attributes.position.count) > 600) {
        let tree = trees.get(geometry)
        if (!tree) {
          // Indirect BVHs leave draw order, UVs and lightmap bindings intact.
          tree = new MeshBVH(geometry, { indirect: true })
          trees.set(geometry, tree)
        }
        tree.raycastObject3D(mesh, this.ray, this.hits)
      } else mesh.raycast(this.ray, this.hits)
      for (const sample of this.hits) {
        if (sample.distance < this.ray.far) {
          this.ray.far = sample.distance
          hit = sample
        }
      }
    }
    return hit
  }

  scan(camera: THREE.PerspectiveCamera, zones: string[], width: number, height: number) {
    const anchors: HotspotAnchor[] = []
    const consider = (x: number, y: number, prior?: HotspotAnchor) => {
      if (anchors.length === MAX_HOTSPOTS || !hotspotArea(x, y, width, height) ||
          anchors.some(anchor => Math.hypot(anchor.x - x, anchor.y - y) < 47)) return
      const hit = this.visibleSurface(camera, x, y, width, height)
      if (!hit?.face) return
      const surface = finishSurface(((hit.object as THREE.Mesh).material as THREE.Material).name)
      if (!surface || !zones.includes(surface.zone) || anchors.some(anchor => anchor.key === surface.key)) return
      if (prior && (surface.key !== prior.key || hit.point.distanceToSquared(prior.point) > 0.0025)) return
      anchors.push({ ...surface, point: prior?.point ?? hit.point, x, y, opacity: 1 - Math.min(0.55, hit.distance / 140) })
    }
    for (const anchor of this.previous) {
      const p = anchor.point.clone().project(camera)
      if (p.z > -1 && p.z < 1) consider((p.x + 1) * width / 2, (1 - p.y) * height / 2, anchor)
    }
    const columns = width < 600 ? 8 : 13
    const rows = 11
    // Start near the subject before sampling the rest of the frame.
    const samples = Array.from({ length: columns * rows }, (_, i) =>
      [(i % columns + 0.5) / columns, (Math.floor(i / columns) + 0.5) / rows])
    samples.sort(([a, b], [c, d]) => Math.hypot(a - 0.5, b - 0.5) - Math.hypot(c - 0.5, d - 0.5))
    for (const [x, y] of samples) {
      if (anchors.length === MAX_HOTSPOTS) break
      consider(width * x, height * y)
    }
    this.previous = anchors
    return anchors
  }
}
