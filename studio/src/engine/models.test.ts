import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import { gltfJsonToGlb } from './models'

// The artifact host refuses WebAssembly and fetch() of data: URLs (see README "Runs on a locked-down host").
// These checks keep the built models loadable there.
const roots = ['public/assets/models', 'public/assets/models-lo']

describe('built models load on a locked-down host', () => {
  for (const root of roots) {
    const files = fs.existsSync(root) ? fs.readdirSync(root).filter(f => f.endsWith('.json')) : []

    it(`${root} has models`, () => {
      expect(files.length).toBeGreaterThan(20)
    })

    it(`${root}: no meshopt or other required extension that needs WebAssembly`, () => {
      for (const f of files) {
        const json = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
        expect(json.extensionsUsed ?? [], f).not.toContain('EXT_meshopt_compression')
        expect(json.extensionsRequired ?? [], f).not.toContain('KHR_draco_mesh_compression')
      }
    })

    it(`${root}: one inline buffer, textures as files next to the model`, () => {
      for (const f of files) {
        const json = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
        expect(json.buffers?.length, f).toBe(1)
        expect(json.buffers[0].uri.startsWith('data:'), f).toBe(true)
        for (const im of json.images ?? []) {
          expect(im.uri.startsWith('data:'), `${f} image`).toBe(false)
          expect(fs.existsSync(path.join(root, im.uri)), `${f} -> ${im.uri}`).toBe(true)
        }
      }
    })
  }
})

describe('gltfJsonToGlb', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const triangle = () => ({
    asset: { version: '2.0' },
    buffers: [{ uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}`, byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  })

  it('writes a valid GLB header and 4-byte aligned chunks', () => {
    const glb = gltfJsonToGlb(triangle())
    const dv = new DataView(glb)
    expect(dv.getUint32(0, true)).toBe(0x46546c67) // 'glTF'
    expect(dv.getUint32(4, true)).toBe(2)
    expect(dv.getUint32(8, true)).toBe(glb.byteLength)
    const jsonLen = dv.getUint32(12, true)
    expect(jsonLen % 4).toBe(0)
    expect(dv.getUint32(20 + jsonLen + 4, true)).toBe(0x004e4942) // 'BIN\0'
    expect(glb.byteLength % 4).toBe(0)
  })

  it('loads in GLTFLoader with the original vertices and no data: URI left', async () => {
    const glb = gltfJsonToGlb(triangle())
    const head = new TextDecoder().decode(new Uint8Array(glb, 20, new DataView(glb).getUint32(12, true)))
    expect(head).not.toContain('data:')
    const gltf = await new GLTFLoader().parseAsync(glb, '')
    let mesh: THREE.Mesh | undefined
    gltf.scene.traverse(o => {
      if ((o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh
    })
    expect(Array.from(mesh!.geometry.getAttribute('position').array)).toEqual(Array.from(positions))
  })

  it('refuses glTF that is not a single inline buffer', () => {
    expect(() => gltfJsonToGlb({ buffers: [] })).toThrow()
    expect(() => gltfJsonToGlb({ buffers: [{ uri: 'model.bin', byteLength: 4 }] })).toThrow()
  })
})
