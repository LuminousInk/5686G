import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Landing } from './ui/Landing'
import { designCode, isStudioRoute, type StudioLoad } from './ui/routes'
import './ui/styles.css'
import './ui/landing.css'

function Site() {
  const [route, setRoute] = useState(() => ({
    hash: location.hash,
    target: { hash: designCode(location.hash) ? location.hash : '' },
  }))
  const selection = useRef(route.target)
  const studioRoot = useRef<HTMLDivElement>(null)
  const [starting, setStarting] = useState(false)
  const [studio, setStudio] = useState<typeof import('./ui/App')>()
  const [chunkError, setChunkError] = useState(false)
  const [load, setLoad] = useState<StudioLoad>({ target: route.target, progress: 0 })
  const [attempt, setAttempt] = useState(0)
  const requested = isStudioRoute(route.hash, location.search)
  const tools = requested && isStudioRoute('', location.search)
  const sceneProgress = load.target === route.target ? load.progress : 0
  const progress = Math.max(sceneProgress, starting ? 1 : 0)
  const error = chunkError || (load.target === route.target && !!load.error)
  const ready = progress === 100 && !error
  const entered = tools || (requested && ready)

  useEffect(() => {
    const sync = () => {
      const hash = location.hash
      if (designCode(hash) && hash !== selection.current.hash) selection.current = { hash }
      setRoute({ hash, target: selection.current })
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    const loadStudio = () => {
      setStarting(true)
      import('./ui/App').then(setStudio).catch(error => {
        console.error(error)
        setChunkError(true)
      })
    }
    // Give the browser a paint for the static hero before evaluating the engine chunk.
    let timer = 0
    const frame = requestAnimationFrame(() => { timer = window.setTimeout(loadStudio, 0) })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])

  useLayoutEffect(() => {
    if (entered && !tools) studioRoot.current?.focus({ preventScroll: true })
  }, [entered, tools])

  const retry = () => {
    if (chunkError) {
      location.reload()
      return
    }
    setLoad({ target: route.target, progress: 0 })
    setAttempt(a => a + 1)
  }

  return (
    <>
      {!tools && (
        <div className="site-viewport" inert={entered}>
          <Landing hash={route.hash} progress={progress} ready={ready} pending={requested && !ready} error={error} onRetry={retry} onDesign={hash => { if (hash !== location.hash) selection.current = { hash } }} />
        </div>
      )}
      <div className="studio-viewport" ref={studioRoot} inert={!entered} role="region" aria-label="3D studio" tabIndex={-1}>
        {studio && (
          <studio.App key={attempt} target={route.target} visible={entered} requested={requested} onLoad={setLoad} />
        )}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Site />)
