import * as THREE from 'three'
import { PALETTES, ZONES, zoneOption, type InteriorPalette, type MaterialParams } from './catalog'
import { limestoneTexture, limewashTexture, noiseTexture, solarTexture, TextureBank, type TextureSetId } from './textures'
import type { QualitySettings } from '../quality'

type Std = THREE.MeshStandardMaterial
type Phys = THREE.MeshPhysicalMaterial

/**
 * Shared materials, created on first use. Zone materials (`zone:<id>`) follow the finish catalog and are updated in
 * place when a finish changes, so swapping a finish never rebuilds geometry.
 */
export class MaterialLibrary {
  readonly bank: TextureBank
  private cache = new Map<string, THREE.Material>()
  private noise: THREE.Texture
  private fineNoise: THREE.Texture
  private limewash: THREE.Texture
  private limestone: THREE.Texture
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
    this.limewash = limewashTexture()
    this.limestone = limestoneTexture(0.95)
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

  /** Physically based material with an optional Poly Haven texture set. */
  private pbr(tex: TextureSetId | null | undefined, params: Partial<THREE.MeshStandardMaterialParameters>, scale = 1, rotate = 0): Std {
    const m = new THREE.MeshStandardMaterial(params)
    if (tex) this.assignTex(m, tex, scale, rotate)
    return m
  }

