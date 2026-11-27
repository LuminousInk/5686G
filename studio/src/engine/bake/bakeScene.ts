import * as THREE from 'three'
import type { Site } from '../site/site'
import type { HouseModel } from '../house/build'
import type { TimePreset } from '../env/environment'
import { lightmapSource, type LightmapLayout } from './lightmapUV'

const SHELL_RECEIVERS = new Set(['zone:walls', 'floor', 'tileFloor', 'tileWall', 'ceiling', 'ceilingWood', 'concrete'])
const BUILT_IN_RECEIVERS = new Set(['cabinet', 'counter', 'tileWall', 'porcelain'])
const MAX_SITE_REACH = 14

export interface BakeMesh {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  target: boolean
  /** Sort key shared by the layout, fingerprint and export. */
  key: string
}

export function opaqueMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial | undefined {
  if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh
    || (mesh.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) return
  const mat = mesh.material as THREE.MeshPhysicalMaterial
  if (mat?.isMeshStandardMaterial && mat.name !== 'glass' && !mat.transparent && !mat.alphaTest
    && mat.opacity === 1 && !mat.transmission && mat.visible && mesh.geometry.hasAttribute('position')) return mat
}

// Two independent 32-bit accumulators. Hash vertex values in local space and transforms separately so
// repeated models only need one geometry pass. World placement still contributes to each instance.
class Fingerprint {
  private a = 2166136261
  private b = 5381

  int(n: number) {
    this.a = Math.imul(this.a ^ n, 16777619)
    this.b = Math.imul(this.b, 1597334677) ^ n
  }

  number(n: number) { this.int(Math.round(n * 100000)) }

  string(s: string) {
    this.int(s.length)
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i))
  }

  digest() {
    return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0')
  }
}

function meshKey(mesh: THREE.Mesh, material: THREE.Material, target: boolean,
  geometryHashes: WeakMap<THREE.BufferGeometry, string>): string {
  const g = lightmapSource(mesh.geometry)
  let geometry = geometryHashes.get(g)
  if (!geometry) {
    const h = new Fingerprint()
    for (const name of ['position', 'normal']) {
      const attr = g.getAttribute(name)
      h.int(attr?.count ?? 0)
      if (attr) for (let i = 0; i < attr.count; i++) {
        h.number(attr.getX(i))
        h.number(attr.getY(i))
        h.number(attr.getZ(i))
      }
    }
    h.int(g.index?.count ?? 0)
    if (g.index) for (let i = 0; i < g.index.count; i++) h.int(g.index.getX(i))
    geometry = h.digest()
    geometryHashes.set(g, geometry)
  }
  const h = new Fingerprint()
  h.int(target ? 1 : 0)
  h.string(geometry)
  h.string(mesh.name)
  h.string(material.name)
  h.int(material.side)
  for (const n of mesh.matrixWorld.elements) h.number(n)
  return h.digest()
}

/** Stable, opaque scene shared by the baker and validity check. Roof/ceiling visibility is a viewer mode. */
export function collectBakeMeshes(house: HouseModel, interior: THREE.Object3D | null, site: Site | null): BakeMesh[] {
  const out: BakeMesh[] = []
  const geometryHashes = new WeakMap<THREE.BufferGeometry, string>()
  const near = house.bounds.clone().expandByScalar(MAX_SITE_REACH)
  const box = new THREE.Box3()
  const visit = (root: THREE.Object3D, isTarget: (mesh: THREE.Mesh, name: string) => boolean, siteObjects = false) => {
    root.updateWorldMatrix(true, true)
    const collect = (o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh
      const material = opaqueMaterial(mesh)
      if (!material) return
      if (siteObjects) {
        // Trees, lawn, pebbles and foliage are tier-dependent detail. Model pieces on berms also have
        // tier-dependent placements. Keep the authored hardscape, furnishings, soil and fence.
        if (mesh.name.includes(':') || ['Coastal canyon', 'Board-formed terrace walls'].includes(mesh.name)) return
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
        if (!box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).intersectsBox(near)) return
      }
      const target = isTarget(mesh, material.name)
      out.push({ mesh, material, target, key: meshKey(mesh, material, target, geometryHashes) })
    }
    // A dollhouse toggles these root groups. Traverse their children as they appear in the full house.
    if (root === house.roof || root === house.ceilings) root.children.forEach(o => o.traverseVisible(collect))
    else root.traverseVisible(collect)
  }
  for (const root of [house.shell, house.ceilings, house.interior]) visit(root, (_, name) => SHELL_RECEIVERS.has(name))
  for (const root of [house.roof, house.outdoor]) visit(root, () => false)
  if (interior) visit(interior, (mesh, name) =>
    BUILT_IN_RECEIVERS.has(name) && (name === 'tileWall' || name === 'porcelain'
      || mesh.parent?.name.startsWith('kitchen-') === true || mesh.parent?.name === 'bathVanity'))
  if (site) visit(site.group, () => false, true)
  return out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

export function bakeSignature(house: HouseModel, meshes: BakeMesh[], preset: TimePreset): string {
  const h = new Fingerprint()
  for (const entry of meshes) h.string(entry.key)
  // Room and opening data determine texel priorities. Landscape data also covers the canonical bake
  // terrain, whose runtime triangulation varies by tier.
  h.string(JSON.stringify([house.plan.blocks, house.plan.rooms, house.plan.openings, house.plan.landscape, house.plan.levels]))
  h.string(JSON.stringify([preset.id, preset.hdri, preset.sunScale, preset.minElevation, house.plan.sunAzimuth]))
  // Bump when changing the chart policy, canonical site geometry or the bake recipe.
  return `gi2-${h.digest()}`
}

const layouts = new WeakMap<HouseModel, { targets: BakeMesh[]; layout: LightmapLayout }>()

export function cachedLayout(house: HouseModel, meshes: BakeMesh[], create: (targets: BakeMesh[]) => LightmapLayout) {
  const targets = meshes.filter(m => m.target)
  const existing = layouts.get(house)
  if (existing && existing.targets.every((entry, i) => entry.mesh === targets[i]?.mesh && entry.key === targets[i]?.key)
    && targets.length === existing.targets.length) return existing
  const layout = create(targets)
  layouts.set(house, { targets, layout })
  return { targets, layout }
}

