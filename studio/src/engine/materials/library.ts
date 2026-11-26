import * as THREE from 'three'
import { PALETTES, ZONES, zoneOption, type InteriorPalette, type MaterialParams } from './catalog'
import { limewashTexture, noiseTexture, solarTexture, TextureBank, type TextureSetId } from './textures'
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
    if (p.map === 'limewash') {
      m.map = this.limewash
      m.normalMap = null
      m.aoMap = null
      // fine grain over the soft blotches so close-ups still read as plaster
      m.roughnessMap = this.fineNoise
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
      m.roughnessMap = this.noise
      m.userData.tex = null
    }
    const v = m.userData.variation as { value: number } | undefined
    if (v) v.value = p.variation ?? 0
    if (hadMap !== !!m.map) m.needsUpdate = true
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
    return this.put('tileFloor', () => this.pbr('large_grey_tiles', { color: '#E9E6E1', roughness: 0.7 }, 0.8))
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
    return this.put('ceilingWood', () => this.pbr('laminate_floor_02', { color: this.palette.ceilingWood.color, roughness: 0.8 }, 1.2, Math.PI / 2))
  }

  get cabinet(): Std {
    return this.put('cabinet', () => this.pbr(this.palette.cabinet.tex, { color: this.palette.cabinet.color, roughness: this.palette.cabinet.roughness }, 1))
  }

  get counter(): Phys {
    return this.put('counter', () =>
      new THREE.MeshPhysicalMaterial({ color: this.palette.counter.color, roughness: this.palette.counter.roughness, roughnessMap: this.fineNoise, clearcoat: 0.3, clearcoatRoughness: 0.2 }),
    )
  }

  get fabric(): Std {
    return this.put('fabric', () => this.pbr('rough_linen', { color: this.palette.fabric, roughness: 1 }, 1))
  }

  get fabric2(): Std {
    return this.put('fabric2', () => this.pbr('rough_linen', { color: this.palette.fabric2, roughness: 1 }, 1))
  }

  get rug(): Std {
    return this.put('rug', () => this.pbr('rough_linen', { color: this.palette.rug, roughness: 1 }, 2.5))
  }

  get fixtureMetal(): Std {
    return this.put('fixtureMetal', () => new THREE.MeshStandardMaterial({ color: this.palette.metal.color, roughness: this.palette.metal.roughness, metalness: this.palette.metal.metalness }))
  }

  get stone(): Std {
    return this.put('stone', () => new THREE.MeshStandardMaterial({ color: this.palette.stone, roughness: 0.6, roughnessMap: this.noise }))
  }

  get porcelain(): Phys {
    return this.put('porcelain', () => new THREE.MeshPhysicalMaterial({ color: '#F7F7F4', roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.05 }))
  }

  get mirror(): Std {
    return this.put('mirror', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.02, metalness: 1 }))
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
