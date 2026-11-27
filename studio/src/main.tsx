import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Landing } from './ui/Landing'
import { designCode, homeFromRoute, homeRoute, isStudioRoute, photoFromRoute, type StudioLoad } from './ui/routes'
import './ui/base.css'
import './ui/landing.css'

const PhotoTour = lazy(() => import('./ui/phototour/PhotoTour'))

function Site() {
  const [route, setRoute] = useState(() => ({
    hash: location.hash,
    target: { hash: designCode(location.hash) ? location.hash : '' },
  }))
  const selection = useRef(route.target)
  const photoOrigin = useRef<string>(undefined)
  const browsed = useRef(!photoFromRoute(route.hash))
  const studioRoot = useRef<HTMLDivElement>(null)
  const [starting, setStarting] = useState(false)
  const [studio, setStudio] = useState<typeof import('./ui/App')>()
  const [chunkError, setChunkError] = useState(false)
  const [load, setLoad] = useState<StudioLoad>({ target: route.target, progress: 0 })
  const [attempt, setAttempt] = useState(0)
  const requested = isStudioRoute(route.hash, location.search)
  const photoPlan = photoFromRoute(route.hash)
  const photoOpen = !!photoPlan
  const tools = requested && isStudioRoute('', location.search)
  const sceneProgress = load.target === route.target ? load.progress : 0
  const progress = Math.max(sceneProgress, starting ? 1 : 0)
  const error = chunkError || (load.target === route.target && !!load.error)
  const ready = progress === 100 && !error
  const entered = tools || (requested && ready)

  useEffect(() => {
    const sync = (event: HashChangeEvent) => {
      const hash = location.hash
      const previous = new URL(event.oldURL).hash
      const onPhoto = photoFromRoute(hash)
      if (!onPhoto) browsed.current = true
      if (onPhoto && (['', '#home', '#homes', '#compare', '#gallery'].includes(previous) || homeFromRoute(previous))) {
        photoOrigin.current = previous || '#home'
      } else if (onPhoto ? !!photoFromRoute(previous) : !isStudioRoute(hash, location.search)) {
        photoOrigin.current = undefined
      }
      if (designCode(hash) && hash !== selection.current.hash) selection.current = { hash }
      setRoute({ hash, target: selection.current })
    }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (photoOpen || studio || chunkError) return
    const loadStudio = () => {
      setStarting(true)
      import('./ui/App').then(setStudio).catch(error => {
        console.error(error)
        setChunkError(true)
      })
    }
    if (isStudioRoute(location.hash, location.search) && isStudioRoute('', location.search)) {
      loadStudio()
      return
    }
    // Between these callbacks the landing can paint before the studio starts up.
    let nextFrame = 0
    const frame = requestAnimationFrame(() => { nextFrame = requestAnimationFrame(loadStudio) })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(nextFrame)
    }
  }, [photoOpen, studio, chunkError])

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
  const selectDesign = useCallback((hash: string) => {
    if (hash !== location.hash) selection.current = { hash }
  }, [])

  return (
    <>
      {!tools && browsed.current && (
        <div className="site-viewport" inert={entered || photoOpen}>
          <Landing hash={route.hash} progress={progress} ready={ready} pending={requested && !ready} error={error} onRetry={retry} onDesign={selectDesign} />
        </div>
      )}
      <div className="studio-viewport" ref={studioRoot} inert={!entered} role="region" aria-label="3D studio" tabIndex={-1}>
        {studio && (
          <studio.App key={attempt} target={route.target} visible={entered} requested={requested} onLoad={setLoad} />
        )}
      </div>
      {photoPlan && (
        <Suspense fallback={<div className="site-opening" role="status">Opening the photo tour…</div>}>
          <PhotoTour
            key={photoPlan.id}
            plan={photoPlan}
            back={photoOrigin.current ?? homeRoute(photoPlan.id)}
            onBack={event => {
              if (!photoOrigin.current || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              history.back()
            }}
          />
        </Suspense>
      )}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Site />)
