import { BufferAttribute, Mesh, MeshStandardMaterial, Scene } from 'three'
import { PathTracingSceneGenerator } from 'three-gpu-pathtracer'
import { MeshBVH } from 'three-mesh-bvh'
import { packGeometry, pathAttributes, type ScenePacket, type SceneResult, unpackGeometry } from './workerGeometry'

self.onmessage = ({ data }: MessageEvent<ScenePacket>) => {
  try {
    const scene = new Scene()
    const geometry = data.geometries.map(packet => {
      const geometry = unpackGeometry(packet)
      // The WebGL merger requires a common color itemSize. Keep r187/glTF RGB and RGBA meshes compatible.
      const color = geometry.getAttribute('color')
      if (color?.itemSize === 4) {
        const rgb = new Float32Array(color.count * 3)
        for (let i = 0; i < color.count; i++) {
          rgb[i * 3] = color.getX(i)
          rgb[i * 3 + 1] = color.getY(i)
          rgb[i * 3 + 2] = color.getZ(i)
        }
        geometry.setAttribute('color', new BufferAttribute(rgb, 3))
      }
      return geometry
    })
    const ids = new Map<number, MeshStandardMaterial>()
    const material = (id: number) => {
      let entry = ids.get(id)
      if (!entry) {
        entry = new MeshStandardMaterial()
        entry.userData.index = id
        ids.set(id, entry)
      }
      return entry
    }
    for (const item of data.meshes) {
      const mats = item.materials.map(material)
      const mesh = new Mesh(geometry[item.geometry], mats.length === 1 ? mats[0] : mats)
      mesh.matrix.fromArray(item.matrix)
      mesh.matrixAutoUpdate = false
      scene.add(mesh)
    }
    scene.updateMatrixWorld(true)
    const generator = new PathTracingSceneGenerator(scene)
    generator.attributes = pathAttributes
    generator.bvhOptions = { targetLeafSize: 4, maxLeafTris: undefined } as typeof generator.bvhOptions
    const result = generator.generate()
    const merged = packGeometry(result.geometry, [...pathAttributes, 'materialIndex'])
    const bvh = MeshBVH.serialize(result.bvh, { cloneBuffers: false })
    const packet: SceneResult = { geometry: merged, bvh, materials: result.materials.map(m => m.userData.index as number) }
    const buffers = new Set<ArrayBuffer>(bvh.roots)
    for (const item of [...Object.values(merged.attributes), merged.index]) {
      if (item?.array.buffer instanceof ArrayBuffer) buffers.add(item.array.buffer)
    }
    if (bvh.indirectBuffer?.buffer instanceof ArrayBuffer) buffers.add(bvh.indirectBuffer.buffer)
    if (bvh.index?.buffer instanceof ArrayBuffer) buffers.add(bvh.index.buffer)
    self.postMessage(packet, { transfer: [...buffers] })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