  private assignTex(m: Std, tex: TextureSetId, scale = 1, rotate = 0) {
    const s = this.bank.scaled(tex, scale, rotate)
    // the linen scan is dyed blue: use its weave (normal/roughness) but not its colour
    m.map = tex === 'rough_linen' ? null : s.map
    m.normalMap = s.normalMap
    m.roughnessMap = s.arm
    m.aoMap = s.arm
    m.aoMapIntensity = 0.6
    m.normalScale.set(1, 1)
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
    return this.put(`zone:${zone}`, () => {
      const def = ZONES[zone]
      const opt = zoneOption(zone, undefined)
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
    const hadMap = !!m.map
    const hadRough = !!m.roughnessMap
    if (p.map === 'limewash') {
      m.map = this.limewash
      m.normalMap = null
      m.aoMap = null
      // Keep plaster evenly matte under the baked diffuse light.
      m.roughnessMap = null
      m.userData.tex = null
    } else if (p.tex) {
      const scale = p.texScale ?? (zone === 'deck' ? 1.2 : 1)
      if (m.userData.tex !== p.tex || m.userData.texScale !== scale) this.assignTex(m, p.tex, scale)
      m.userData.tex = p.tex
      m.userData.texScale = scale
      // roughness map multiplies: keep wood a little glossier than its raw scan
      m.roughness = p.roughness * 1.15
    } else {
      m.map = null
      m.normalMap = null
      m.aoMap = null
      // painted metal: subtle roughness breakup so large panels don't look CG-flat
      m.roughnessMap = zone === 'walls' ? null : this.noise
      m.userData.tex = null
    }
    const v = m.userData.variation as { value: number } | undefined
    if (v) v.value = p.variation ?? 0
    if (hadMap !== !!m.map || hadRough !== !!m.roughnessMap) m.needsUpdate = true
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
    return this.put('cushion', () => this.pbr('rough_linen', { color: '#F4F1EA', roughness: 0.95 }, 1))
  }

  // ---------------------------------------------------------------- interior (palette driven)

  get floor(): Std {
    return this.put('floor', () => this.pbr(this.palette.floor.tex, { color: this.palette.floor.color, roughness: this.palette.floor.roughness }, 1))
  }

  get tileFloor(): Std {
    return this.put('tileFloor', () => new THREE.MeshStandardMaterial({
      color: '#CCBEAA', map: limestoneTexture(0.72, true), roughness: 0.77, bumpMap: this.fineNoise, bumpScale: 0.004,
    }))
  }

  get tileWall(): Std {
    return this.put('tileWall', () => this.pbr('long_white_tiles', { color: '#FFFFFF', roughness: 0.35 }, 0.8, Math.PI / 2))
  }

  get wall(): Std {
    // interior paint on partitions and the inside faces of exterior walls; cached under the zone key so
    // setFinish('walls', ...) updates it in place like any other zone
    return this.put('zone:walls', () => {
      const opt = zoneOption('walls', this.currentFinish('walls'))
      const m = new THREE.MeshStandardMaterial({ color: opt.params.color })
      this.applyParams(m, opt.params, 'walls')
      return m
    })
  }

  get ceiling(): Std {
    return this.put('ceiling', () => new THREE.MeshStandardMaterial({ color: '#F6F4EF', roughness: 0.95 }))
  }

  get ceilingWood(): Std {
    return this.put('ceilingWood', () => this.pbr('white_oak_veneer', { color: this.palette.ceilingWood.color, roughness: 0.89 }, 1.8, Math.PI / 2))
  }

  get cabinet(): Std {
    return this.put('cabinet', () => this.pbr(this.palette.cabinet.tex, { color: this.palette.cabinet.color, roughness: this.palette.cabinet.roughness }, 1))
  }

  get counter(): Phys {
    return this.put('counter', () =>
      new THREE.MeshPhysicalMaterial({ color: this.palette.counter.color, roughness: this.palette.counter.roughness, map: this.limestone, bumpMap: this.fineNoise, bumpScale: 0.003, clearcoat: 0.14, clearcoatRoughness: 0.35 }),
    )
  }

  get fabric(): Std {
    return this.put('fabric', () => this.pbr('rough_linen', { color: this.palette.fabric, roughness: 1 }, 1))
  }

  get fabric2(): Std {
    return this.put('fabric2', () => this.pbr('rough_linen', { color: this.palette.fabric2, roughness: 1 }, 1))
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

  get sageCabinet(): Std { return this.interiorFinish('sage-cabinet', '#7C8663', 0.78) }
  get oliveCabinet(): Std { return this.interiorFinish('olive-cabinet', '#6B6D50', 0.78) }
  get sageVanity(): Std { return this.interiorFinish('sage-vanity', '#626D51', 0.76) }
  get bronze(): Std { return this.interiorFinish('bronze', '#887052', 0.39, 0.62) }
  get brass(): Std { return this.interiorFinish('brass', '#C19257', 0.37, 0.62) }
  get agedBrass(): Std { return this.interiorFinish('aged-brass', '#A3794E', 0.38, 0.62) }
  get ivoryShade(): Std { return this.interiorFinish('ivory-shade', '#EDE0C8', 0.38) }
  get rattan(): Std { return this.interiorFinish('rattan', '#B68D59', 0.87) }
  get rustLinen(): Std { return this.interiorFinish('rust-linen', '#9A6B51', 0.93) }
  get foliageStem(): Std { return this.interiorFinish('foliage-stem', '#786844', 0.91) }

  get foliage(): Std {
    const m = this.interiorFinish('foliage', '#687650', 0.85)
    m.side = THREE.DoubleSide
    return m
  }

  get drapery(): Std {
    const m = this.interiorFinish('drapery', '#E4DAC9', 0.95)
    m.side = THREE.DoubleSide
    return m
  }

  get bathStone(): Std {
    const m = this.put('bathStone', () => new THREE.MeshStandardMaterial({
      color: '#D5C5AD', map: this.limestone, roughness: 0.76, bumpMap: this.fineNoise, bumpScale: 0.006,
    }))
    this.interiorExtra.add(m)
    return m
  }

  get oliveLinen(): Std {
    const m = this.put('oliveLinen', () => this.pbr('rough_linen', { color: '#77795A', roughness: 0.94 }, 0.45))
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
    return this.put('linen', () => this.pbr('rough_linen', { color: '#F5F3EE', roughness: 1 }, 1))
  }

  get appliance(): Std {
    return this.put('appliance', () => new THREE.MeshStandardMaterial({ color: '#C8CACB', roughness: 0.25, metalness: 0.9, roughnessMap: this.fineNoise }))
  }

  static readonly INTERIOR = ['floor', 'tileFloor', 'tileWall', 'zone:walls', 'ceiling', 'ceilingWood', 'cabinet', 'counter', 'fabric', 'fabric2', 'rug', 'fixtureMetal', 'stone', 'porcelain', 'mirror', 'blackMetal', 'darkWood', 'linen', 'appliance']
  /** extra interior materials (loaded models) that should share the interior light probe */
  readonly interiorExtra = new Set<THREE.MeshStandardMaterial>()

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
    if (floor) {
      floor.color.set(p.floor.color)
      floor.roughness = p.floor.roughness
      if (floor.userData.tex !== p.floor.tex) {
        this.assignTex(floor, p.floor.tex, 1)
        floor.userData.tex = p.floor.tex
      }
    }
    const cab = this.cache.get('cabinet') as Std | undefined
    if (cab) {
      cab.color.set(p.cabinet.color)
      cab.roughness = p.cabinet.roughness
      if (cab.userData.tex !== p.cabinet.tex) {
        this.assignTex(cab, p.cabinet.tex, 1)
        cab.userData.tex = p.cabinet.tex
      }
    }
    const set = (k: string, f: (m: Std) => void) => {
      const m = this.cache.get(k) as Std | undefined
      if (m) f(m)
    }
    set('counter', m => { m.color.set(p.counter.color); m.roughness = p.counter.roughness })
    set('ceilingWood', m => m.color.set(p.ceilingWood.color))
    set('fabric', m => m.color.set(p.fabric))
    set('fabric2', m => m.color.set(p.fabric2))
    set('rug', m => m.color.set(p.rug))
    set('fixtureMetal', m => { m.color.set(p.metal.color); m.roughness = p.metal.roughness; m.metalness = p.metal.metalness })
    set('stone', m => m.color.set(p.stone))
  }

  all(): THREE.Material[] {
    return [...this.cache.values()]
  }
}
