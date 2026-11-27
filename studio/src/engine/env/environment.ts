import * as THREE from 'three'
import type { QualitySettings } from '../quality'

export interface TimePreset {
  id: string
  label: string
  hdri: string
  /** exposure applied before tone mapping */
  exposure: number
  /** multiplier on the extracted sun (or moon) */
  sunScale: number
  /** Angular radius in degrees, used for still-view shadow accumulation. */
  sunRadius: number
  /** multiplier on image based light */
  envScale: number
  /** interior + exterior lamps 0..1 */
  lamps: number
  /** sky brightness in the background (can differ from the light it casts) */
  backgroundScale: number
  /** minimum sun elevation (degrees) - the HDRI sun is lifted if lower, to keep shadows readable */
  minElevation?: number
  bloom: { intensity: number; threshold: number; radius: number }
  grade: { contrast: number; saturation: number; warmth: number }
  /** largest resolution shipped for this sky */
  maxRes: '1k' | '2k'
}

export const TIME_PRESETS: TimePreset[] = [
  {
    id: 'golden', label: 'Golden hour', hdri: 'syferfontein_6d_clear_puresky',
    exposure: 1.32, sunScale: 0.84, sunRadius: 0.85, envScale: 1, lamps: 0, backgroundScale: 1, minElevation: 21, maxRes: '2k',
    bloom: { intensity: 0.045, threshold: 1.55, radius: 0.47 },
    grade: { contrast: 0.23, saturation: 1.06, warmth: 0.03 },
  },
  {
    id: 'day', label: 'Afternoon', hdri: 'kloofendal_48d_partly_cloudy_puresky',
    exposure: 0.72, sunScale: 0.92, sunRadius: 0.70, envScale: 1, lamps: 0, backgroundScale: 1, maxRes: '2k',
    bloom: { intensity: 0.025, threshold: 1.75, radius: 0.38 },
    grade: { contrast: 0.21, saturation: 1.05, warmth: 0.005 },
  },
  {
    id: 'dusk', label: 'Dusk', hdri: 'qwantani_dusk_2_puresky',
    exposure: 0.9, sunScale: 0, sunRadius: 0, envScale: 1, lamps: 0.85, backgroundScale: 1, maxRes: '1k',
    bloom: { intensity: 0.09, threshold: 1.15, radius: 0.5 },
    grade: { contrast: 0.16, saturation: 1.02, warmth: 0.018 },
  },
  {
    id: 'night', label: 'Night', hdri: 'qwantani_moonrise_puresky',
    exposure: 2.6, sunScale: 0.02, sunRadius: 0.55, envScale: 0.08, lamps: 1, backgroundScale: 0.07, maxRes: '1k',
    bloom: { intensity: 0.14, threshold: 0.95, radius: 0.54 },
    grade: { contrast: 0.14, saturation: 1.0, warmth: 0.01 },
  },
]

interface Analysed {
  original: THREE.DataTexture
  sunless: THREE.DataTexture
  /** sunless sky + a 0.7 degree sun disk carrying the measured energy (fits half floats; for the path tracer) */
  traced: THREE.DataTexture
  /** raw sun direction in HDRI space (unit), null if the sky has no sun */
  sunDir: THREE.Vector3 | null
  /** sun irradiance at normal incidence (linear RGB) */
  sunE: THREE.Color
}

const cache = new Map<string, Promise<Analysed>>()

/**
 * Skies ship as lossless WebP holding RGBE (top half: RGB mantissas, bottom half: exponent) because web hosts only
 * serve web formats. Decode to linear float RGBA, rows top-first like a Radiance file.
 */
export async function loadRgbeWebp(url: string): Promise<{ data: Float32Array; W: number; H: number }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`sky ${url}: ${res.status}`)
  const blob = await res.blob()
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const W = bmp.width
  const H2 = bmp.height
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H2
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const px = ctx.getImageData(0, 0, W, H2).data
  const H = H2 / 2
  const data = new Float32Array(W * H * 4)
  const off = W * H * 4
  for (let i = 0, j = 0; i < W * H; i++, j += 4) {
    const e = px[off + j]
    if (e) {
      const f = Math.pow(2, e - 128) / 256
      data[j] = (px[j] + 0.5) * f
      data[j + 1] = (px[j + 1] + 0.5) * f
      data[j + 2] = (px[j + 2] + 0.5) * f
    }
    data[j + 3] = 1
  }
  return { data, W, H }
}

