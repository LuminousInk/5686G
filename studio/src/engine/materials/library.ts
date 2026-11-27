import * as THREE from 'three'
import { PALETTES, ZONES, zoneOption, type InteriorPalette, type MaterialParams } from './catalog'
import { noiseTexture, solarTexture, TextureBank, type TextureSetId } from './textures'
import type { QualitySettings } from '../quality'

type Std = THREE.MeshStandardMaterial
type Phys = THREE.MeshPhysicalMaterial
const LINEN_SHEEN = new THREE.Color('#E3D7C8')

/** The model loader registers its materials here. Preserve the sofa scans and add the physical sheen lobe. */
class InteriorMaterials extends Set<Std> {
  override add(material: Std): this {
    const sofaFabric = material.name === 'Tela_Victoria' || material.name === 'Material_2145965798'
    if (sofaFabric && !(material as Phys).isMeshPhysicalMaterial && !material.userData.upholsterySheen) {
      material.userData.upholsterySheen = true
      material.roughness = Math.max(0.78, material.roughness)
      const original = material.onBeforeCompile
      const cacheKey = material.customProgramCacheKey()
      material.onBeforeCompile = (shader, renderer) => {
        original.call(material, shader, renderer)
        shader.fragmentShader = '#define USE_SHEEN\n' + shader.fragmentShader
        shader.uniforms.sheenColor = { value: new THREE.Color(0.17, 0.155, 0.135) }
        shader.uniforms.sheenRoughness = { value: 0.79 }
      }
      material.customProgramCacheKey = () => `${cacheKey}|upholstery-sheen`
      material.needsUpdate = true
    }
    return super.add(material)
  }
}

/**
 * Shared materials, created on first use. Zone materials (`zone:<id>`) follow the finish catalog and are updated in
 * place when a finish changes, so swapping a finish never rebuilds geometry.
 */
export class MaterialLibrary {
  readonly bank: TextureBank
  private cache = new Map<string, THREE.Material>()
  private noise: THREE.Texture
  private fineNoise: THREE.Texture
  private coatedMetal: THREE.Texture
  /** emissive materials that turn on at dusk/night: material -> full emissive intensity */
  private lamps = new Map<THREE.MeshStandardMaterial, number>()
  palette: InteriorPalette = PALETTES.light

  constructor(
    renderer: THREE.WebGLRenderer,
    readonly quality: QualitySettings,
  ) {
    this.bank = new TextureBank(renderer, quality.texRes)
    this.noise = noiseTexture(256, 5, 3, 1.2)
    this.noise.repeat.set(0.25, 0.25)
    this.fineNoise = noiseTexture(256, 4, 9, 1.4)
    this.fineNoise.repeat.set(2, 2)
    this.coatedMetal = noiseTexture(128, 3, 17, 0.24, 0.88)
    this.coatedMetal.repeat.set(0.95, 0.38)
  }

  /** Every material created so far (named by its library key). */
  materials(): THREE.Material[] {
    return [...this.cache.values()]
  }

