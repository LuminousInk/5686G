import * as THREE from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import { preparePhotoScene } from './scene'
import { PhotoBVHWorker } from './worker'
import type { Engine } from '../Engine'
import { refinementSizing } from '../render/refine'

interface Disposable { dispose(): void }

interface PathRenderer extends Disposable {
  alpha: boolean
  _blendTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  _blendQuad: { material: THREE.Material }
  material: THREE.ShaderMaterial & { onBeforeRender(): void }
}

// The pinned WebGL release doesn't dispose its shader uniforms or its auxiliary renderer. Its public
// target also always points at the same ping-pong slot, even when the other slot was just written.
type SceneBuild = Awaited<ReturnType<PhotoBVHWorker['generate']>>
function internals(tracer: WebGLPathTracer) {
  return tracer as WebGLPathTracer & {
    _pathTracer: PathRenderer
    _lowResPathTracer: PathRenderer
    _updateFromResults(scene: THREE.Scene, camera: THREE.Camera, result: SceneBuild): void
  }
}

function releaseMaterial({ material, _blendQuad }: PathRenderer) {
  const u = material.uniforms
  for (const name of ['bvh', 'attributesArray', 'materialIndexAttribute', 'materials', 'envMapInfo',
    'stratifiedTexture', 'stratifiedOffsetTexture']) {
    (u[name]?.value as Disposable | undefined)?.dispose()
  }
  u.lights?.value.tex?.dispose()
  u.textures?.value.renderTarget?.dispose()
  u.iesProfiles?.value.renderTarget?.dispose()
  material.dispose()
  _blendQuad.material.dispose()
}