/**
 * Finds the sun disk in an equirect HDRI, measures its irradiance and colour, and returns a copy with the disk
 * removed. The sun is then drawn by a shadow-casting DirectionalLight, so it is not counted twice (once unshadowed
 * through the environment map, once by the light).
 */
async function analyse(url: string): Promise<Analysed> {
  const { data, W, H } = await loadRgbeWebp(url)
  const lum = new Float32Array(W * H)
  let max = 0
  let maxI = 0
  for (let i = 0; i < W * H; i++) {
    const l = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]
    lum[i] = l
    if (l > max) {
      max = l
      maxI = i
    }
  }
  // median of the upper hemisphere (cheap: sample)
  const samples: number[] = []
  for (let i = 0; i < (W * H) / 2; i += 97) samples.push(lum[i])
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)] || 1e-3

  const sunless = new Float32Array(data)
  let sunDir: THREE.Vector3 | null = null
  const sunE = new THREE.Color(0, 0, 0)
  if (max > median * 400) {
    const thr = max * 0.002
    const cx = maxI % W
    const cy = Math.floor(maxI / W)
    const R = Math.ceil(W / 64)
    const dir = new THREE.Vector3()
    // ring average to fill the hole
    let ringR = 0
    let ringG = 0
    let ringB = 0
    let ringN = 0
    for (let dy = -R * 2; dy <= R * 2; dy++)
      for (let dx = -R * 2; dx <= R * 2; dx++) {
        const x = (cx + dx + W) % W
        const y = cy + dy
        if (y < 0 || y >= H) continue
        const i = y * W + x
        const d = Math.hypot(dx, dy)
        if (d > R && d <= R * 2 && lum[i] < thr) {
          ringR += data[i * 4]
          ringG += data[i * 4 + 1]
          ringB += data[i * 4 + 2]
          ringN++
        }
      }
    ringR /= Math.max(1, ringN)
    ringG /= Math.max(1, ringN)
    ringB /= Math.max(1, ringN)
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = (cx + dx + W) % W
        const y = cy + dy
        if (y < 0 || y >= H) continue
        const i = y * W + x
        if (lum[i] < thr) continue
        const v = 1 - (y + 0.5) / H
        const u = (x + 0.5) / W
        const lat = (v - 0.5) * Math.PI
        const phi = (u - 0.5) * 2 * Math.PI
        const dOmega = ((2 * Math.PI) / W) * (Math.PI / H) * Math.cos(lat)
        // energy above the ring level belongs to the sun
        const er = Math.max(0, data[i * 4] - ringR) * dOmega
        const eg = Math.max(0, data[i * 4 + 1] - ringG) * dOmega
        const eb = Math.max(0, data[i * 4 + 2] - ringB) * dOmega
        sunE.r += er
        sunE.g += eg
        sunE.b += eb
        const w = er + eg + eb
        dir.x += Math.cos(phi) * Math.cos(lat) * w
        dir.y += Math.sin(lat) * w
        dir.z += Math.sin(phi) * Math.cos(lat) * w
        sunless[i * 4] = ringR
        sunless[i * 4 + 1] = ringG
        sunless[i * 4 + 2] = ringB
      }
    if (dir.lengthSq() > 0) sunDir = dir.normalize()
  }
  const mk = (arr: Float32Array) => {
    // half floats: linear filtering of float32 textures is not available on iOS
    const half = new Uint16Array(arr.length)
    for (let i = 0; i < arr.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(arr[i], 65000))
    const t = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType)
    t.mapping = THREE.EquirectangularReflectionMapping
    t.colorSpace = THREE.LinearSRGBColorSpace
    t.flipY = true
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  }
  // path tracer sky: re-add the sun as a slightly larger disk so its energy survives half-float storage
  const traced = new Float32Array(sunless)
  if (sunDir) {
    const rad = THREE.MathUtils.degToRad(0.7)
    const cosR = Math.cos(rad)
    const pix: number[] = []
    let omega = 0
    for (let y = 0; y < H; y++) {
      const lat = (1 - (y + 0.5) / H - 0.5) * Math.PI
      const dy = Math.sin(lat)
      if (Math.abs(lat - Math.asin(sunDir.y)) > rad * 2) continue
      const dOmega = ((2 * Math.PI) / W) * (Math.PI / H) * Math.cos(lat)
      for (let x = 0; x < W; x++) {
        const phi = ((x + 0.5) / W - 0.5) * 2 * Math.PI
        const d = Math.cos(phi) * Math.cos(lat) * sunDir.x + dy * sunDir.y + Math.sin(phi) * Math.cos(lat) * sunDir.z
        if (d >= cosR) {
          pix.push(y * W + x)
          omega += dOmega
        }
      }
    }
    if (pix.length && omega > 0) {
      for (const i of pix) {
        traced[i * 4] += sunE.r / omega
        traced[i * 4 + 1] += sunE.g / omega
        traced[i * 4 + 2] += sunE.b / omega
      }
    }
  }
  return { original: mk(data), sunless: mk(sunless), traced: mk(traced), sunDir, sunE }
}

