import * as THREE from 'three'
import { loadRgbeWebp } from '../env/environment'
import type { HouseModel } from '../house/build'
import type { MaterialLibrary } from '../materials/library'
import { layoutLightmap, type LightmapLayout } from './lightmapUV'

/**
 * Baked lighting for interiors (see tools/bake). A lightmap holds the light that reaches each interior surface from
 * the sky, through windows, plus every bounce (the sun's bounce included); the direct sun stays real time so sun
 * patches stay sharp and move with the time of day. Lightmapped surfaces skip the IBL's diffuse term (the bake
 * already contains it) but keep its reflections.
 */

/** Materials (by library key) of the interior shell that receive the bake. */
export const LIGHTMAP_MATERIALS = new Set(['zone:walls', 'floor', 'tileFloor', 'tileWall', 'ceiling', 'ceilingWood', 'concrete'])

export interface LightmapMeta {
  plan: string
  preset: string
  signature: string
  size: number
  density: number
  /** multiplier from the stored value (Cycles' light pass) to three.js lightmap irradiance */
  scale: number
}

const layouts = new WeakMap<HouseModel, LightmapLayout>()

/** Interior shell meshes that get lightmap UVs, in a stable order. */
export function lightmapTargets(house: HouseModel, interior?: THREE.Object3D | null): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  const take = (root: THREE.Object3D | undefined) =>
    root?.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && LIGHTMAP_MATERIALS.has((m.material as THREE.Material).name)) out.push(m)
    })
  take(house.shell)
  take(house.ceilings)
  take(house.interior)
  take(interior?.getObjectByName('built-ins'))
  return out
}

/** The lightmap layout of a built house (computed once: adds uv1 and splits vertices on chart seams). */
export function ensureLayout(house: HouseModel, interior?: THREE.Object3D | null): LightmapLayout {
  let l = layouts.get(house)
  if (!l) {
    l = layoutLightmap(lightmapTargets(house, interior), { size: 2048, density: 40, pad: 2 })
    layouts.set(house, l)
  }
  return l
}

// IBL diffuse is replaced by the lightmap where one is bound; reflections (IBL radiance) stay
const MAPS_CHUNK = THREE.ShaderChunk.lights_fragment_maps.replace(
  '#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )\n',
  '#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM ) && ! defined( USE_LIGHTMAP )\n',
)
if (MAPS_CHUNK === THREE.ShaderChunk.lights_fragment_maps) console.warn('lightmaps: lights_fragment_maps chunk changed; IBL diffuse not suppressed')

function patch(m: THREE.MeshStandardMaterial) {
  if (m.userData.lightmapPatched) return
  m.userData.lightmapPatched = true
  const prev = m.onBeforeCompile
  const prevKey = m.customProgramCacheKey
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', MAPS_CHUNK)
  }
  m.customProgramCacheKey = () => `${prevKey.call(m)}|lm`
  m.needsUpdate = true
}

const textures = new Map<string, Promise<THREE.DataTexture>>()

async function loadLightmap(url: string): Promise<THREE.DataTexture> {
  let p = textures.get(url)
  if (!p) {
    p = loadRgbeWebp(url).then(({ data, W, H }) => {
      const half = new Uint16Array(data.length)
      for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(data[i], 65000))
      const t = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType)
      // stored with Blender's v = 0 row first, which is also the first row WebGL uploads
      t.flipY = false
      t.channel = 1
      t.colorSpace = THREE.LinearSRGBColorSpace
      // no mipmaps: lower mip levels would blend neighbouring charts across their 4-texel gutters
      t.magFilter = THREE.LinearFilter
      t.minFilter = THREE.LinearFilter
      t.generateMipmaps = false
      t.needsUpdate = true
      return t
    })
    textures.set(url, p)
    p.catch(() => textures.delete(url))
  }
  return p
}

/** Materials that may carry a lightmap right now. */
function targetMaterials(lib: MaterialLibrary): THREE.MeshStandardMaterial[] {
  return lib.materials().filter(m => LIGHTMAP_MATERIALS.has(m.name)) as THREE.MeshStandardMaterial[]
}

/** Remove baked lighting (edited plans, missing or stale bakes): back to the live probe lighting. */
export function clearLightmap(lib: MaterialLibrary) {
  for (const m of targetMaterials(lib)) {
    if (m.lightMap) {
      m.lightMap = null
      m.needsUpdate = true
    }
  }
}

/**
 * Bind the baked lightmap for this plan and time of day if one exists and matches the geometry. Returns false (and
 * leaves the live lighting) otherwise.
 */
export async function applyLightmap(
  lib: MaterialLibrary,
  house: HouseModel,
  interior: THREE.Object3D | null,
  planId: string,
  presetId: string,
  lowRes: boolean,
): Promise<boolean> {
  clearLightmap(lib)
  const base = `./assets/lightmaps/${planId}-${presetId}`
  let meta: LightmapMeta
  try {
    const r = await fetch(`${base}.json`)
    if (!r.ok) return false
    meta = (await r.json()) as LightmapMeta
  } catch {
    return false
  }
  const layout = ensureLayout(house, interior)
  if (meta.signature !== layout.signature) {
    console.warn(`lightmap ${planId}-${presetId} was baked for other geometry (${meta.signature} vs ${layout.signature}); using live lighting`)
    return false
  }
  let tex: THREE.DataTexture
  try {
    tex = await loadLightmap(`${base}${lowRes ? '-1k' : ''}.webp`)
  } catch (err) {
    console.warn('lightmap failed to load; using live lighting', err)
    return false
  }
  for (const m of targetMaterials(lib)) {
    patch(m)
    m.lightMap = tex
    m.lightMapIntensity = meta.scale
    m.needsUpdate = true
  }
  return true
}
