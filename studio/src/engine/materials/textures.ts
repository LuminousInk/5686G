import * as THREE from 'three'

// CC0 texture sets (built by tools/build_assets.mjs) and their real-world tile size in meters.
// UVs are generated in meters, so `repeat = 1 / size`.
export const TEXTURE_SETS = {
  teak_veneer: { size: 0.9, res: ['1k', '2k'] },
  japanese_cedar_planks: { size: 1.4, res: ['1k'] },
  sparse_grass: { size: 2.2, res: ['1k'] },
  forest_ground_04: { size: 2.0, res: ['1k'] },
  mossy_rock: { size: 1.6, res: ['1k'] },
  ganges_river_pebbles: { size: 1.1, res: ['1k'] },
  black_painted_planks: { size: 2.0, res: ['1k'] },
  brushed_concrete: { size: 2.4, res: ['1k'] },
  oak_wood_planks: { size: 1.8, res: ['1k'] }, // 18–24 cm boards after widening the source planks
  wood_floor: { size: 2.2, res: ['1k'] },
  wood_planks_grey: { size: 2.4, res: ['1k'] },
  white_oak_veneer: { size: 1.2, res: ['1k'] },
  natural_walnut_veneer: { size: 1.2, res: ['1k'] },
  ash_veneer: { size: 1.2, res: ['1k'] },
  ambientcg_marble019: { size: 1.6, res: ['1k'] },
  ambientcg_tiles142: { size: 2.0, res: ['1k'] },
  ambientcg_plaster001: { size: 1.5, res: ['1k'] },
  rough_linen: { size: 0.6, res: ['1k'] },
} as const

export type TextureSetId = keyof typeof TEXTURE_SETS

export interface PbrSet {
  map: THREE.Texture | null
  normalMap: THREE.Texture
  arm: THREE.Texture
  size: number
}

const base = './assets/tex/'

export const AssetPriority = { shell: 0, view: 1, rest: 2 } as const

/** One budget for model files and decoded images. A slot is released before any dependent load starts. */
export class AssetQueue {
  private active = 0
  private waiting: { priority: number; start: () => void }[] = []

  constructor(private limit: number) {}

  run<T>(priority: number, work: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active++
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.active--
          this.waiting.shift()?.start()
        })
      }
      if (this.active < this.limit) start()
      else {
        const index = this.waiting.findIndex(job => job.priority > priority)
        this.waiting.splice(index < 0 ? this.waiting.length : index, 0, { priority, start })
      }
    })
  }
}

export const assets = new AssetQueue(6)

export function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  return scheduler?.yield?.() ?? new Promise(resolve => setTimeout(resolve, 0))
}

export async function decodeImage(blob: Blob, flipY = false): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, {
        imageOrientation: flipY ? 'flipY' : 'from-image',
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      })
    } catch {
      // Some browsers expose ImageBitmap but cannot decode every image format with it.
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function loadImage(url: string, flipY: boolean, priority: number) {
  return assets.run(priority, async () => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    return decodeImage(await response.blob(), flipY)
  })
}

export class TextureBank {
  private sets = new Map<TextureSetId, PbrSet>()
  private pending = new Set<Promise<void>>()
  private anisotropy: number
  priority: number = AssetPriority.rest

  constructor(
    renderer: THREE.WebGLRenderer,
    private preferRes: '512' | '1k' | '2k',
  ) {
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  }

  private load(url: string, srgb: boolean): THREE.Texture {
    const tex = new THREE.Texture()
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = this.anisotropy
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    const pending = loadImage(url, true, this.priority).then(image => {
      // Scaled textures share the Source, so clones made before decoding receive the same image.
      tex.image = image
      tex.needsUpdate = true
    }).catch(error => {
      console.warn('Texture could not be loaded:', error)
    }).finally(() => this.pending.delete(pending))
    this.pending.add(pending)
    return tex
  }

  get(id: TextureSetId): PbrSet {
    let s = this.sets.get(id)
    if (!s) {
      const def = TEXTURE_SETS[id]
      // every set has 1k and a 512 phone copy; a few hero surfaces have 2k
      const res = this.preferRes === '512' ? '512' : (def.res as readonly string[]).includes(this.preferRes) ? this.preferRes : '1k'
      const p = `${base}${id}_${res}_`
      s = {
        // The linen scan is dyed blue. Its weave is used without the albedo.
        map: id === 'rough_linen' ? null : this.load(`${p}d.webp`, true),
        normalMap: this.load(`${p}n.webp`, false),
        arm: this.load(`${p}arm.webp`, false),
        size: def.size,
      }
      this.sets.set(id, s)
    }
    return s
  }