export class SkyEnvironment {
  readonly sun: THREE.DirectionalLight
  readonly sunTarget = new THREE.Object3D()
  /** world direction toward the sun (unit) */
  readonly sunDir = new THREE.Vector3(0, 1, 0)
  readonly sunColor = new THREE.Color(1, 1, 1)
  sunIntensity = 0
  preset: TimePreset = TIME_PRESETS[0]
  private pmrem: THREE.PMREMGenerator
  private envRT: THREE.WebGLRenderTarget | null = null
  private current: Analysed | null = null
  exposure = 1
  /** the path tracer wants the original HDRI (with the sun) at this rotation */
  rotationY = 0

  constructor(
    renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private quality: QualitySettings,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.sun = new THREE.DirectionalLight(0xffffff, 1)
    this.sun.castShadow = true
    const s = this.sun.shadow
    s.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
    s.bias = -0.00016
    s.normalBias = 0.018
    s.radius = quality.shadowFilterRadius
    scene.add(this.sun, this.sunTarget)
    this.sun.target = this.sunTarget
  }

  /** Fit the sun's shadow camera around a box (the house and its yard). */
  fitShadow(box: THREE.Box3) {
    const c = box.getCenter(new THREE.Vector3())
    const r = box.getSize(new THREE.Vector3()).length() / 2
    const cam = this.sun.shadow.camera
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 1
    cam.far = r * 4 + 60
    cam.updateProjectionMatrix()
    this.sunTarget.position.copy(c)
    this.shadowCenter.copy(c)
    this.shadowRadius = r
    this.placeSun(this.sunDir)
  }

  private shadowCenter = new THREE.Vector3()
  private shadowRadius = 30

  /** Position the light along a direction (used per frame to jitter for soft accumulated shadows). */
  placeSun(dir: THREE.Vector3) {
    this.sun.position.copy(this.shadowCenter).addScaledVector(dir, this.shadowRadius * 2 + 20)
    this.sun.updateMatrixWorld()
  }

