import { useCallback, useEffect, useRef, useState } from 'react'
import type { HomePlan, TourStop } from '../engine/house/types'
import type { Navigator } from '../engine/nav/navigator'
import { Icon } from './icons'

const DWELL_MS = 5000

interface Session {
  plan: HomePlan
  nav: Navigator
  showView: (id: string) => void
  index: number
  paused: boolean
  arrived: boolean
  timer: number
  deadline: number
  remaining: number
}

export function useTour() {
  const session = useRef<Session>(null)
  const [state, setState] = useState<{ index: number; paused: boolean } | null>(null)

  const stop = useCallback(() => {
    const current = session.current
    if (!current) return false
    session.current = null
    window.clearTimeout(current.timer)
    current.nav.interruptTween()
    current.nav.pauseTween(false)
    setState(null)
    return true
  }, [])

  useEffect(() => () => { stop() }, [stop])

  const schedule = (current: Session) => {
    current.deadline = performance.now() + current.remaining
    current.timer = window.setTimeout(() => {
      if (session.current !== current) return
      if (current.index + 1 < current.plan.tour!.length) show(current, current.index + 1)
      else stop()
    }, current.remaining)
  }

  function show(current: Session, index: number) {
    const stop = current.plan.tour?.[index]
    const view = current.plan.views.find(view => view.id === stop?.view)
    if (!view) return
    window.clearTimeout(current.timer)
    current.index = index
    current.arrived = false
    current.remaining = DWELL_MS
    setState({ index, paused: current.paused })
    current.nav.pauseTween(false)
    current.showView(view.id)
    current.nav.goToTourView(view, current.paused || matchMedia('(prefers-reduced-motion: reduce)').matches, () => {
      if (session.current !== current) return
      current.arrived = true
      if (!current.paused) schedule(current)
    })
  }

  const start = (plan: HomePlan, nav: Navigator, showView: Session['showView']) => {
    stop()
    const current = { plan, nav, showView, index: 0, paused: false, arrived: false, timer: 0, deadline: 0, remaining: DWELL_MS }
    session.current = current
    show(current, 0)
  }

  const jump = (index: number) => { if (session.current) show(session.current, index) }
  const togglePause = () => {
    const current = session.current
    if (!current) return
    current.paused = !current.paused
    current.nav.pauseTween(current.paused)
    if (current.arrived) {
      if (current.paused) {
        window.clearTimeout(current.timer)
        current.remaining = Math.max(0, current.deadline - performance.now())
      } else schedule(current)
    }
    setState({ index: current.index, paused: current.paused })
  }

  return { state, start, stop, jump, togglePause }
}

export function TourControls({ stops, index, paused, jump, togglePause, end }: {
  stops: TourStop[]
  index: number
  paused: boolean
  jump: (index: number) => void
  togglePause: () => void
  end: () => void
}) {
  const stop = stops[index]
  if (!stop) return null
  return (
    <section className="tour-panel glass" aria-label="Guided tour" data-tour-control>
      <div className="tour-caption" aria-live="polite" aria-atomic="true">
        <h2>{stop.title}</h2>
        <p>{stop.caption}</p>
      </div>
      <button type="button" className="icon-btn tour-close" aria-label="End tour" onClick={end}><Icon.close /></button>
      <div className="tour-transport">
        <button type="button" className="icon-btn" aria-label="Previous stop" disabled={index === 0} onClick={() => jump(index - 1)}><Icon.left /></button>
        <button type="button" className="icon-btn" aria-label={paused ? 'Resume tour' : 'Pause tour'} onClick={togglePause}>
          {paused ? <Icon.play /> : <Icon.pause />}
        </button>
        <div className="tour-dots" aria-label="Tour stops" role="group">
          {stops.map((item, i) => <button key={item.view} type="button" aria-label={item.title} title={item.title} aria-current={i === index ? 'step' : undefined} onClick={() => jump(i)} />)}
        </div>
        <button type="button" className="icon-btn" aria-label="Next stop" disabled={index === stops.length - 1} onClick={() => jump(index + 1)}><Icon.right /></button>
      </div>
    </section>
  )
}
