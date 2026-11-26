import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Engine } from '../engine/Engine'
import { Icon } from './icons'
import { setState, useStore } from './store'

/**
 * Path-traced photo of the current view (three-gpu-pathtracer). The real-time loop pauses, instanced and shader
 * driven pieces are baked to plain geometry, the full HDRI (with its sun) lights the scene, and samples accumulate
 * until the image is clean. The result is shown as an image the viewer can save (press and hold / right click).
 */
export function PhotoMode({ engine }: { engine: Engine }) {
  const photo = useStore(s => s.photo)
  const stopRef = useRef(false)
  const target = engine.quality.tier === 'high' ? 384 : engine.quality.tier === 'medium' ? 192 : 96

  useEffect(() => {
    let raf = 0
    let disposed = false
    stopRef.current = false
    const scene = engine.scene
    const renderer = engine.renderer
    const camera = engine.camera
    const restore: (() => void)[] = []
    let pt: { renderSample(): void; samples: number; dispose(): void } | null = null

    const finish = () => {
      if (disposed) return
      try {
        const url = renderer.domElement.toDataURL('image/jpeg', 0.92)
        setState({ photo: { state: 'done', samples: pt?.samples ?? 0, url } })
      } catch {
        setState({ photo: { state: 'done', samples: pt?.samples ?? 0 } })
      }
    }

    ;(async () => {
      engine.paused = true
      engine.stop()
      const [{ WebGLPathTracer }, { GenerateMeshBVHWorker }] = await Promise.all([import('three-gpu-pathtracer'), import('three-mesh-bvh/worker')])
      if (disposed) return
      // bake real-time-only geometry
      const bake = engine.site?.bakeForPhoto(camera) ?? { add: [], hide: [] }
      // shadow-only blockers draw nothing in the raster view, but the path tracer would treat them as surfaces
      scene.traverse(o => {
        if (o.userData.shadowOnly) bake.hide.push(o)
      })
      for (const o of bake.hide) {
        const v = o.visible
        o.visible = false
        restore.push(() => (o.visible = v))
      }
      for (const o of bake.add) {
        scene.add(o)
        restore.push(() => {
          scene.remove(o)
          o.traverse(c => (c as THREE.Mesh).geometry?.dispose())
        })
      }
      // light with the complete sky (sun included) instead of the sunless IBL + shadow light
      const prevEnv = scene.environment
      const hdri = engine.sky.originalHdri
      if (hdri && engine.sky.sunIntensity > 0) {
        scene.environment = hdri
        engine.sky.sun.visible = false
      } else if (hdri) {
        scene.environment = hdri
      }
      restore.push(() => {
        scene.environment = prevEnv
        engine.sky.sun.visible = engine.sky.sunIntensity > 0
      })
      // the path tracer ignores per-material env maps but some interior materials point at the probe; that is fine
      const prevTone = renderer.toneMapping
      const prevExp = renderer.toneMappingExposure
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = engine.sky.exposure * (engine.isInside(camera.position) ? 2.2 : 1)
      restore.push(() => {
        renderer.toneMapping = prevTone
        renderer.toneMappingExposure = prevExp
      })
      camera.clearViewOffset()
      const tracer = new WebGLPathTracer(renderer)
      tracer.setBVHWorker(new GenerateMeshBVHWorker())
      tracer.tiles.set(engine.quality.tier === 'low' ? 3 : 2, engine.quality.tier === 'low' ? 3 : 2)
      tracer.renderScale = engine.quality.tier === 'low' ? 0.7 : 1
      tracer.bounces = 6
      tracer.transmissiveBounces = 6
      tracer.filterGlossyFactor = 0.5
      tracer.minSamples = 1
      tracer.renderDelay = 0
      tracer.fadeDuration = 0
      tracer.textureSize.set(engine.quality.tier === 'low' ? 512 : 1024, engine.quality.tier === 'low' ? 512 : 1024)
      pt = tracer as unknown as typeof pt
      await tracer.setSceneAsync(scene, camera)
      if (disposed) return
      const loop = () => {
        if (disposed) return
        raf = requestAnimationFrame(loop)
        tracer.renderSample()
        const n = tracer.samples
        if (Math.floor(n) % 4 === 0) setState({ photo: { state: 'rendering', samples: Math.floor(n) } })
        if (n >= target || stopRef.current) {
          cancelAnimationFrame(raf)
          finish()
        }
      }
      loop()
    })().catch(err => {
      console.error(err)
      setState({ photo: null })
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      pt?.dispose()
      for (const r of restore.reverse()) r()
      engine.paused = false
      engine.invalidate()
    }
  }, [engine, target])

  if (!photo) return null
  const touch = matchMedia('(pointer: coarse)').matches
  return (
    <div className={`photo ${photo.state === 'done' ? 'is-done' : ''}`}>
      {photo.state === 'rendering' && (
        <div className="photo-bar" role="status">
          <span className="eyebrow">Ray-traced photo</span>
          <div className="bar">
            <span style={{ transform: `scaleX(${Math.min(1, photo.samples / target)})` }} />
          </div>
          <span className="photo-count">{photo.samples} / {target} samples</span>
          <button className="btn btn-ghost" onClick={() => (stopRef.current = true)}>Finish now</button>
          <button className="icon-btn" onClick={() => setState({ photo: null })} aria-label="Cancel photo">
            <Icon.close />
          </button>
        </div>
      )}
      {photo.state === 'done' && (
        <div className="photo-result">
          {photo.url ? <img src={photo.url} alt="Ray-traced render of the current view" /> : <p className="note">This browser could not export the picture.</p>}
          <div className="photo-actions">
            <p className="note">{touch ? 'Press and hold the picture to save it.' : 'Right-click the picture and choose Save image.'}</p>
            <button className="btn" onClick={() => setState({ photo: null })}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