  async setPreset(preset: TimePreset, sunAzimuthDeg: number) {
    this.preset = preset
    const res = this.quality.hdriRes === '2k' && preset.maxRes === '2k' ? '2k' : '1k'
    const url = `./assets/hdri/${preset.hdri}_${res}.webp`
    let p = cache.get(url)
    if (!p) {
      const fallback = `./assets/hdri/${preset.hdri}_1k.webp`
      p = analyse(url).catch(err => (url === fallback ? Promise.reject(err) : analyse(fallback)))
      cache.set(url, p)
    }
    const a = await p
    this.current = a
    // rotate the sky so its sun sits at the plan's chosen azimuth
    let rotY = 0
    if (a.sunDir) {
      const raw = Math.atan2(a.sunDir.x, a.sunDir.z)
      rotY = THREE.MathUtils.degToRad(sunAzimuthDeg) - raw
    }
    this.rotationY = rotY
    const rot = new THREE.Euler(0, rotY, 0)
    this.scene.environmentRotation.copy(rot)
    this.scene.backgroundRotation.copy(rot)

    if (this.envRT) this.envRT.dispose()
    this.envRT = this.pmrem.fromEquirectangular(a.sunless)
    this.scene.environment = this.envRT.texture
    this.scene.background = a.original
    this.scene.environmentIntensity = preset.envScale
    this.scene.backgroundIntensity = preset.backgroundScale
    this.exposure = preset.exposure

    if (a.sunDir && preset.sunScale > 0) {
      const d = a.sunDir.clone().applyEuler(rot)
      // keep a readable shadow angle even when the captured sun is on the horizon
      const minEl = THREE.MathUtils.degToRad(preset.minElevation ?? 0)
      const el = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))
      if (el < minEl) {
        const h = Math.hypot(d.x, d.z)
        d.set((d.x / h) * Math.cos(minEl), Math.sin(minEl), (d.z / h) * Math.cos(minEl))
      }
      this.sunDir.copy(d.normalize())
      const e = a.sunE.clone().multiplyScalar(preset.sunScale)
      const m = Math.max(e.r, e.g, e.b)
      this.sunIntensity = m
      this.sunColor.setRGB(e.r / m, e.g / m, e.b / m)
      this.sun.color.copy(this.sunColor)
      this.sun.intensity = m
      this.sun.visible = true
    } else {
      this.sunIntensity = 0
      this.sun.intensity = 0
      this.sun.visible = false
    }
    this.placeSun(this.sunDir)
  }

  /**
   * The light-casting sky (sun removed) resampled into WORLD orientation and scaled like the scene's IBL, for the
   * offline lightmap bake: RGB floats, row 0 = zenith, column u = atan2(z, x) / 2pi + 0.5 (the three.js equirect
   * convention, which Blender's matches after its glTF axis conversion). Null before a sky is loaded.
   */
  worldSky(width = 1024, height = 512): Float32Array | null {
    const src = this.current?.sunless
    if (!src) return null
    const W0 = src.image.width
    const H0 = src.image.height
    const half = src.image.data as Uint16Array
    const raw = new Float32Array(half.length)
    for (let i = 0; i < half.length; i++) raw[i] = THREE.DataUtils.fromHalfFloat(half[i])
    const scale = this.scene.environmentIntensity
    const inv = new THREE.Matrix4().makeRotationY(-this.rotationY)
    const out = new Float32Array(width * height * 3)
    const d = new THREE.Vector3()
    const tap = (c: number, r: number, k: number) => raw[(r * W0 + (((c % W0) + W0) % W0)) * 4 + k]
    for (let j = 0; j < height; j++) {
      const lat = (0.5 - (j + 0.5) / height) * Math.PI
      for (let i = 0; i < width; i++) {
        const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2
        d.set(Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)).applyMatrix4(inv)
        // raw texel: row 0 = top (zenith), same mapping the sky texture uses
        const u = Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5
        const v = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI + 0.5
        const x = u * W0 - 0.5
        const y = THREE.MathUtils.clamp((1 - v) * H0 - 0.5, 0, H0 - 1)
        const x0 = Math.floor(x)
        const y0 = Math.floor(y)
        const fx = x - x0
        const fy = y - y0
        const y1 = Math.min(y0 + 1, H0 - 1)
        for (let k = 0; k < 3; k++) {
          const a = tap(x0, y0, k) * (1 - fx) + tap(x0 + 1, y0, k) * fx
          const b = tap(x0, y1, k) * (1 - fx) + tap(x0 + 1, y1, k) * fx
          out[(j * width + i) * 3 + k] = (a * (1 - fy) + b * fy) * scale
        }
      }
    }
    return out
  }

  /** The sky with the sun for the path tracer (sun as a soft 0.7 degree disk with the measured energy). */
  get originalHdri(): THREE.DataTexture | null {
    return this.current?.traced ?? null
  }

  dispose() {
    this.envRT?.dispose()
    this.pmrem.dispose()
  }
}
