import * as THREE from 'three'
import { LightmapBinding } from './bake/lightmaps'
import { buildHouse, type HouseModel } from './house/build'
import { framePoint, inRect, levelFloor } from './house/levels'
import { roofHeightAt } from './house/massing'
import type { CameraView, HomePlan } from './house/types'
import { MaterialLibrary } from './materials/library'
import { AssetPriority, yieldToBrowser } from './materials/textures'
import { SkyEnvironment, TIME_PRESETS } from './env/environment'
import { exposureFor } from './render/meter'
import { anchoredExposure, interiorExposureWeight, roomExposureEV } from './render/exposureAnchors'
import { RoomProbes } from './env/roomProbes'
import { roomVolumes, type RoomVolume } from './env/roomVolumes'
import { RenderPipeline } from './render/pipeline'
import { detectTier, TIERS, type QualitySettings } from './quality'
import { Site } from './site/site'
import { NightLights } from './env/lights'
import { Interior } from './interior/interior'
import { prioritizeModels, setModelQuality } from './models'

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
  private meterAt = -Infinity
  private meterSerial = 0
  private meteredStill = false
  private meterView = 0
  private meterRequestView = 0
  private lastCamPos = new THREE.Vector3()
  /** absolute exposure the light meter asks for (0 until the first reading) */
  private metered = 0
  private readonly probes: RoomProbes
  private readonly lightmap = new LightmapBinding()
  private exposureRooms: RoomVolume[] = []
  private timeSeq = 0
  private finishSeq = 0
  dollhouse = false

  constructor(private opts: EngineOptions) {
    this.quality = TIERS[detectTier()]
    setModelQuality(this.quality.tier === 'low')
    // Shared site images use Three's built-in loaders. Keep those images across plan changes too.
    THREE.Cache.enabled = true
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
    this.probes = new RoomProbes(renderer, this.quality.tier === 'low')
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.08, 2000)
    this.camera.position.set(0, 1.6, 20)
    this.lib = new MaterialLibrary(renderer, this.quality)
    this.sky = new SkyEnvironment(renderer, this.scene, this.quality)
    this.pipeline = new RenderPipeline(renderer, this.scene, this.camera, this.quality)
    const toneMapping = new URLSearchParams(location.search).get('tm')
    if (toneMapping) this.pipeline.setToneMapping(toneMapping)
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

  async loadPlan(
    plan: HomePlan,
    finishes: Record<string, string>,
    timeId = 'golden',
    view?: CameraView,
    pauseForBrowsing = yieldToBrowser,
  ) {
    this.loading = true
    const resetPriority = prioritizeModels(plan, view)
    try {
      await this.loadPlanInner(plan, finishes, timeId, pauseForBrowsing)
    } finally {
      resetPriority()
      this.lib.bank.priority = AssetPriority.rest
      this.loading = false
    }
  }

  private async loadPlanInner(plan: HomePlan, finishes: Record<string, string>, timeId: string, pauseForBrowsing: () => Promise<void>) {
    const progress = this.opts.onProgress ?? (() => {})
    this.lib.bank.priority = AssetPriority.shell
    progress(0.05, 'Building the house')
    this.lightmap.clear()
    this.probes.clear()
    this.exposureRooms = []
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
    this.lib.bank.priority = AssetPriority.rest
    const preset = TIME_PRESETS.find(t => t.id === timeId) ?? TIME_PRESETS[0]
    const house = this.house
    const interior = this.interior = new Interior(this.lib, this.quality)
    const site = this.site = new Site(this.lib, this.quality, this.renderer)
    progress(0.25, 'Loading the rooms and gardens')
    const furnish = pauseForBrowsing().then(() => interior.build(plan, house))
    const landscape = pauseForBrowsing().then(async () => {
      await yieldToBrowser()
      await site.build(plan, house)
    })
    const build = await Promise.allSettled([
      this.sky.prepare(preset),
      furnish,
      landscape,
    ])
    for (const result of build) if (result.status === 'rejected') throw result.reason
    this.scene.add(site.group, interior.group)
    // re-apply finishes for materials created during build
    for (const [zone, opt] of Object.entries(finishes)) if (zone !== 'palette') this.lib.setFinish(zone, opt)
    this.lib.setPalette(finishes.palette ?? plan.finishes.palette ?? 'light')
    progress(0.75, 'Lighting')
    await pauseForBrowsing()
    const box = this.house.bounds.clone().expandByScalar(9)
    this.sky.fitShadow(box)
    await this.setTime(timeId)
    progress(0.9, 'Loading textures')
    await this.lib.bank.ready()
    this.updateLightingRooms()
    await this.refreshLightmap()
    await pauseForBrowsing()
    this.lights.setup(this.house, this.interior)
    this.lights.setLevel(this.sky.preset.lamps)
    this.lib.setLamps(this.sky.preset.lamps)
    this.probes.reset()
    this.invalidate()
  }

  get probeRooms() { return this.probes.readyRooms }
  get probesPending() { return this.probes.pending }

  private updateLightingRooms() {
    if (!this.house) return
    this.exposureRooms = roomVolumes(this.house.plan)
    this.probes.setHouse(this.house, this.interior?.group ?? null, this.lib)
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
    this.lightmap.clear()
    this.probes.clear()
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
    this.scene.add(house.group, interior.group)
    for (const z of plan.zones) if (z !== 'palette') this.lib.setFinish(z, this.lib.currentFinish(z) ?? plan.finishes[z])
    this.lights.setup(house, interior)
    this.lights.setLevel(this.sky.preset.lamps)
    this.site?.updateFootprint(plan, house)
    this.sky.setMotionShadowRegion(house.bounds.clone().expandByScalar(9))
    this.pipeline.resetMotion()
    this.updateLightingRooms()
    this.invalidate()
    await this.refreshLightmap()
    if (seq !== this.rebuildSeq || this.house !== house) return
    this.probes.reset(180)
    this.invalidate()
  }

  /** Warm shaders for the same target the first frame uses. */
  async prepareFrame() {
    const previous = this.renderer.getRenderTarget()
    try {
      this.renderer.setRenderTarget(this.pipeline.composer.inputBuffer)
      const compiled = this.renderer.compileAsync(this.scene, this.camera)
      this.renderer.setRenderTarget(previous)
      await compiled
    } catch {
      this.renderer.setRenderTarget(previous)
    }
  }

  /** Diagnostics for the active plan and preset, available on window.__engine. */
  get lightmapStatus() { return this.lightmap.status }
  get lightmapped() { return this.lightmapStatus.state === 'bound' }
  private loading = false

  async refreshLightmap() {
    if (!this.house || !this.plan) return
    await this.lightmap.apply(this.house, this.interior?.group ?? null, this.site, this.sky.preset, this.quality.tier === 'low')
    if (this.house) {
      this.probes.prepareMaterials(this.house, this.interior?.group ?? null, this.lib)
      this.house.cutaway.syncBindings()
    }
    this.pipeline.resetMotion()
  }

  async setTime(id: string) {
    const seq = ++this.timeSeq
    const preset = TIME_PRESETS.find(t => t.id === id) ?? TIME_PRESETS[0]
    this.lightmap.clear('time of day changed')
    this.house?.cutaway.syncBindings()
    if (!await this.sky.setPreset(preset, this.plan?.sunAzimuth ?? -35) || seq !== this.timeSeq) return
    this.pipeline.exposure = this.sky.exposure
    this.pipeline.setLook(preset)
    this.pipeline.resetMotion()
    this.lights.setLevel(preset.lamps)
    this.lib.setLamps(preset.lamps)
    this.site?.setTime(preset)
    this.resetMeter()
    if (this.house && !this.loading) {
      this.probes.suspend()
      this.invalidate()
      await this.refreshLightmap()
      if (seq !== this.timeSeq) return
      this.probes.reset()
    }
    this.invalidate()
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

  setDollhouseSection(floor: number | undefined, cut: boolean, target: THREE.Vector3) {
    const house = this.house
    if (!house) return
    if (house.cutaway.update(floor, cut, this.camera.position, target)) {
      this.sky.sun.shadow.needsUpdate = true
      this.invalidate()
    }
    if (this.interior) house.cutaway.syncFurniture(this.interior.group, floor)
  }

  setDollhouse(on: boolean) {
    this.dollhouse = on
    this.sky.sun.shadow.needsUpdate = true
    this.pipeline.resetMotion()
    this.invalidate()
  }

  setFinish(zone: string, option: string) {
    if (zone === 'palette') this.lib.setPalette(option)
    else this.lib.setFinish(zone, option)
    this.lightmap.syncMaterials()
    this.pipeline.resetMotion()
    const finish = ++this.finishSeq
    const house = this.house
    void this.lib.bank.ready().then(() => {
      if (finish !== this.finishSeq || this.house !== house) return
      this.probes.reset(180, true)
      this.sky.sun.shadow.needsUpdate = true
      this.pipeline.resetMotion()
      this.invalidate()
    })
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

  private resetMeter() {
    this.metered = 0
    this.meterAt = -Infinity
    this.meterView++
  }

  private frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000)
    this.last = t
    for (const h of this.hooks) h(dt)
    this.camera.clearViewOffset()
    this.camera.updateMatrixWorld()
    // Ignore subpixel drift from camera easing so a stationary view can finish accumulating.
    const moved = this.camera.matrixWorld.elements.some((v, i) => Math.abs(v - this.lastView.elements[i]) > 0.0001)
      || this.camera.projectionMatrix.elements.some((v, i) => Math.abs(v - this.lastProj.elements[i]) > 0.0001)
    if (moved) {
      this.lastView.copy(this.camera.matrixWorld)
      this.lastProj.copy(this.camera.projectionMatrix)
    }
    if (this.probes.pending && !this.dollhouse && !moved && !this.keepAlive?.() && !this.liveMotion) {
      this.sky.placeSun(this.sky.sunDir)
      if (this.probes.step(t, this.scene, this.camera)) this.dirty = true
    }
    const active = moved || this.dirty || this.liveMotion
    const interiorWeight = this.plan && !this.dollhouse ? interiorExposureWeight(this.plan, this.camera.position) : 0
    const inside = interiorWeight > 0.045
    const jumped = this.camera.position.distanceToSquared(this.lastCamPos) > 1
    if (jumped) this.pipeline.resetMotion()
    if (!inside || jumped || (this.dirty && !moved)) this.resetMeter()
    this.lastCamPos.copy(this.camera.position)
    if (active) {
      this.meteredStill = false
      this.pipeline.reset()
      this.dirty = false
      this.time += dt
    }
    const meter = this.pipeline.meter
    if (meter.last && meter.serial !== this.meterSerial) {
      this.meterSerial = meter.serial
      if (inside && this.meterRequestView === this.meterView) {
        const key = 0.25 - 0.105 * this.sky.preset.lamps
        const exposure = exposureFor(meter.last, key, this.sky.exposure)
        if (!active || !this.metered || Math.abs(Math.log(exposure / this.metered)) > 0.08) this.metered = exposure
      }
    }
    const bias = this.plan ? roomExposureEV(this.plan.id, this.exposureRooms, this.camera.position) : 0
    const base = this.sky.preset.lamps > 0.5 ? 1 : 2.35
    const measured = meter.supported ? this.metered / this.sky.exposure : 0
    const want = anchoredExposure(measured, base, bias, interiorWeight)
    const d = Math.log(want / this.adapt)
    const next = !jumped && Math.abs(d) > 0.015 ? this.adapt * Math.exp(d * Math.min(1, dt * 5)) : want
    if (this.adapt !== next) {
      this.adapt = next
      this.pipeline.reset()
    }
    // Read a final frame at rest. If an earlier read is in flight, leave it time to finish before requesting again.
    const requestMeter = inside && meter.supported && !meter.pending && (active ? t - this.meterAt > 120 : !this.meteredStill)
    if (requestMeter) {
      this.meterAt = t
      this.meterRequestView = this.meterView
      this.meteredStill = !active
      this.pipeline.requestMeter()
    }
    this.trackPerf(dt, this.pipeline.frames > 0)
    const moving = moved && this.pipeline.maxFrames > 0
    const temporal = moving && this.dpr >= this.quality.temporalMinDpr
    this.pipeline.prepareMotion(moving, temporal, this.lightmapped ? interiorWeight : 0)
    if (!requestMeter && !active && this.pipeline.converged && !this.keepAlive?.()) {
      // Wait for a pending exposure read without drawing extra frames.
      if ((!inside || !meter.pending) && (!this.probes.pending || this.dollhouse || this.liveMotion)) this.stop()
      return
    }
    this.pipeline.exposure = this.sky.exposure * this.adapt
    this.site?.update(this.time, this.camera, moving)
    this.pipeline.jitter(this.width * this.dpr, this.height * this.dpr)
    const cacheShadows = moving && this.sky.sun.visible
    if (cacheShadows) {
      this.sky.beginMotionShadows(this.liveMotion)
    } else if (this.sky.sun.visible) {
      this.pipeline.sunSample(this.sky.sunDir, THREE.MathUtils.degToRad(this.sky.preset.sunRadius), this.sunTmp)
      this.sky.placeSun(this.sunTmp)
    }
    try {
      this.pipeline.render(dt)
    } finally {
      if (cacheShadows) this.sky.endMotionShadows()
      this.camera.clearViewOffset()
    }
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
    this.timeSeq++
    this.finishSeq++
    this.stop()
    this.lightmap.clear()
    this.probes.dispose()
    this.pipeline.dispose()
    this.sky.dispose()
    this.renderer.dispose()
  }
}