export class PhotoTracer {
  private renderer: THREE.WebGLRenderer
  private gl: WebGL2RenderingContext
  private tracer: WebGLPathTracer
  private snapshot: ReturnType<typeof preparePhotoScene>
  private worker: PhotoBVHWorker
  private pending: WebGLSync | null = null
  private size = new THREE.Vector2()
  private depthMaterial = new THREE.MeshDepthMaterial({ colorWrite: false, side: THREE.DoubleSide })
  private coverage = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  })
  private released = false
  private sceneBuild?: SceneBuild
  private uploaded = false
  readonly atlasBytes: number
  private dataBytes = 0
  readonly built: Promise<void>

  constructor(engine: Engine) {
    this.renderer = engine.renderer
    this.gl = this.renderer.getContext() as WebGL2RenderingContext
    this.snapshot = preparePhotoScene(engine)
    const layerLimit = this.gl.getParameter(this.gl.MAX_ARRAY_TEXTURE_LAYERS) as number
    if (this.snapshot.textureLayers > layerLimit || this.snapshot.triangles > 2_000_000) {
      this.snapshot.dispose()
      throw new Error('The traceable geometry or material set exceeds the still renderer budget')
    }
    this.tracer = new WebGLPathTracer(this.renderer)
    const path = internals(this.tracer)._pathTracer
    path.alpha = true
    if (this.renderer.extensions.has('OES_texture_float_linear')) {
      for (const target of path._blendTargets) target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter
    }
    path.material.onBeforeRender()
    this.tracer.renderToCanvas = false
    this.tracer.rasterizeScene = false
    this.tracer.renderDelay = 0
    this.tracer.bounces = engine.quality.tier === 'low' ? 4 : 6
    this.tracer.transmissiveBounces = 4
    this.tracer.filterGlossyFactor = 0.55
    this.tracer.tiles.set(2, 2)
    const { atlas, atlasBytes } = refinementSizing(engine.quality, this.snapshot.textureLayers)
    this.tracer.textureSize.setScalar(atlas)
    this.atlasBytes = atlasBytes
    this.worker = new PhotoBVHWorker()
    this.built = this.worker.generate(this.snapshot.scene).then(result => {
      if (!this.released) this.sceneBuild = result
    })
  }

  get samples() { return this.tracer.samples }
  get triangles() { return this.snapshot.triangles }
  get pixels() { return this.tracer.target.width * this.tracer.target.height }

  uploadScene(camera: THREE.PerspectiveCamera) {
    if (this.uploaded) return true
    const result = this.sceneBuild
    if (!result) return false
    this.sceneBuild = undefined
    this.snapshot.scene.updateMatrixWorld(true)
    internals(this.tracer)._updateFromResults(this.snapshot.scene, camera, result)
    const u = internals(this.tracer)._pathTracer.material.uniforms
    const bvh = u.bvh.value
    const env = u.envMapInfo.value
    const textures: THREE.Texture[] = [bvh.index, bvh.position, bvh.bvhBounds, bvh.bvhContents,
      u.attributesArray.value, u.materialIndexAttribute.value, u.materials.value,
      env.map, env.marginalWeights, env.conditionalWeights, u.lights.value.tex]
    this.dataBytes = textures.reduce((bytes, t) => bytes + ((t?.image as { data?: ArrayBufferView } | undefined)?.data?.byteLength ?? 0), 0)
    this.uploaded = true
    return true
  }

  get gpuBytes() {
    // Three RGBA32F accumulation surfaces, two RGBA16F filter surfaces and color/depth coverage. This excludes
    // driver padding and the raster buffers that were already live before refinement.
    return this.atlasBytes + this.dataBytes + this.pixels * (3 * 16 + 2 * 8 + 8)
  }

  begin(engine: Engine) {
    const size = this.renderer.getDrawingBufferSize(this.size)
    const { pixels } = refinementSizing(engine.quality, this.snapshot.textureLayers)
    this.tracer.renderScale = Math.min(1, Math.sqrt(pixels / (size.x * size.y)))
    // Each submitted tile must finish before another is queued. Retain an in-flight fence across camera changes.
    this.tracer.setCamera(engine.camera)
  }

  /** A single bounded tile. Publish only complete, GPU-finished images. */
  step() {
    if (this.pending) {
      const result = this.gl.clientWaitSync(this.pending, 0, 0)
      if (result === this.gl.TIMEOUT_EXPIRED) return null
      this.gl.deleteSync(this.pending)
      this.pending = null
      if (result === this.gl.WAIT_FAILED) throw new Error('Path tracing GPU work was interrupted')
      if (Number.isInteger(this.samples) && this.samples > 0) {
        const index = this.samples % 2
        return internals(this.tracer)._pathTracer._blendTargets[index].texture
      }
    }
    const samples = this.samples
    this.tracer.renderSample()
    if (this.samples !== samples) {
      this.pending = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      if (!this.pending) throw new Error('Could not fence the path tracing tile')
      this.gl.flush()
    }
    return null
  }

  /** Omitted foreground foliage and terrain can occlude the tracer's otherwise visible house. */
  captureCoverage(camera: THREE.PerspectiveCamera) {
    const { scene } = this.snapshot
    const { renderer, coverage } = this
    coverage.setSize(this.tracer.target.width, this.tracer.target.height)
    const previousTarget = renderer.getRenderTarget()
    const shadows = renderer.shadowMap.enabled
    scene.overrideMaterial = this.depthMaterial
    renderer.shadowMap.enabled = false
    try {
      renderer.setRenderTarget(coverage)
      renderer.clearDepth()
      renderer.render(scene, camera)
    } finally {
      renderer.setRenderTarget(previousTarget)
      renderer.shadowMap.enabled = shadows
      scene.overrideMaterial = null
    }
    return coverage.depthTexture!
  }

  dispose() {
    if (this.released) return
    this.released = true
    this.worker.dispose()
    this.sceneBuild = undefined
    if (this.pending) this.gl.deleteSync(this.pending)
    this.coverage.dispose()
    this.depthMaterial.dispose()
    this.snapshot.dispose()
    const { _pathTracer, _lowResPathTracer } = internals(this.tracer)
    this.tracer.dispose()
    _lowResPathTracer.dispose()
    releaseMaterial(_pathTracer)
    releaseMaterial(_lowResPathTracer)
  }
}
