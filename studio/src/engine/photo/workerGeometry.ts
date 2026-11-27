import {
  BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, type TypedArray,
} from 'three'
import type { SerializedBVH } from 'three-mesh-bvh'

export const pathAttributes = ['position', 'normal', 'tangent', 'color', 'uv']

type Attribute = {
  array: TypedArray
  size: number
  normalized: boolean
  stride?: number
  offset?: number
}

interface Geometry {
  attributes: Record<string, Attribute>
  index?: Attribute
  groups: BufferGeometry['groups']
}

export type ScenePacket = {
  geometries: Geometry[]
  meshes: { geometry: number; materials: number[]; matrix: number[] }[]
}

export type SceneResult = {
  geometry: Geometry
  bvh: SerializedBVH
  materials: number[]
}

function packAttribute(attribute: BufferAttribute | InterleavedBufferAttribute): Attribute {
  const { itemSize: size, normalized } = attribute
  if (attribute instanceof InterleavedBufferAttribute) {
    return { array: attribute.data.array, size, normalized, stride: attribute.data.stride, offset: attribute.offset }
  }
  return { array: attribute.array, size, normalized }
}

export function packGeometry(geometry: BufferGeometry, keys: string[]): Geometry {
  const attributes: Record<string, Attribute> = {}
  for (const key of keys) {
    const attribute = geometry.getAttribute(key)
    if (attribute) attributes[key] = packAttribute(attribute)
  }
  return {
    attributes, index: geometry.index ? packAttribute(geometry.index) : undefined,
    groups: geometry.groups,
  }
}

function unpackAttribute({ array, size, normalized, stride, offset }: Attribute) {
  if (stride !== undefined) return new InterleavedBufferAttribute(new InterleavedBuffer(array, stride), size, offset!, normalized)
  return new BufferAttribute(array, size, normalized)
}

export function unpackGeometry(packet: Geometry) {
  const geometry = new BufferGeometry()
  for (const [name, value] of Object.entries(packet.attributes)) geometry.setAttribute(name, unpackAttribute(value))
  if (packet.index) geometry.setIndex(new BufferAttribute(packet.index.array, 1))
  geometry.groups = packet.groups
  return geometry
}
