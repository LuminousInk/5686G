import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { CONSTANTS, Viewer } from '@photo-sphere-viewer/core'
import { VirtualTourPlugin, type VirtualTourLink } from '@photo-sphere-viewer/virtual-tour-plugin'
import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/virtual-tour-plugin/index.css'
import type { HomePlan } from '../../engine/house/types'
import { Icon } from '../icons'
import { photoHome, photoSrc, renderedStops, type PhotoStop } from './manifest'
import { DirectImageAdapter } from './directImageAdapter'
import './photoTour.css'

export default function PhotoTour({ plan, back, onBack }: {
  plan: HomePlan
  back: string
  onBack: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const home = photoHome(plan.id)
  const stops = useMemo(() => home ? renderedStops(home) : [], [home])
  const [active, setActive] = useState<PhotoStop>()
  const [loading, setLoading] = useState(!!stops.length)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const navigate = useRef<(id: string, link?: VirtualTourLink) => void>(() => {})
  const initial = useRef(stops[0]?.id)

  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (!stops.length || !stage.current) return

    const byId = new Map(stops.map(stop => [stop.id, stop]))
    const nodes = new Map(stops.map(stop => [stop.id, {
      id: stop.id,
      name: stop.name,
      panorama: photoSrc(stop),
      links: stop.links.map(link => ({
        nodeId: link.to,
        position: { yaw: link.yaw, pitch: link.pitch },
      })),
    }]))
    let alive = true
    let instance: Viewer
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    try {
      instance = new Viewer({
        container: stage.current,
        adapter: DirectImageAdapter,
        navbar: false,
        keyboard: 'always',
        mousewheelCtrlKey: false,
        touchmoveTwoFingers: false,
        defaultZoomLvl: 22,
        maxFov: 92,
        lang: { loadError: 'This photo could not load.' },
        plugins: [VirtualTourPlugin.withConfig({
          // Resolve from bundled data and let us handle the first load and retries.
          dataMode: 'server',
          getNode: id => nodes.get(id)!,
          positionMode: 'manual',
          renderMode: '2d',
          showLinkTooltip: false,
          arrowStyle: {
            size: { width: 46, height: 46 },
            element: link => {
              const arrow = document.createElement('button')
              const label = `Go to ${byId.get(link.nodeId)?.name}`
              arrow.type = 'button'
              arrow.tabIndex = -1
              arrow.classList.add('photo-tour-arrow', CONSTANTS.CAPTURE_EVENTS_CLASS)
              arrow.setAttribute('aria-label', label)
              arrow.title = label
              arrow.textContent = '↑'
              arrow.onclick = () => navigate.current(link.nodeId, link)
              return arrow
            },
          },
          transitionOptions: (_to, from) => ({
            effect: from && !reduceMotion ? 'fade' : 'none',
            speed: 650,
            rotation: false,
            rotateTo: { yaw: 0, pitch: 0 },
            zoomTo: 22,
            showLoader: false,
          }),
        })],
      })
    } catch {
      setLoading(false)
      setError('The 360° viewer could not start.')
      return
    }
    viewer.current = instance
    const tour = instance.getPlugin<VirtualTourPlugin>(VirtualTourPlugin)
    instance.addEventListener('panorama-load', () => { setError(''); setLoading(true) })
    instance.addEventListener('panorama-error', () => {
      setLoading(false)
      setError('This photo could not load.')
    })
    tour.addEventListener('node-changed', ({ node }) => {
      setActive(byId.get(node.id))
      setLoading(false)
    })
    navigate.current = (id, link) => {
      initial.current = id
      void tour.setCurrentNode(id, undefined, link).catch(() => {
        if (!alive) return
        setLoading(false)
        setError('This photo could not load.')
      })
    }
    navigate.current(initial.current ?? stops[0].id)
    return () => {
      alive = false
      navigate.current = () => {}
      viewer.current = null
      instance.destroy()
    }
  }, [stops, attempt])

  const zoom = (delta: number) => {
    const camera = viewer.current
    if (camera) camera.zoom(camera.getZoomLevel() + delta)
  }

  return (
    <main className="photo-tour" aria-labelledby="photo-tour-title">
      <header className="photo-tour-header">
        <a className="photo-tour-back" href={back} onClick={onBack}><Icon.left /> Back</a>
        <h1 id="photo-tour-title" ref={heading} tabIndex={-1}>{plan.name}</h1>
        {active && <a className="photo-tour-studio" href={active.studio}>Explore in 3D <Icon.diagonal /></a>}
      </header>
      {stops.length ? (
        <>
          <div className="photo-tour-frame">
            <div className="photo-tour-stage" ref={stage} role="region" aria-label="Interactive 360° panorama" />
            {loading && <p className="photo-tour-loading" role="status">{active ? 'Opening room…' : 'Loading panorama…'}</p>}
            {error && (
              <div className="photo-tour-state">
                <p role="alert">{error}</p>
                <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
              </div>
            )}
            {active && !error && <div className="photo-tour-zoom" aria-label="Zoom controls" role="group">
              <button type="button" aria-label="Zoom out" onClick={() => zoom(-10)}>−</button>
              <button type="button" aria-label="Zoom in" onClick={() => zoom(10)}>+</button>
            </div>}
          </div>
          <footer className="photo-tour-footer">
            <div className="photo-tour-caption" aria-live="polite">
              <h2>{active?.name ?? stops[0].name}</h2>
              <p>{active?.caption ?? stops[0].caption}</p>
            </div>
            {stops.length > 1 && <div className="photo-tour-stops" aria-label="Tour stops" role="group">
              {stops.map(stop => (
                <button
                  type="button"
                  key={stop.id}
                  aria-pressed={active?.id === stop.id}
                  disabled={loading}
                  onClick={() => navigate.current(stop.id)}
                >{stop.name}</button>
              ))}
            </div>}
          </footer>
        </>
      ) : <div className="photo-tour-state"><h2>360° photo tour coming soon</h2></div>}
    </main>
  )
}
