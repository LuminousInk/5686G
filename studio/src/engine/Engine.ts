import * as THREE from 'three'
import { applyLightmap, clearLightmap, roomIrradiance } from './bake/lightmaps'
import { buildHouse, type HouseModel } from './house/build'
import { framePoint, inRect, levelFloor } from './house/levels'
import { roofHeightAt } from './house/massing'
import type { HomePlan } from './house/types'
import { MaterialLibrary } from './materials/library'
import { SkyEnvironment, TIME_PRESETS } from './env/environment'
import { exposureFor } from './render/meter'
import { RenderPipeline } from './render/pipeline'
import { detectTier, TIERS, type QualitySettings } from './quality'
import { Site } from './site/site'
import { NightLights } from './env/lights'
import { Interior } from './interior/interior'
import { setModelQuality } from './models'

export interface EngineOptions {
  canvas: HTMLCanvasElement
  onProgress?: (p: number, label: string) => void
}

export type FrameHook = (dt: number) => void

/**
 * Owns the renderer, scene, camera, materials, sky and post pipeline, and renders on demand: while the camera
 * moves it renders every frame; when it stops, frames accumulate (soft shadows, AA, AO) until converged, then the
 * loop idles until something changes.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly quality: QualitySettings
  readonly lib: MaterialLibrary
  readonly sky: SkyEnvironment
  readonly pipeline: RenderPipeline
  readonly lights: NightLights
  house: HouseModel | null = null
  site: Site | null = null
  interior: Interior | null = null
  plan: HomePlan | null = null
  private raf = 0
  private last = performance.now()
  private lastView = new THREE.Matrix4()
  private lastProj = new THREE.Matrix4()
  private dirty = true
  private width = 1
  private height = 1
  private hooks = new Set<FrameHook>()
  /** seconds of animated time (wind); paused while accumulating so still frames converge */
  time = 0
  private frameTimes: number[] = []
  dpr = 1
  private dprTarget = 1
  stats = { fps: 0, frames: 0, triangles: 0, calls: 0 }
  paused = false
  /** when true the engine keeps rendering live (wind animates) instead of converging */
  liveMotion = false
  private sunTmp = new THREE.Vector3()
  onRendered?: () => void
  /** keep rendering while this returns true (held keys, joystick, tweens) */
  keepAlive?: () => boolean
  /** eye adaptation: exposure multiplier eases toward 1 outside, toward the light meter's reading inside */
  private adapt = 1
  private meterAt = -1e9
  private meterSerial = -1
  private meteredStill = false
  private snapExposure = true
  private snapPending = false
  private lastCamPos = new THREE.Vector3()
  /** absolute exposure the light meter asks for (0 until the first reading) */
  private metered = 0
  dollhouse = false

  constructor(private opts: EngineOptions) {
    this.quality = TIERS[detectTier()]
    setModelQuality(this.quality.tier === 'low')
    const renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.transmissionResolutionScale = this.quality.tier === 'low' ? 0.5 : 0.75
    this.renderer = renderer
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.08, 2000)
    this.camera.position.set(0, 1.6, 20)
    this.lib = new MaterialLibrary(renderer, this.quality)
    this.sky = new SkyEnvironment(renderer, this.scene, this.quality)
    this.pipeline = new RenderPipeline(renderer, this.scene, this.camera, this.quality)
    this.lights = new NightLights(this.scene, this.quality)
    this.dpr = this.dprTarget = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio)
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w))
    this.height = Math.max(1, Math.floor(h))
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this.pipeline.setSize(this.width, this.height)
    this.invalidate()
  }

  /** Something in the scene changed: restart accumulation. */
  invalidate() {
    this.dirty = true
    this.pipeline.reset()
    if (!this.raf && !this.paused) this.start()
  }

  addHook(h: FrameHook) {
    this.hooks.add(h)
    return () => this.hooks.delete(h)
  }

  async loadPlan(plan: HomePlan, finishes: Record<string, string>, timeId = 'golden') {
    this.loading = true
    try {
      await this.loadPlanInner(plan, finishes, timeId)
    } finally {
      this.loading = false
    }
  }

  private async loadPlanInner(plan: HomePlan, finishes: Record<string, string>, timeId: string) {
    const progress = this.opts.onProgress ?? (() => {})
    progress(0.05, 'Building the house')
    if (this.house) {
      this.scene.remove(this.house.group)
      this.house.dispose()
    }
    if (this.site) {
      this.scene.remove(this.site.group)
      this.site.dispose()
    }
    if (this.interior) {
      this.scene.remove(this.interior.group)
      this.interior.dispose()
    }
    this.plan = plan
    for (const [zone, opt] of Object.entries(finishes)) {
      if (zone === 'palette') this.lib.setPalette(opt)
      else this.lib.setFinish(zone, opt)
    }
    // touch zone materials so finishes apply before geometry exists
    for (const z of plan.zones) if (z !== 'palette') this.lib.setFinish(z, finishes[z] ?? plan.finishes[z])
    this.house = buildHouse(plan, this.lib)
    this.scene.add(this.house.group)
    progress(0.25, 'Landscaping')
    this.site = new Site(this.lib, this.quality, this.renderer)
    await this.site.build(plan, this.house)
    this.scene.add(this.site.group)
    progress(0.55, 'Furnishing')
    this.interior = new Interior(this.lib, this.quality)
    await this.interior.build(plan, this.house)
    this.scene.add(this.interior.group)
    // re-apply finishes for materials created during build
    for (const [zone, opt] of Object.entries(finishes)) if (zone !== 'palette') this.lib.setFinish(zone, opt)
    this.lib.setPalette(finishes.palette ?? plan.finishes.palette ?? 'light')
    progress(0.75, 'Lighting')
    const box = this.house.bounds.clone().expandByScalar(9)
    this.sky.fitShadow(box)
    await this.setTime(timeId)
    progress(0.9, 'Loading textures')
    await this.lib.bank.ready()
    await this.refreshLightmap()
    this.lights.setup(this.house, this.interior)
    this.lights.setLevel(this.sky.preset.lamps)
    this.lib.setLamps(this.sky.preset.lamps)
    this.captureProbe()
    this.compile()
    progress(1, 'Ready')
    this.invalidate()
  }

  private probeRT: THREE.WebGLRenderTarget | null = null
  private cubeRT: THREE.WebGLCubeRenderTarget | null = null
  private pmrem: THREE.PMREMGenerator | null = null

  /**
   * Interior light probe: a 360 capture from inside the main room, after the sun and sky have lit it, becomes the
   * environment light of every interior surface. Gives warm bounce light, real reflections on floors and dark,
   * believable rooms behind glass. Two passes approximate a second bounce.
   */
  captureProbe() {
    const plan = this.plan
    if (!plan) return
    const room = plan.rooms.find(r => r.type === 'living') ?? plan.rooms[0]
    if (!room) return
    const cx = (room.rect[0] + room.rect[2]) / 2
    const cz = (room.rect[1] + room.rect[3]) / 2
    if (!this.cubeRT) this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false })
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer)
    const cam = new THREE.CubeCamera(0.05, 400, this.cubeRT)
    cam.position.set(cx, levelFloor(plan, room.level) + 1.45, cz)
    const prevTarget = this.renderer.getRenderTarget()
    // exterior surfaces must not be hidden; lawn rings follow the main camera so keep them as they are
    this.lib.interiorEnv(0.3, null)
    for (let pass = 0; pass < 2; pass++) {
      cam.update(this.renderer, this.scene)
      this.probeRT?.dispose()
      this.probeRT = this.pmrem.fromCubemap(this.cubeRT.texture)
      this.lib.interiorEnv(1.0, this.probeRT.texture)
    }
    this.renderer.setRenderTarget(prevTarget)
  }

  private rebuildSeq = 0
  /**
   * Rebuild only the house (and its interior, lights, lawn mask) after a plan edit. The landscape, trees and sky
   * stay as they are, so edits update in a fraction of a second.
   */
  async rebuildHouse(plan: HomePlan) {
    const seq = ++this.rebuildSeq
    const house = buildHouse(plan, this.lib)
    const interior = new Interior(this.lib, this.quality)
    await interior.build(plan, house)
    if (seq !== this.rebuildSeq) {
      house.dispose()
      interior.dispose()
      return
    }
    if (this.house) {
      this.scene.remove(this.house.group)
      this.house.dispose()
    }
    if (this.interior) {
      this.scene.remove(this.interior.group)
      this.interior.dispose()
    }
    this.plan = plan
    this.house = house
    this.interior = interior
    this.lightmapped = false
    clearLightmap(this.lib)
    this.scene.add(house.group, interior.group)
    for (const z of plan.zones) if (z !== 'palette') this.lib.setFinish(z, this.lib.currentFinish(z) ?? plan.finishes[z])
    this.lights.setup(house, interior)
    this.lights.setLevel(this.sky.preset.lamps)
    this.site?.updateFootprint(plan, house)
    clearTimeout(this.probeTimer)
    this.probeTimer = window.setTimeout(() => {
      this.captureProbe()
      this.invalidate()
    }, 400)
    this.invalidate()
  }
  private probeTimer = 0

  /** Pre-compile shaders so the first interaction doesn't hitch. */
  compile() {
    try {
      this.renderer.compile(this.scene, this.camera)
    } catch {
      /* not fatal */
    }
  }

  /** True while the bound home has baked lighting for the current time of day. */
  lightmapped = false
  private loading = false

  /** Bind (or drop) the baked lightmap for the current plan and time of day. */
  async refreshLightmap() {
    if (!this.house || !this.plan) return
    // an edited plan has other geometry: its signature will not match the bake and it keeps live lighting
    this.lightmapped = await applyLightmap(this.lib, this.house, this.interior?.group ?? null, this.plan.id, this.sky.preset.id, this.quality.tier === 'low')
  }

  async setTime(id: string) {
    const preset = TIME_PRESETS.find(t => t.id === id) ?? TIME_PRESETS[0]
    await this.sky.setPreset(preset, this.plan?.sunAzimuth ?? -35)
    this.pipeline.exposure = this.sky.exposure
    this.pipeline.bloom.intensity = preset.bloom
    this.lights.setLevel(preset.lamps)
    this.lib.setLamps(preset.lamps)
    this.site?.setTime(preset)
    const g = this.pipeline.grade
    if (id === 'golden') g.set(0.24, 1.1, 0.03)
    else if (id === 'day') g.set(0.18, 1.06, 0.0)
    else if (id === 'dusk') g.set(0.2, 1.08, 0.02)
    else g.set(0.22, 1.0, -0.01)
    if (this.house && !this.loading) await this.refreshLightmap()
    if (this.house) this.captureProbe()
    this.invalidate()
  }

  /** Interior exposure boost by day; with baked light it follows the metered brightness of the current room. */
  static readonly INSIDE_BOOST = 2.35
  private insideExposure(): number {
    if (this.sky.preset.lamps > 0.5) return 1.0
    if (!this.lightmapped || !this.house || !this.plan) return Engine.INSIDE_BOOST
    const light = roomIrradiance(this.house)
    if (!light.size) return Engine.INSIDE_BOOST
    const { x, z } = this.camera.position
    const room = this.plan.rooms.find(r => x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3])
    const e = room ? light.get(room.id) : undefined
    if (!e) return Engine.INSIDE_BOOST
    // the plan's median room keeps the tuned boost; darker rooms (facing away from the sun) open up most of the way,
    // like a camera's auto exposure, so they read as dimmer but never murky
    const all = [...light.values()].sort((a, b) => a - b)
    const median = all[all.length >> 1]
    return THREE.MathUtils.clamp(Engine.INSIDE_BOOST * Math.pow(median / e, 0.85), 1, 8)
  }

  isInside(p: THREE.Vector3) {
    const plan = this.plan
    if (!plan || this.dollhouse) return false
    for (const b of plan.blocks) {
      const [x, z] = framePoint(b, p.x, p.z, true)
      const y = levelFloor(plan, b.level)
      if (inRect(b.rect, x, z, 0.1) && p.y >= y && p.y < y + (plan.levels ? roofHeightAt(b, x, z) : 4.5)) return true
    }
    return false
  }

  setDollhouse(on: boolean) {
    this.dollhouse = on
    this.invalidate()
  }

  setFinish(zone: string, option: string) {
    if (zone === 'palette') this.lib.setPalette(option)
    else this.lib.setFinish(zone, option)
    if (zone === 'palette') this.captureProbe()
    this.invalidate()
  }

  start() {
    if (this.raf) return
    this.last = performance.now()
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop)
      this.frame(t)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000)
    this.last = t
    for (const h of this.hooks) h(dt)
    this.camera.clearViewOffset()
    this.camera.updateMatrixWorld()
    const moved = !this.camera.matrixWorld.equals(this.lastView) || !this.camera.projectionMatrix.equals(this.lastProj)
    if (moved) {
      this.lastView.copy(this.camera.matrixWorld)
      this.lastProj.copy(this.camera.projectionMatrix)
    }
    // a finish or time change re-meters the view like a camera move does
    if (this.dirty) this.meteredStill = false
    if (moved || this.dirty || this.liveMotion) {
      this.pipeline.reset()
      this.dirty = false
      this.time += dt
    } else if (this.pipeline.converged && !this.keepAlive?.()) {
      // idle: nothing to draw until something changes
      this.stop()
      return
    }
    // eye adaptation: inside, a camera-style light meter on the rendered frame sets the exposure (see render/meter.ts);
    // outside keeps each time of day's tuned exposure. Readings are taken while the camera moves and once when it
    // stops, and only a change of more than 10% is acted on, so a still view settles and stops rendering.
    // a jump (view button, room tap) snaps to the next reading instead of easing in from the last room
    if (this.camera.position.distanceToSquared(this.lastCamPos) > 1) this.snapExposure = true
    this.lastCamPos.copy(this.camera.position)
    if (moved) {
      this.meteredStill = false
      if (t - this.meterAt > 120) {
        this.pipeline.requestMeter()
        this.meterAt = t
      }
    } else if (!this.meteredStill) {
      this.meteredStill = true
      this.pipeline.requestMeter()
      this.meterAt = t
    }
    const meter = this.pipeline.meter
    if (meter.last && meter.serial !== this.meterSerial) {
      this.meterSerial = meter.serial
      const e = exposureFor(meter.last, 0.3 - 0.14 * this.sky.preset.lamps)
      if (!(this.metered > 0) || Math.abs(Math.log(e / this.metered)) > 0.1) this.metered = e
      if (this.snapExposure) {
        this.snapExposure = false
        this.snapPending = true
      }
    }
    const inside = this.isInside(this.camera.position)
    let want = 1
    if (inside) want = this.metered > 0 && meter.supported ? THREE.MathUtils.clamp(this.metered / this.sky.exposure, 0.35, 120) : this.insideExposure()
    if (this.snapPending) {
      this.snapPending = false
      this.adapt = want
      this.pipeline.reset()
    }
    const d = Math.log(want / this.adapt)
    if (Math.abs(d) > 0.02) {
      this.adapt *= Math.exp(d * Math.min(1, dt * 3))
      this.pipeline.reset()
    } else if (d !== 0) {
      // close enough: snap once, then hold still
      this.adapt = want
      this.pipeline.reset()
    }
    this.pipeline.exposure = this.sky.exposure * this.adapt
    const accumulating = this.pipeline.frames > 0
    // adaptive resolution: lower while moving, full when still
    this.trackPerf(dt, accumulating)
    this.site?.update(this.time, this.camera)
    this.pipeline.jitter(this.width * this.dpr, this.height * this.dpr)
    if (this.sky.sun.visible) {
      this.pipeline.sunSample(this.sky.sunDir, THREE.MathUtils.degToRad(0.55), this.sunTmp)
      this.sky.placeSun(this.sunTmp)
    }
    this.pipeline.render(dt)
    this.camera.clearViewOffset()
    const info = this.renderer.info.render
    this.stats.triangles = info.triangles
    this.stats.calls = info.calls
    this.stats.frames = this.pipeline.frames
    this.onRendered?.()
  }

  private trackPerf(dt: number, accumulating: boolean) {
    if (accumulating) return
    this.frameTimes.push(dt)
    if (this.frameTimes.length < 20) return
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
    this.frameTimes.length = 0
    this.stats.fps = Math.round(1 / avg)
    const max = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio)
    let next = this.dprTarget
    if (avg > 1 / 28) next = Math.max(0.6, this.dprTarget * 0.85)
    else if (avg < 1 / 50) next = Math.min(max, this.dprTarget * 1.1)
    if (Math.abs(next - this.dprTarget) > 0.04) {
      this.dprTarget = next
      this.dpr = next
      this.renderer.setPixelRatio(this.dpr)
      this.renderer.setSize(this.width, this.height, false)
      this.pipeline.setSize(this.width, this.height)
    }
  }

  dispose() {
    this.stop()
    this.pipeline.dispose()
    this.sky.dispose()
    this.renderer.dispose()
  }
}