  /** A copy of a set with its own repeat (shares the GPU image). */
  scaled(id: TextureSetId, scale = 1, rotate = 0): PbrSet {
    const s = this.get(id)
    const r = 1 / (s.size * scale)
    const c = (t: THREE.Texture) => {
      const n = t.clone()
      n.repeat.set(r, r)
      if (rotate) {
        n.center.set(0.5, 0.5)
        n.rotation = rotate
      }
      return n
    }
    return { map: s.map && c(s.map), normalMap: c(s.normalMap), arm: c(s.arm), size: s.size * scale }
  }

  async ready() {
    await Promise.all(this.pending)
  }
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tileable multi-octave value noise, sampled per pixel into [0, 1]. */
function noiseField(size: number, octaves: number, seed: number, base = 4): Float32Array {
  const rand = rng(seed)
  const grids: Float32Array[] = []
  for (let o = 0; o < octaves; o++) {
    const n = base << o
    const g = new Float32Array(n * n)
    for (let i = 0; i < g.length; i++) g[i] = rand()
    grids.push(g)
  }
  const out = new Float32Array(size * size)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0
      let amp = 0.5
      let norm = 0
      for (let o = 0; o < octaves; o++) {
        const n = base << o
        const fx = (x / size) * n
        const fy = (y / size) * n
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const tx = smooth(fx - x0)
        const ty = smooth(fy - y0)
        const g = grids[o]
        const at = (i: number, j: number) => g[((j + n) % n) * n + ((i + n) % n)]
        const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx
        const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx
        v += (a * (1 - ty) + b * ty) * amp
        norm += amp
        amp *= 0.5
      }
      out[y * size + x] = v / norm
    }
  return out
}

/** Tileable value noise as a canvas texture (for roughness breakup on paint and metal). */
export function noiseTexture(size = 256, octaves = 4, seed = 7, contrast = 1, midpoint = 0.5): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const f = noiseField(size, octaves, seed)
  for (let i = 0; i < f.length; i++) {
    const c = Math.max(0, Math.min(255, Math.round(((f[i] - 0.5) * contrast + midpoint) * 255)))
    const k = i * 4
    img.data[k] = img.data[k + 1] = img.data[k + 2] = c
    img.data[k + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

/** Monocrystalline solar cell pattern (6 x 10 cells per panel), sRGB albedo. */
export function solarTexture(): THREE.CanvasTexture {
  const w = 384
  const h = 640
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#c9ccd0'
  ctx.fillRect(0, 0, w, h)
  const cols = 6
  const rows = 10
  const cw = w / cols
  const ch = h / rows
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * cw + 2
      const y = r * ch + 2
      const g = ctx.createLinearGradient(x, y, x + cw, y + ch)
      g.addColorStop(0, '#0d1420')
      g.addColorStop(1, '#141c2b')
      ctx.fillStyle = g
      // cut corners like monocrystalline cells
      const k = 7
      ctx.beginPath()
      ctx.moveTo(x + k, y)
      ctx.lineTo(x + cw - 4 - k, y)
      ctx.lineTo(x + cw - 4, y + k)
      ctx.lineTo(x + cw - 4, y + ch - 4 - k)
      ctx.lineTo(x + cw - 4 - k, y + ch - 4)
      ctx.lineTo(x + k, y + ch - 4)
      ctx.lineTo(x, y + ch - 4 - k)
      ctx.lineTo(x, y + k)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(160,170,185,0.35)'
      ctx.lineWidth = 1
      for (let i = 1; i < 3; i++) {
        ctx.beginPath()
        ctx.moveTo(x + (i * (cw - 4)) / 3, y)
        ctx.lineTo(x + (i * (cw - 4)) / 3, y + ch - 4)
        ctx.stroke()
      }
    }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Soft feathery plume for ornamental grass heads (alpha in A, warm beige in RGB). */
export function plumeTexture(): THREE.CanvasTexture {
  const w = 64
  const h = 256
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  const rand = rng(11)
  for (let i = 0; i < 900; i++) {
    const t = rand()
    const y = 8 + t * (h - 16)
    const spread = Math.sin(Math.PI * Math.pow(t, 0.8)) * (w * 0.42)
    const x = w / 2 + (rand() - 0.5) * 2 * spread
    const len = 6 + rand() * 14
    const a = 0.25 + rand() * 0.5
    const shade = 200 + Math.floor(rand() * 45)
    ctx.strokeStyle = `rgba(${shade},${shade - 22},${shade - 60},${a})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w / 2 + (x - w / 2) * 0.2, y + len * 0.6)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(190,170,120,0.9)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(w / 2, h)
  ctx.lineTo(w / 2, 4)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