  private put<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined
    if (!m) {
      m = make()
      m.name = key
      this.cache.set(key, m)
    }
    return m
  }

  /** Physically based material with an optional CC0 texture set. */
  private pbr(tex: TextureSetId | null | undefined, params: Partial<THREE.MeshStandardMaterialParameters>, scale = 1, rotate = 0): Std {
    const m = new THREE.MeshStandardMaterial(params)
    if (tex) this.assignTex(m, tex, scale, rotate)
    return m
  }

  private assignTex(m: Std, tex: TextureSetId, scale = 1, rotate = 0) {
    const s = this.bank.scaled(tex, scale, rotate)
    m.map = s.map
    m.normalMap = s.normalMap
    m.roughnessMap = s.arm
    m.aoMap = s.arm
    m.aoMapIntensity = 0.6
    m.normalScale.set(1, 1)
  }

  /** World-space colour modulation keeps large surfaces from repeating in lockstep with the scan. */
  private withMacroVariation(m: Std, surface: 'floor' | 'wall') {
    const uv = surface === 'floor' ? 'finishPosition.xz * 0.11' : 'vec2(finishPosition.x + finishPosition.z * 0.79, finishPosition.y) * 0.071'
    const strength = surface === 'floor' ? 0.36 : 0.19
    m.onBeforeCompile = shader => {
      shader.uniforms.finishNoise = { value: this.noise }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 finishPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nfinishPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 finishPosition;\nuniform sampler2D finishNoise;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= 1.0 + (texture2D(finishNoise, ${uv}).g - 0.5) * ${strength};`)
    }
    m.customProgramCacheKey = () => `finish-macro:${surface}`
    return m
  }

  /** The same metre-scale stone pattern crosses slab edges and upstands with one sample per map. */
  private stoneProjection<T extends Std>(m: T): T {
    // Cabinet boxes have 0..1 UVs per face. An oblique projection gives all three face axes a nonzero footprint.
    m.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 slab = (modelMatrix * vec4(position, 1.0)).xyz;
        vec2 stoneUv = vec2((slab.x - slab.z) * 0.7071, (slab.x + slab.z) * 0.4082 + slab.y * 0.8165);
        vMapUv = (mapTransform * vec3(stoneUv, 1.0)).xy;
        vNormalMapUv = (normalMapTransform * vec3(stoneUv, 1.0)).xy;
        vRoughnessMapUv = (roughnessMapTransform * vec3(stoneUv, 1.0)).xy;`)
    }
    m.customProgramCacheKey = () => 'stone-projection'
    return m
  }

  /** Per-board colour variation, scaled by a uniform so muted finishes vary less. */
  private withVariation(m: Std, amount: number): Std {
    m.vertexColors = true
    const u = { value: amount }
    m.userData.variation = u
    m.onBeforeCompile = shader => {
      shader.uniforms.uVariation = u
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uVariation;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, uVariation);')
    }
    m.customProgramCacheKey = () => 'variation'
    return m
  }

  // ---------------------------------------------------------------- zones

  zone(zone: string): Std {
    if (zone === 'walls') return this.wall
    return this.put(`zone:${zone}`, () => {
      const def = ZONES[zone]
      const opt = zoneOption(zone, this.currentFinish(zone))
      const m = this.pbr(null, { color: opt.params.color })
      this.applyParams(m, opt.params, def ? zone : '')
      return this.withVariation(m, opt.params.variation ?? 0)
    })
  }

  private finishes = new Map<string, string>()
  currentFinish(zone: string) {
    return this.finishes.get(zone)
  }

  setFinish(zone: string, optionId: string) {
    if (optionId) this.finishes.set(zone, optionId)
    const m = this.cache.get(`zone:${zone}`) as Std | undefined
    if (!m) return
    this.applyParams(m, zoneOption(zone, optionId).params, zone)
  }

  private applyParams(m: Std, p: MaterialParams, zone: string) {
    m.color.set(p.color)
    m.roughness = p.roughness
    m.metalness = p.metalness ?? 0
    const previous = [m.map, m.normalMap, m.aoMap, m.roughnessMap, m.bumpMap]
    m.bumpMap = null
    if (p.tex) {
      const scale = p.texScale ?? (zone === 'deck' ? 1.2 : 1)
      const rotation = p.texRotation ?? 0
      if (m.userData.tex !== p.tex || m.userData.texScale !== scale || m.userData.texRotation !== rotation) {
        this.assignTex(m, p.tex, scale, rotation)
      }
      m.userData.tex = p.tex
      m.userData.texScale = scale
      m.userData.texRotation = rotation
      m.normalScale.setScalar(p.normalStrength ?? 1)
      if (zone === 'walls') {
        // Keep the broad specular lobe even under baked diffuse light.
        m.roughnessMap = null
        m.aoMap = null
      }
    } else {
      m.map = null
      m.normalMap = null
      m.aoMap = null
      m.roughnessMap = this.coatedMetal
      if (zone === 'roof' || zone === 'panel' || zone === 'panel2') {
        m.bumpMap = this.coatedMetal
        m.bumpScale = zone === 'roof' ? 0.014 : 0.006
      } else if (zone === 'body' || zone === 'coastal' || zone === 'siding') {
        m.bumpMap = this.fineNoise
        m.bumpScale = 0.0016
      }
      m.userData.tex = null
    }
    const v = m.userData.variation as { value: number } | undefined
    if (v) v.value = p.variation ?? 0
    const maps = [m.map, m.normalMap, m.aoMap, m.roughnessMap, m.bumpMap]
    if (previous.some((map, i) => !!map !== !!maps[i])) m.needsUpdate = true
  }

  // ---------------------------------------------------------------- fixed exterior materials

  get glass(): Phys {
    return this.put('glass', () => {
      const m = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.02,
        transmission: 1,
        // double glazing with a low-e coat reflects ~3x a single pane: approximate with a higher ior
        ior: 1.95,
        thickness: 0.02,
        specularIntensity: 1,
        envMapIntensity: 1.15,
        attenuationColor: new THREE.Color('#7d8f89'),
        attenuationDistance: 0.045,
      })
      m.depthWrite = false
      return m
    })
  }

  get concrete(): Std {
    return this.put('concrete', () => this.pbr('brushed_concrete', { color: '#B8B3AA', roughness: 0.95 }))
  }

  get foundation(): Std {
    return this.put('foundation', () => this.pbr('brushed_concrete', { color: '#6B6863', roughness: 1 }, 1.5))
  }

  get steel(): Std {
    return this.put('steel', () => new THREE.MeshStandardMaterial({ color: '#141517', roughness: 0.5, metalness: 0.55, roughnessMap: this.fineNoise }))
  }

  get soffit(): Std {
    return this.put('soffit', () => this.pbr('japanese_cedar_planks', { color: '#E0B48C', roughness: 0.8 }, 1, Math.PI / 2))
  }

  get solar(): Std {
    return this.put('solar', () =>
      new THREE.MeshPhysicalMaterial({
        map: solarTexture(),
        color: '#ffffff',
        roughness: 0.12,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
      }),
    )
  }

  get solarFrame(): Std {
    return this.put('solarFrame', () => new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.35, metalness: 0.8 }))
  }

  lamp(key: string, color: string, intensity: number): Std {
    return this.put(`lamp:${key}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: '#1a1a1a', emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.4 })
      this.lamps.set(m, intensity)
      return m
    })
  }

  setLamps(level: number) {
    for (const [m, full] of this.lamps) m.emissiveIntensity = full * level
  }

  // ---------------------------------------------------------------- site

  get ground(): Std {
    return this.put('ground', () => this.pbr('sparse_grass', { color: '#C9DE9A', roughness: 1 }, 1))
  }

  get soil(): Std {
    return this.put('soil', () => this.pbr('forest_ground_04', { color: '#8C8070', roughness: 1 }, 1))
  }

  get moss(): Std {
    return this.put('moss', () => this.pbr('mossy_rock', { color: '#C8D2A8', roughness: 1 }, 1))
  }

  get pebbles(): Std {
    return this.put('pebbles', () => this.pbr('ganges_river_pebbles', { color: '#8E8A84', roughness: 0.9 }, 1))
  }

  get fence(): Std {
    return this.put('fence', () => this.pbr('black_painted_planks', { color: '#6E6A66', roughness: 0.85 }, 1, Math.PI / 2))
  }

  get pavers(): Std {
    return this.put('pavers', () => this.pbr('brushed_concrete', { color: '#C9C4BA', roughness: 0.92 }, 0.8))
  }

  get ceramic(): Std {
    return this.put('ceramic', () => new THREE.MeshStandardMaterial({ color: '#E8E1D3', roughness: 0.62, roughnessMap: this.fineNoise }))
  }

  get teak(): Std {
    return this.put('teak', () => this.withVariation(this.pbr('teak_veneer', { color: '#CDA27E', roughness: 0.78 }, 0.6), 0.6))
  }

  get cushion(): Std {
    return this.put('cushion', () => this.textile('#E7E2D9', 1))
  }

  // ---------------------------------------------------------------- interior (palette driven)

  get floor(): Std {
    return this.put('floor', () => {
      const m = this.withMacroVariation(new THREE.MeshStandardMaterial(), 'floor')
      this.applyFloor(m, this.palette.floor)
      return m
    })
  }

  private applyFloor(m: Std, floor: InteriorPalette['floor']) {
    m.color.set(floor.color)
    m.roughness = floor.roughness
    if (m.userData.tex !== floor.tex) {
      this.assignTex(m, floor.tex)
      m.userData.tex = floor.tex
    }
    m.normalScale.setScalar(floor.tex === 'oak_wood_planks' ? 1.35 : 0.62)
  }

  get tileFloor(): Std {
    return this.put('tileFloor', () => {
      const m = this.pbr('ambientcg_tiles142', { color: '#E9E4DB', roughness: 0.98 }, 1.5)
      m.normalScale.setScalar(1.3)
      return m
    })
  }

  get tileWall(): Std {
    return this.put('tileWall', () => this.pbr('ambientcg_tiles142', { color: '#F0EBE2', roughness: 0.88 }))
  }

  get wall(): Std {
    // interior paint on partitions and the inside faces of exterior walls; cached under the zone key so
    // setFinish('walls', ...) updates it in place like any other zone
    return this.put('zone:walls', () => {
      const opt = zoneOption('walls', this.currentFinish('walls'))
      const m = new THREE.MeshStandardMaterial({ color: opt.params.color })
      this.applyParams(m, opt.params, 'walls')
      return this.withMacroVariation(m, 'wall')
    })
  }

  get ceiling(): Std {
    return this.put('ceiling', () => new THREE.MeshStandardMaterial({ color: '#F6F4EF', roughness: 0.95 }))
  }

  get ceilingWood(): Std {
    return this.put('ceilingWood', () => this.pbr('white_oak_veneer', { color: this.palette.ceilingWood.color, roughness: 0.89 }, 1.8, Math.PI / 2))
  }

  get cabinet(): Std {
    return this.put('cabinet', () => {
      const m = this.pbr(this.palette.cabinet.tex, { color: this.palette.cabinet.color, roughness: this.palette.cabinet.roughness })
      m.userData.tex = this.palette.cabinet.tex
      m.normalScale.setScalar(1.16)
      return m
    })
  }

  get counter(): Phys {
    return this.put('counter', () => {
      const p = this.palette.counter
      const m = new THREE.MeshPhysicalMaterial({
        color: p.color, roughness: p.roughness, clearcoat: p.coat, clearcoatRoughness: 0.27,
      })
      this.assignTex(m, 'ambientcg_marble019')
      m.normalScale.setScalar(0.6)
      m.aoMap = null
      return this.stoneProjection(m)
    })
  }

  private textile(color: string, scale: number, params: THREE.MeshPhysicalMaterialParameters = {}): Phys {
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: 1, sheen: 0.38, sheenColor: new THREE.Color(color).lerp(LINEN_SHEEN, 0.35),
      sheenRoughness: 0.83, ...params,
    })
    this.assignTex(m, 'rough_linen', scale)
    m.normalScale.setScalar(0.46)
    return m
  }

  get fabric(): Std {
    return this.put('fabric', () => this.textile(this.palette.fabric, 0.82))
  }

  get fabric2(): Std {
    return this.put('fabric2', () => this.textile(this.palette.fabric2, 0.82))
  }

  get rug(): Std {
    return this.put('rug', () => this.pbr('rough_linen', { color: this.palette.rug, roughness: 1 }, 0.36))
  }

  get fixtureMetal(): Std {
    return this.put('fixtureMetal', () => new THREE.MeshStandardMaterial({ color: this.palette.metal.color, roughness: this.palette.metal.roughness, metalness: this.palette.metal.metalness }))
  }

  get stone(): Std {
    return this.put('stone', () => new THREE.MeshStandardMaterial({ color: this.palette.stone, roughness: 0.6, roughnessMap: this.noise }))
  }

  /** Shared materials for casework, linen styling and catalog fixtures. */
  private interiorFinish(key: string, color: string, roughness = 0.67, metalness = 0): Std {
    const m = this.put(`interior:${key}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }))
    this.interiorExtra.add(m)
    return m
  }

  private lacquer(key: string, color: string): Phys {
    const m = this.put(`interior:${key}`, () => new THREE.MeshPhysicalMaterial({
      color, roughness: 0.56, clearcoat: 0.24, clearcoatRoughness: 0.36,
    }))
    this.interiorExtra.add(m)
    return m
  }

  get sageCabinet(): Std { return this.lacquer('sage-cabinet', '#758270') }
  get oliveCabinet(): Std { return this.lacquer('olive-cabinet', '#6B6D50') }
  get sageVanity(): Std { return this.lacquer('sage-vanity', '#626D51') }
  get bronze(): Std { return this.interiorFinish('bronze', '#887052', 0.39, 0.62) }
  get brass(): Std { return this.interiorFinish('brass', '#C19257', 0.37, 0.62) }
  get agedBrass(): Std { return this.interiorFinish('aged-brass', '#A3794E', 0.38, 0.62) }
  get ivoryShade(): Std { return this.interiorFinish('ivory-shade', '#EDE0C8', 0.38) }
  get rattan(): Std { return this.interiorFinish('rattan', '#B68D59', 0.87) }
  get artMat(): Std { return this.interiorFinish('art-mat', '#E3D9C8', 0.96) }
  get decorCeramic(): Std { return this.interiorFinish('decor-ceramic', '#BDAA94', 0.54) }
  get decorAmber(): Std { return this.interiorFinish('decor-amber', '#684733', 0.24, 0.10) }
  get decorTray(): Std { return this.interiorFinish('decor-tray', '#85796A', 0.74) }

  get wovenMat(): Std {
    const m = this.put('interior:woven-mat', () =>
      this.pbr('rough_linen', { color: '#BEAA93', roughness: 0.96 }, 0.42))
    this.interiorExtra.add(m)
    return m
  }

  get throwLinen(): Std {
    const m = this.put('interior:throw-linen', () =>
      this.textile('#A18972', 0.6, { side: THREE.DoubleSide }))
    this.interiorExtra.add(m)
    return m
  }

  get tvGlass(): Phys {
    const m = this.put('interior:tv-glass', () => new THREE.MeshPhysicalMaterial({
      color: '#111013', metalness: 0, roughness: 0.18, ior: 1.42, specularIntensity: 0.09,
      specularColor: '#514747', clearcoat: 0.08, clearcoatRoughness: 0.20,
    }))
    this.interiorExtra.add(m)
    return m
  }

  get tvCase(): Phys {
    const m = this.put('interior:tv-case', () => new THREE.MeshPhysicalMaterial({
      color: '#101010', roughness: 0.92, specularIntensity: 0.04,
    }))
    this.interiorExtra.add(m)
    return m
  }

  get vanityGlass(): Std { return this.interiorFinish('vanity-glass', '#817873', 0.13, 1) }

  get linenShade(): Std {
    return this.put('interior:linen-shade', () => new THREE.MeshStandardMaterial({
      color: '#E9D8B8', roughness: 0.91, emissive: '#E9B67C', emissiveIntensity: 0.31, side: THREE.DoubleSide,
    }))
  }

  get rustLinen(): Std {
    const m = this.put('interior:rust-linen', () => this.textile('#9A6B51', 0.65))
    this.interiorExtra.add(m)
    return m
  }
  get foliageStem(): Std { return this.interiorFinish('foliage-stem', '#786844', 0.91) }

  get foliage(): Std {
    const m = this.interiorFinish('foliage', '#687650', 0.85)
    m.side = THREE.DoubleSide
    return m
  }

  get drapery(): Std {
    // Drapery is cut from a 0..1 UV plane, so repeat the weave several times across the panel.
    const m = this.put('interior:drapery', () => this.textile('#E4DAC9', 0.4, { side: THREE.DoubleSide, sheen: 0.24 }))
    this.interiorExtra.add(m)
    return m
  }

  get bathStone(): Std {
    const m = this.put('bathStone', () => {
      const stone = this.pbr('ambientcg_marble019', { color: '#D6C5AD', roughness: 0.72 }, 0.72)
      stone.roughnessMap = this.coatedMetal
      stone.aoMap = null
      stone.normalScale.setScalar(0.7)
      return this.stoneProjection(stone)
    })
    this.interiorExtra.add(m)
    return m
  }

  get oliveLinen(): Std {
    const m = this.put('oliveLinen', () => this.textile('#77795A', 0.55))
    this.interiorExtra.add(m)
    return m
  }

  /** Low-output practicals remain visibly warm in daylight. */
  get diffuser(): Std {
    return this.put('interior:diffuser', () => new THREE.MeshStandardMaterial({
      color: '#FFF1D5', roughness: 0.72, emissive: '#FFD29C', emissiveIntensity: 0.68,
    }))
  }

  get showerGlass(): Phys {
    return this.put('showerGlass', () => new THREE.MeshPhysicalMaterial({
      color: '#E8EAE1', roughness: 0.14, transparent: true, opacity: 0.082, depthWrite: false,
      envMapIntensity: 0.03, specularIntensity: 0.25, ior: 1.48, side: THREE.DoubleSide,
    }))
  }

  get porcelain(): Phys {
    return this.put('porcelain', () => new THREE.MeshPhysicalMaterial({ color: '#F7F7F4', roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.05 }))
  }

  get mirror(): Std {
    return this.put('mirror', () => new THREE.MeshStandardMaterial({ color: '#eeeae3', roughness: 0.085, metalness: 1 }))
  }

  get blackMetal(): Std {
    return this.put('blackMetal', () => new THREE.MeshStandardMaterial({ color: '#1A1B1D', roughness: 0.42, metalness: 0.6 }))
  }

  get darkWood(): Std {
    return this.put('darkWood', () => this.pbr('natural_walnut_veneer', { color: '#B08A70', roughness: 0.55 }, 1))
  }

  get linen(): Std {
    return this.put('linen', () => this.textile('#EBE7DF', 0.82))
  }

  get appliance(): Std {
    return this.put('appliance', () => new THREE.MeshStandardMaterial({ color: '#C8CACB', roughness: 0.25, metalness: 0.9, roughnessMap: this.fineNoise }))
  }

  static readonly INTERIOR = ['floor', 'tileFloor', 'tileWall', 'zone:walls', 'ceiling', 'ceilingWood', 'cabinet', 'counter', 'fabric', 'fabric2', 'rug', 'fixtureMetal', 'stone', 'porcelain', 'mirror', 'blackMetal', 'darkWood', 'linen', 'appliance']
  /** extra interior materials (loaded models) that should share the interior light probe */
  readonly interiorExtra: Set<Std> = new InteriorMaterials()

  /** Interior surfaces: use a captured interior light probe as their environment (or dim sky light as fallback). */
  interiorEnv(level = 0.32, probe: THREE.Texture | null = null) {
    const all = [...MaterialLibrary.INTERIOR.map(k => this.cache.get(k) as Std | undefined), ...this.interiorExtra]
    for (const m of all) {
      if (!m) continue
      const had = !!m.envMap
      m.envMap = probe
      m.envMapIntensity = probe ? level : 0.3
      if (had !== !!probe) m.needsUpdate = true
    }
  }

  get soffitDark(): Std {
    return this.put('soffitDark', () => new THREE.MeshStandardMaterial({ color: '#26282b', roughness: 0.6, metalness: 0.3 }))
  }

  /** Re-apply the interior palette to the palette-driven materials (they are shared, so this is instant). */
  setPalette(id: string) {
    this.palette = PALETTES[id] ?? PALETTES.light
    const p = this.palette
    const floor = this.cache.get('floor') as Std | undefined
    if (floor) this.applyFloor(floor, p.floor)
    const cab = this.cache.get('cabinet') as Std | undefined
    if (cab) {
      cab.color.set(p.cabinet.color)
      cab.roughness = p.cabinet.roughness
      if (cab.userData.tex !== p.cabinet.tex) {
        this.assignTex(cab, p.cabinet.tex, 1)
        cab.normalScale.setScalar(1.16)
        cab.userData.tex = p.cabinet.tex
      }
    }
    const set = (k: string, f: (m: Std) => void) => {
      const m = this.cache.get(k) as Std | undefined
      if (m) f(m)
    }
    const counter = this.cache.get('counter') as Phys | undefined
    if (counter) {
      counter.color.set(p.counter.color)
      counter.roughness = p.counter.roughness
      counter.clearcoat = p.counter.coat
    }
    set('ceilingWood', m => m.color.set(p.ceilingWood.color))
    const textile = (m: Phys, color: string) => {
      m.color.set(color)
      m.sheenColor.copy(m.color).lerp(LINEN_SHEEN, 0.35)
    }
    set('fabric', m => textile(m as Phys, p.fabric))
    set('fabric2', m => textile(m as Phys, p.fabric2))
    set('rug', m => m.color.set(p.rug))
    set('fixtureMetal', m => { m.color.set(p.metal.color); m.roughness = p.metal.roughness; m.metalness = p.metal.metalness })
    set('stone', m => m.color.set(p.stone))
  }

  all(): THREE.Material[] {
    return [...this.cache.values()]
  }
}
