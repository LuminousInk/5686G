import { Mesh, type BufferGeometry, type Material, type Scene } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { PathTracingSceneGeneratorResult } from 'three-gpu-pathtracer'
import { packGeometry, pathAttributes, type ScenePacket, type SceneResult, unpackGeometry } from './workerGeometry'

type BuildResult = Pick<PathTracingSceneGeneratorResult, 'geometry' | 'bvh' | 'materials' | 'bvhChanged' | 'needsMaterialIndexUpdate'>

/** Merges vertex attributes and builds the BVH in a bundled same-origin worker. */
export class PhotoBVHWorker {
  private worker = new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module' })
  private reject?: (reason: Error) => void

  generate(scene: Scene) {
    return new Promise<BuildResult>((resolve, reject) => {
      this.reject = reject
      const geometryIds = new Map<BufferGeometry, number>()
      const materialIds = new Map<Material, number>()
      const packet: ScenePacket = { geometries: [], meshes: [] }
      const materials: Material[] = []
      for (const object of scene.children) {
        if (!(object instanceof Mesh)) continue
        let id = geometryIds.get(object.geometry)
        if (id === undefined) {
          id = packet.geometries.length
          geometryIds.set(object.geometry, id)
          packet.geometries.push(packGeometry(object.geometry, pathAttributes))
        }
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material]
        const materialIndices = meshMaterials.map(material => {
          let id = materialIds.get(material)
          if (id === undefined) {
            id = materials.length
            materialIds.set(material, id)
            materials.push(material)
          }
          return id
        })
        packet.meshes.push({ geometry: id, materials: materialIndices, matrix: object.matrix.toArray() })
      }
      this.worker.onmessage = ({ data }: MessageEvent<SceneResult | { error: string }>) => {
        this.reject = undefined
        if ('error' in data) {
          reject(new Error(data.error))
          return
        }
        try {
          const geometry = unpackGeometry(data.geometry)
          const bvh = MeshBVH.deserialize(data.bvh, geometry, { setIndex: false })
          resolve({ geometry, bvh, materials: data.materials.map(id => materials[id]), bvhChanged: true, needsMaterialIndexUpdate: true })
        } catch (error) {
          reject(error)
        }
      }
      this.worker.onerror = event => reject(new Error(event.message || 'Could not start the BVH worker'))
      // Structured clone makes one worker copy. The raster mesh buffers stay in use on the main thread.
      this.worker.postMessage(packet)
    }).finally(() => this.dispose())
  }

  dispose() {
    this.worker.terminate()
    this.reject?.(new Error('Refinement cancelled'))
    this.reject = undefined
  }
}
