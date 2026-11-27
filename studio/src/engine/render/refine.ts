import type { Texture } from 'three'
import type { Engine } from '../Engine'
import type { QualitySettings } from '../quality'
import type { PhotoTracer } from '../photo/tracer'

export const STILL_MS = 1000
const TIMEOUT_MS = 45_000

export type RefinementStatus = Readonly<{
  state: 'idle' | 'preparing' | 'rendering' | 'complete' | 'unavailable'
  samples: number
  target: number
  firstFrameMs?: number
  buildMs?: number
  triangles?: number
  pixels?: number
  atlasBytes?: number
  gpuBytes?: number
}>

export function refinementSizing(quality: QualitySettings, layers: number) {
  const { atlasBudget, pixelBudget } = quality.refinement
  const limit = Math.sqrt(atlasBudget / (4 * Math.max(1, layers)))
  const atlas = Math.max(16, Math.min(512, 2 ** Math.floor(Math.log2(limit))))
  return { atlas, atlasBytes: atlas * atlas * 4 * layers, pixels: pixelBudget }
}

export function refinementBlend(samples: number, photo: boolean) {
  // Delay most of the handoff until the traced highlights and indirect light have had time to settle.
  const t = Math.min(1, Math.max(0, (samples - 1) / (photo ? 12 : 14)))
  return 0.07 + 0.93 * t * t * (3 - 2 * t)
}

export class Refinement {
  private restAt = 0
  private wakeAt = 0
  private startedAt = 0
  private readyAt = 0
  private ready = false
  private begun = false
  private generation = 0
  private tracer?: PhotoTracer
  private depth?: Texture
  private image?: Texture
  private manual = false
  private photo = false
  private allowed = true
  private listeners = new Set<() => void>()
  auto: boolean
  status: RefinementStatus = { state: 'idle', samples: 0, target: 0 }

  constructor(private engine: Engine, auto: boolean) {
    this.auto = auto
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(status: RefinementStatus) {
    this.status = status
    this.listeners.forEach(listener => listener())
  }

  get isPhoto() { return this.photo }
  get requested() { return this.auto || this.manual }

  get supported() {
    const { renderer } = this.engine
    return typeof Worker !== 'undefined' && !renderer.getContext().isContextLost() &&
      renderer.extensions.has('EXT_color_buffer_float') && renderer.capabilities.maxTextureSize >= 4096
  }

  setAllowed(allowed: boolean) {
    if (allowed === this.allowed) return
    this.allowed = allowed
    const now = performance.now()
    if (allowed) this.restAt = now
    else this.interrupt(now)
  }

  request(photo: boolean, now: number) {
    this.interrupt(now)
    if (this.status.state === 'unavailable') this.publish({ state: 'idle', samples: 0, target: 0 })
    this.manual = true
    this.photo = photo
  }

  cameraActive(now: number) {
    if (this.manual && !this.begun) return
    this.interrupt(now)
  }

  interrupt(now: number) {
    if (!this.engine.autoRefinementCapable && (this.manual || this.tracer)) {
      this.release(now)
      return
    }
    this.resetView(now)
  }

  private resetView(now: number) {
    this.restAt = now
    this.manual = this.photo = this.begun = false
    this.depth = this.image = undefined
    if (this.status.state !== 'unavailable' && this.status.state !== 'idle') {
      this.publish({ state: 'idle', samples: 0, target: 0 })
    }
  }

  release(now: number) {
    this.generation++
    const tracer = this.tracer
    this.tracer = undefined
    this.ready = false
    this.readyAt = 0
    this.resetView(now)
    tracer?.dispose()
    this.engine.pipeline.releaseRefinementBuffers()
    if (this.status.state === 'unavailable') this.publish({ state: 'idle', samples: 0, target: 0 })
  }

  private fail(error: unknown, now: number) {
    this.release(now)
    this.publish({ state: 'unavailable', samples: 0, target: 0 })
    this.engine.invalidate()
    console.warn('Still rendering unavailable', error)
  }

  private async load(now: number) {
    const version = ++this.generation
    try {
      const { PhotoTracer: Tracer } = await import('../photo/tracer')
      if (version !== this.generation || this.status.state !== 'preparing') return
      const tracer = this.tracer = new Tracer(this.engine)
      await tracer.built
      if (version !== this.generation) return
      if (!this.engine.paused) this.engine.start()
    } catch (error) {
      if (version === this.generation) this.fail(error, now)
    }
  }

  /** Returns true while the engine should keep polling. Raster work always has priority. */
  frame(now: number, rasterReady: boolean) {
    if (!this.allowed || !this.requested ||
        this.status.state === 'unavailable' || this.status.state === 'complete') return false
    if (!this.restAt) this.restAt = now
    if (this.status.state === 'idle') {
      if (!this.manual && now - this.restAt < STILL_MS) return true
      if (!this.supported) {
        this.publish({ state: 'unavailable', samples: 0, target: 0 })
        return false
      }
      this.startedAt = now
      const { refinement } = this.engine.quality
      const target = this.photo ? refinement.photoSamples : refinement.samples
      this.publish({ state: 'preparing', samples: 0, target })
      if (!this.tracer && !this.ready) void this.load(now)
    }
    if (!this.ready) {
      try {
        this.ready = this.tracer?.uploadScene(this.engine.camera) ?? false
        if (this.ready) this.readyAt = performance.now()
      } catch (error) {
        this.fail(error, now)
        return false
      }
    }
    if (!this.ready || !rasterReady) {
      if (!this.ready && now - this.startedAt > TIMEOUT_MS) this.fail(new Error('Scene preparation timed out'), now)
      return true
    }
    const tracer = this.tracer!
    if (!this.begun) {
      tracer.begin(this.engine)
      this.begun = true
      this.wakeAt = now
    }
    try {
      const image = tracer.step()
      if (image) {
        this.depth ??= tracer.captureCoverage(this.engine.camera)
        this.image = image
        this.wakeAt = now
        this.draw(tracer.samples)
        const samples = tracer.samples
        const { target } = this.status
        this.publish({
          state: samples >= target ? 'complete' : 'rendering', samples, target,
          firstFrameMs: this.status.firstFrameMs ?? Math.round(performance.now() - this.startedAt),
          buildMs: this.status.buildMs ?? Math.max(0, Math.round(this.readyAt - this.startedAt)),
          triangles: tracer.triangles, pixels: tracer.pixels, atlasBytes: tracer.atlasBytes, gpuBytes: tracer.gpuBytes,
        })
        return samples < target
      }
      if (now - this.wakeAt > TIMEOUT_MS) this.fail(new Error('No full sample from the GPU'), now)
    } catch (error) {
      this.fail(error, now)
    }
    return true
  }

  private draw(samples: number) {
    return this.engine.pipeline.renderRefinement(
      this.image!, this.depth!, refinementBlend(samples, this.photo), samples,
      this.engine.isInside(this.engine.camera.position), this.engine.sky.preset.id,
    )
  }

  capture() {
    // preserveDrawingBuffer is off. Repaint and read the canvas in the same browser task.
    const pixels = this.image && this.depth ? this.draw(this.status.samples) : this.engine.pipeline.renderStill()
    return pixels ? this.engine.renderer.domElement.toDataURL('image/jpeg', 0.92) : undefined
  }
}
