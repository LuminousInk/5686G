import * as THREE from 'three'
import { loadRgbeWebp, type TimePreset } from '../env/environment'
import type { HouseModel } from '../house/build'
import type { Site } from '../site/site'
import { bakeSignature, cachedLayout, collectBakeMeshes, type BakeMesh } from './bakeScene'
import { layoutLightmap, LIGHTMAP_SIZE } from './lightmapUV'
import { surfaceBudgets } from './surfaceBudget'

const PHONE_SIZE = 1024
const PHONE_BYTES = 2_000_000

export interface LightmapMeta {
  plan: string
  preset: string
  signature: string
  size: number
  density: number
  scale: number
}

export interface LightmapStatus {
  state: 'pending' | 'live' | 'bound'
  reason: string
  plan?: string
  preset?: string
  signature?: string
  bakedSignature?: string
  size?: number
  density?: number
  bytes?: number
}

export function validateLightmap(meta: Partial<LightmapMeta> | null, plan: string, preset: string, signature: string): string | undefined {
  if (!meta || meta.plan !== plan || meta.preset !== preset) return 'sidecar plan or preset does not match'
  if (meta.signature !== signature) return 'bake signature mismatch'
  if (meta.size !== LIGHTMAP_SIZE || !Number.isFinite(meta.scale) || meta.scale! <= 0
    || !Number.isFinite(meta.density) || meta.density! <= 0) return 'invalid atlas metadata'
}

export function ensureLayout(house: HouseModel, meshes: BakeMesh[]) {
  return cachedLayout(house, meshes, targets => layoutLightmap(targets.map(m => m.mesh), {
    size: LIGHTMAP_SIZE, density: 75, pad: 3, budget: surfaceBudgets(house.plan),
  }))
}

// Baked irradiance replaces IBL diffuse while leaving IBL specular enabled.
const MAPS_CHUNK = THREE.ShaderChunk.lights_fragment_maps.replace(
  '#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )\n',
  '#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM ) && ! defined( USE_LIGHTMAP )\n',
)

interface MaterialBinding {
  source: THREE.MeshStandardMaterial
  mapped: THREE.MeshStandardMaterial
}

export class LightmapBinding {
  status: LightmapStatus = { state: 'live', reason: 'no house loaded' }
  private revision = 0
  private assigned: { mesh: THREE.Mesh; material: MaterialBinding }[] = []
  private materials = new Map<THREE.MeshStandardMaterial, MaterialBinding>()
  private texture: THREE.DataTexture | null = null
  private intensity = 1

  clear(reason = 'scene changed') {
    this.revision++
    for (const { mesh, material } of this.assigned) mesh.material = material.source
    for (const material of this.materials.values()) material.mapped.dispose()
    this.assigned = []
    this.materials.clear()
    this.texture?.dispose()
    this.texture = null
    this.status = { state: 'live', reason }
  }

  syncMaterials() {
    for (const { source, mapped } of this.materials.values()) {
      mapped.copy(source)
      mapped.lightMap = this.texture
      mapped.lightMapIntensity = this.intensity
      mapped.needsUpdate = true
    }
  }

  async apply(house: HouseModel, interior: THREE.Object3D | null, site: Site | null, preset: TimePreset, phone: boolean) {
    this.clear()
    const { id: plan } = house.plan
    const context: Omit<LightmapStatus, 'state' | 'reason'> = { plan, preset: preset.id }
    const revision = this.revision
    const current = () => revision === this.revision
    const live = (reason: string) => {
      if (!current()) return
      this.status = { ...context, state: 'live', reason }
      console.info('lightmap using live lighting', this.status)
    }
    if (!['golden', 'day'].includes(preset.id)) return live('preset uses live lighting')
    this.status = { ...context, state: 'pending', reason: 'checking bake' }
    const base = `./assets/lightmaps/${plan}-${preset.id}`
    let meta: LightmapMeta
    try {
      const res = await fetch(`${base}.json`)
      if (!res.ok) return live(`sidecar HTTP ${res.status}`)
      if (!res.headers.get('content-type')?.includes('json')) return live('missing sidecar')
      meta = await res.json() as LightmapMeta
    } catch {
      return live('sidecar could not be read')
    }
    if (!current()) return
    const meshes = collectBakeMeshes(house, interior, site)
    const signature = bakeSignature(house, meshes, preset)
    context.signature = signature
    context.bakedSignature = meta?.signature
    const issue = validateLightmap(meta, plan, preset.id, signature)
    if (issue) return live(issue)

    const size = phone ? PHONE_SIZE : LIGHTMAP_SIZE
    let decoded: Awaited<ReturnType<typeof loadRgbeWebp>>
    try {
      decoded = await loadRgbeWebp(`${base}${phone ? '-1k' : ''}.webp?v=${signature}`, phone ? PHONE_BYTES : undefined)
    } catch (err) {
      return live(err instanceof Error ? err.message : 'atlas could not be loaded')
    }
    if (!current()) return
    if (decoded.W !== size || decoded.H !== size) return live(`atlas has wrong dimensions (${decoded.W} × ${decoded.H})`)
    let binding: ReturnType<typeof ensureLayout>
    try {
      binding = ensureLayout(house, meshes)
    } catch (err) {
      return live(err instanceof Error ? err.message : 'atlas layout failed')
    }
    const { targets, layout } = binding
    if (Math.abs(layout.density - meta.density) > 1e-5) return live('atlas texel density does not match layout')
    const half = new Uint16Array(decoded.data.length)
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(decoded.data[i], 65000))
    const texture = new THREE.DataTexture(half, size, size, THREE.RGBAFormat, THREE.HalfFloatType)
    texture.channel = 1
    texture.colorSpace = THREE.LinearSRGBColorSpace
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter
    texture.needsUpdate = true
    this.texture = texture
    this.intensity = meta.scale

    for (const { mesh, material: source } of targets) {
      let material = this.materials.get(source)
      if (!material) {
        const mapped = source.clone()
        const previous = source.onBeforeCompile
        const cacheKey = source.customProgramCacheKey()
        mapped.onBeforeCompile = (shader, renderer) => {
          previous.call(mapped, shader, renderer)
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', MAPS_CHUNK)
        }
        mapped.customProgramCacheKey = () => `${cacheKey}|lightmap`
        material = { source, mapped }
        this.materials.set(source, material)
      }
      mesh.material = material.mapped
      this.assigned.push({ mesh, material })
    }
    this.syncMaterials()
    this.status = { ...context, state: 'bound', reason: 'bake signature matches', size, density: layout.density, bytes: decoded.bytes }
  }
}
