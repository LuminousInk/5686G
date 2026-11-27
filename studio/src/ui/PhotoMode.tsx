import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { Engine } from '../engine/Engine'
import { Icon } from './icons'
import { setState, useStore } from './store'

/** The in-view renderer and the saved photograph share a camera, lighting, and finishing passes. */
export function PhotoMode({ engine }: { engine: Engine }) {
  const photo = useStore(s => s.photo)
  const still = useSyncExternalStore(engine.subscribeRefinement, engine.getRefinement)
  const target = engine.quality.refinement.photoSamples
  const finish = useCallback(() => {
    const samples = engine.refinement.samples
    let url: string | undefined
    try { url = engine.captureRefinement() } catch { /* A context loss can invalidate the capture. */ }
    setState({ photo: { state: 'done', samples, url } })
  }, [engine])

  useEffect(() => {
    engine.requestRefinement(true)
    return () => engine.interruptRefinement()
  }, [engine])

  useEffect(() => {
    if (photo?.state === 'rendering' && (still.state === 'complete' || still.state === 'unavailable')) finish()
  }, [finish, photo?.state, still.state])

  if (!photo) return null
  const touch = matchMedia('(pointer: coarse)').matches
  return (
    <div className={`photo ${photo.state === 'done' ? 'is-done' : ''}`}>
      {photo.state === 'rendering' && (
        <div className="photo-bar" role="status">
          <span className="eyebrow">Ray-traced photo</span>
          <div className="bar">
            <span style={{ transform: `scaleX(${Math.min(1, still.samples / target)})` }} />
          </div>
          <span className="photo-count">{still.samples} / {target} samples</span>
          <button className="btn btn-ghost" disabled={still.samples === 0} onClick={finish}>Finish now</button>
          <button className="icon-btn" onClick={() => setState({ photo: null })} aria-label="Cancel photo">
            <Icon.close />
          </button>
        </div>
      )}
      {photo.state === 'done' && (
        <div className="photo-result">
          {photo.url ? <img src={photo.url} alt="Render of the current view" /> : <p className="note">This browser could not export the picture.</p>}
          <div className="photo-actions">
            {photo.url && photo.samples === 0 && <p className="note">Ray tracing was unavailable. This image uses the raster preview.</p>}
            <p className="note">{touch ? 'Press and hold the picture to save it.' : 'Right-click the picture and choose Save image.'}</p>
            <button className="btn" onClick={() => setState({ photo: null })}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
