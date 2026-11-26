import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Engine } from '../engine/Engine'
import { loadModel, setModelQuality } from '../engine/models'
import { Navigator, type NavMode } from '../engine/nav/navigator'
import { PLANS, planById } from '../plans'
import { FloorPlan } from './FloorPlan'
import { Icon } from './icons'
import { Joystick } from './Joystick'
import { CustomizePanel, HelpSheet, PlanFacts, PlanSheet, ShareSheet } from './Panels'
import { decodeDesign, encodeDesign, getState, planFor, setState, toast, useStore, type UiMode } from './store'
import { PhotoMode } from './PhotoMode'
import { Editor } from './Editor'

declare global {
  interface Window {
    __engine?: Engine
    __nav?: Navigator
    __ready?: boolean
    /** offline bake hook (tools/bake): the loaded home as GLB + world sky + sun, base64 encoded */
    __bakeExport?: () => Promise<{ glb: string; sky: string; meta: unknown }>
    __models?: { load: (id: string) => Promise<THREE.Group>; lowRes: (lo: boolean) => void; three: typeof THREE }
  }
}

let engine: Engine | null = null
let nav: Navigator | null = null

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const planId = useStore(s => s.planId)
  const mode = useStore(s => s.mode)
  const sheet = useStore(s => s.sheet)
  const loading = useStore(s => s.loading)
  const toastMsg = useStore(s => s.toast)
  const walkHint = useStore(s => s.walkHint)
  const photo = useStore(s => s.photo)
  const editing = useStore(s => s.editing)
  const [you, setYou] = useState<{ x: number; z: number; yaw: number } | null>(null)
  const [viewId, setViewId] = useState<string | null>('hero')
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth * 1.15)
  useEffect(() => {
    const f = () => setPortrait(window.innerHeight > window.innerWidth * 1.15)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  const custom = useStore(s => s.customPlans[s.planId])
  const plan = custom ?? planById(planId)!

  // ------------------------------------------------------------ engine boot (once)
  useEffect(() => {
    const canvas = canvasRef.current!
    const params = new URLSearchParams(location.search)
    const fromHash = decodeDesign(location.hash)
    if (fromHash) setState(fromHash)
    const pid = params.get('plan')
    if (pid && planById(pid)) setState({ planId: pid, sheet: null })
    if (params.get('sheet') === 'none') setState({ sheet: null })
    if (params.get('ui') === '0') document.documentElement.classList.add('no-ui')
    const t = params.get('time')
    if (t) setState({ time: t })
    engine = new Engine({ canvas, onProgress: (p, label) => setState({ loading: { p, label } }) })
    if (params.get('frames')) engine.pipeline.maxFrames = Number(params.get('frames'))
    window.__engine = engine
    window.__bakeExport = async () => {
      const { exportForBake } = await import('../engine/bake/exportBake')
      const r = await exportForBake(engine!)
      const b64 = (buf: ArrayBuffer) =>
        new Promise<string>(res => {
          const fr = new FileReader()
          fr.onload = () => res((fr.result as string).split(',')[1])
          fr.readAsDataURL(new Blob([buf]))
        })
      return { glb: await b64(r.glb), sky: await b64(r.sky.buffer as ArrayBuffer), meta: r.meta }
    }
    // test hook: tools render each furniture model on its own to check it is assembled correctly
    window.__models = { load: loadModel, lowRes: setModelQuality, three: THREE }
    nav = new Navigator(engine, canvas)
    window.__nav = nav
    engine.keepAlive = () => !!nav?.active
    nav.onModeChange = (m: NavMode) => {
      if (getState().mode !== 'plan' || m !== 'orbit') setState({ mode: m })
    }
    let hintTimer = 0
    nav.onInteract = () => {
      if (getState().sheet === 'plans' && matchMedia('(max-width: 899px)').matches) setState({ sheet: null })
      if (nav?.mode === 'walk' && getState().walkHint && !hintTimer) hintTimer = window.setTimeout(() => setState({ walkHint: false }), 4500)
    }
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      engine!.resize(r.width, r.height)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    let last = 0
    engine.onRendered = () => {
      const now = performance.now()
      if (now - last < 120 || !nav) return
      last = now
      if (nav.mode === 'walk') setYou({ x: engine!.camera.position.x, z: engine!.camera.position.z, yaw: nav.yaw })
      else setYou(null)
    }
    const onHash = () => {
      const d = decodeDesign(location.hash)
      if (d && encodeDesign() !== location.hash.slice(1)) setState(d)
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      ro.disconnect()
      window.removeEventListener('hashchange', onHash)
      nav?.dispose()
      engine?.dispose()
      engine = null
      nav = null
    }
  }, [])

  // ------------------------------------------------------------ load plan when it changes (or on Try again)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!engine || !nav) return
    let cancelled = false
    const s = getState()
    const p = planFor(planId)
    setState({ loading: { p: 0.02, label: 'Building the house' } })
    const hero = p.views[0]
    nav.goToView(hero, false)
    engine
      .loadPlan(p, s.finishes[p.id] ?? p.finishes, s.time)
      .then(() => {
        if (cancelled || !engine || !nav) return
        nav.setBounds(engine.house!.bounds)
        // ?view=<id> (screenshots, tests) starts at that view on the first load
        const asked = new URLSearchParams(location.search).get('view')
        const start = (attempt === 0 && p.views.find(v => v.id === asked)) || hero
        nav.goToView(start, false)
        setViewId(start.id)
        setState({ loading: null, mode: start.kind === 'walk' ? 'walk' : 'orbit' })
        window.__ready = true
      })
      .catch(err => {
        console.error(err)
        if (cancelled) return
        // say why: a screenshot of this screen is often the only report we get from a phone
        const why = err instanceof Error ? err.message : String(err)
        setState({ loading: { p: 1, label: 'Could not load this home.', error: why.slice(0, 180) } })
      })
    return () => {
      cancelled = true
    }
  }, [planId, attempt])

  // ------------------------------------------------------------ keep the share hash current
  useEffect(() => {
    let prev = ''
    const sync = () => {
      const code = encodeDesign()
      if (code !== prev) {
        prev = code
        try {
          history.replaceState(null, '', `#${code}`)
        } catch {
          /* some hosts refuse; the share sheet still builds the link */
        }
      }
    }
    sync()
    const id = setInterval(sync, 800)
    return () => clearInterval(id)
  }, [])

  const pickPlan = (id: string) => {
    setState({ sheet: matchMedia('(max-width: 899px)').matches ? null : getState().sheet === 'plans' ? 'plans' : null })
    if (id === getState().planId) {
      setState({ sheet: null })
      return
    }
    setState({ planId: id, mode: 'orbit', editing: false })
  }

  const stepPlan = (d: number) => {
    const i = PLANS.findIndex(p => p.id === planId)
    const next = PLANS[(i + d + PLANS.length) % PLANS.length]
    setState({ planId: next.id, mode: 'orbit', editing: false, sheet: getState().sheet === 'plans' ? 'plans' : null })
  }

  const setMode = (m: UiMode) => {
    if (!nav || !engine) return
    if (m === 'plan') {
      setState({ mode: 'plan', sheet: null })
      return
    }
    if (m === 'walk' && nav.mode !== 'walk') {
      // step onto the terrace / first walk view
      const v = plan.views.find(x => x.kind === 'walk')
      if (v) nav.goToView(v)
      else nav.setMode('walk')
      setState({ mode: 'walk', walkHint: getState().walkHint })
      return
    }
    if (m === 'orbit' && (nav.mode === 'walk' || nav.mode === 'dollhouse')) {
      nav.setMode('orbit')
      nav.goToView(plan.views[0])
    } else nav.setMode(m as NavMode)
    setState({ mode: m })
  }

  const goView = (id: string) => {
    const v = plan.views.find(x => x.id === id)
    if (!v || !nav) return
    if (nav.mode === 'dollhouse') nav.setMode('orbit', false)
    nav.goToView(v)
    setViewId(id)
    setState({ mode: v.kind === 'walk' ? 'walk' : 'orbit' })
  }

  const onFinish = (zone: string, opt: string) => {
    setState(s => ({ finishes: { ...s.finishes, [s.planId]: { ...s.finishes[s.planId], [zone]: opt } } }))
    engine?.setFinish(zone, opt)
  }

  const onTime = (id: string) => {
    setState({ time: id })
    engine?.setTime(id)
  }

  const roomWalk = (roomId: string, x: number, z: number) => {
    if (!nav || !engine) return
    const r = plan.rooms.find(rr => rr.id === roomId)
    const preset = plan.views.find(v => v.room === roomId)
    if (preset) {
      nav.goToView(preset)
    } else if (r) {
      const fy = plan.floorY
      const tx = (r.rect[0] + r.rect[2]) / 2
      const tz = r.rect[1] + 0.3
      nav.goToView({ id: 'room', label: r.name, kind: 'walk', pos: [x, fy + 1.62, Math.min(r.rect[3] - 0.6, z + 1.2)], target: [tx, fy + 1.2, tz], fov: 66 })
    }
    setState({ mode: 'walk' })
  }

  const exteriorViews = plan.views.filter(v => v.kind === 'orbit' && !v.id.startsWith('test'))
  const walkViews = plan.views.filter(v => v.kind === 'walk')
  const chips = mode === 'walk' ? walkViews : exteriorViews

  return (
    <div className={`app mode-${mode} ${sheet ? `has-${sheet}` : ''} ${editing ? 'is-editing' : ''}`}>
      <canvas ref={canvasRef} className="stage" />

      <div className="hud">
        <header className="topbar">
          <div className="brand" aria-label="Cuby Homes">
            <img src="./cuby.svg" alt="" width={28} height={28} />
            <span className="brand-word">Cuby</span>
          </div>
          <div className="plan-switch">
            <button className="icon-btn ghost" onClick={() => stepPlan(-1)} aria-label="Previous plan">
              <Icon.left />
            </button>
            <button className="plan-name" onClick={() => setState({ sheet: sheet === 'plans' ? null : 'plans' })} aria-label="All plans">
              <span className="plan-count">
                {PLANS.findIndex(p => p.id === planId) + 1}/{PLANS.length}
              </span>
              <span className="plan-title-line">{plan.name}</span>
              <PlanFacts id={planId} short />
            </button>
            <button className="icon-btn ghost" onClick={() => stepPlan(1)} aria-label="Next plan">
              <Icon.right />
            </button>
          </div>
          <button className="btn btn-plans" onClick={() => setState({ sheet: sheet === 'plans' ? null : 'plans' })}>
            <Icon.plans /> <span>All plans</span>
          </button>
        </header>

        <nav className="actions" aria-label="Tools">
          <button className="icon-btn" onClick={() => setState({ editing: !editing, sheet: null })} aria-label="Edit plan" aria-pressed={editing}>
            <Icon.pencil />
          </button>
          <button className="icon-btn" onClick={() => setState({ sheet: sheet === 'share' ? null : 'share' })} aria-label="Share design">
            <Icon.link />
          </button>
          <button
            className="icon-btn"
            onClick={() => setState({ photo: { state: 'rendering', samples: 0 }, sheet: null })}
            aria-label="Render a photo"
          >
            <Icon.aperture />
          </button>
          <button
            className="icon-btn hide-touch"
            onClick={() => {
              const el = document.documentElement
              if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
              else el.requestFullscreen?.().catch(() => toast('Fullscreen is not available here'))
            }}
            aria-label="Fullscreen"
          >
            <Icon.expand />
          </button>
          <button className="icon-btn" onClick={() => setState({ sheet: sheet === 'help' ? null : 'help' })} aria-label="Controls">
            <Icon.help />
          </button>
        </nav>

        {mode === 'walk' && (
          <button className="minimap" onClick={() => setMode('plan')} aria-label="Open floor plan">
            <FloorPlan plan={plan} you={you} compact />
          </button>
        )}

        <div className="bottom">
          {mode !== 'plan' && chips.length > 0 && (
            <div className="chips" role="list">
              {chips.map(v => (
                <button key={v.id} role="listitem" className={`chip-btn ${viewId === v.id ? 'is-on' : ''}`} onClick={() => goView(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
          )}
          <div className="dock">
            <div className="modes" role="tablist" aria-label="View mode">
              {(
                [
                  ['orbit', 'Outside', Icon.orbit],
                  ['walk', 'Walk', Icon.walk],
                  ['dollhouse', 'Dollhouse', Icon.dollhouse],
                  ['plan', 'Floor plan', Icon.plan],
                ] as const
              ).map(([m, label, I]) => (
                <button key={m} role="tab" aria-selected={mode === m} className={`mode ${mode === m ? 'is-on' : ''}`} onClick={() => setMode(m)}>
                  <I />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <button className={`btn btn-style ${sheet === 'customize' ? 'is-on' : ''}`} onClick={() => setState({ sheet: sheet === 'customize' ? null : 'customize' })}>
              <Icon.palette />
              <span>Style</span>
            </button>
          </div>
        </div>

        {mode === 'walk' && touch && <div className="joy-wrap"><Joystick onMove={(x, y) => { if (nav && engine) { nav.moveInput.set(x, y); engine.invalidate() } }} /></div>}

        {mode === 'walk' && walkHint && (
          <div className="hint" role="status">
            <p>{touch ? 'Drag to look around · Tap the floor to walk · Stick to move' : 'Drag to look around · Click the floor to walk · W A S D to move'}</p>
            <button className="btn btn-ghost" onClick={() => setState({ walkHint: false })}>Got it</button>
          </div>
        )}

        {mode === 'plan' && (
          <div className="plan-overlay">
            <div className="plan-overlay-head">
              <div>
                <p className="eyebrow">{plan.style}</p>
                <h2>{plan.name}</h2>
                <PlanFacts id={planId} />
              </div>
              <button className="icon-btn" onClick={() => setMode('orbit')} aria-label="Close floor plan">
                <Icon.close />
              </button>
            </div>
            <FloorPlan className="plan-big" plan={plan} onRoom={roomWalk} rotate={portrait && plan.facts.width > plan.facts.depth * 1.15} />
            <p className="note center">Tap a room to stand in it.</p>
          </div>
        )}

        {sheet === 'plans' && <PlanSheet onPick={pickPlan} />}
        {sheet === 'customize' && <CustomizePanel onFinish={onFinish} onTime={onTime} />}
        {sheet === 'share' && <ShareSheet />}
        {sheet === 'help' && <HelpSheet />}
        {editing && engine && <Editor engine={engine} plan={plan} onClose={() => setState({ editing: false })} />}
        {photo && engine && <PhotoMode engine={engine} />}

        {loading && (
          <div className="loading" role="status" aria-live="polite">
            <div className="loading-card">
              <p className="eyebrow">Cuby Homes</p>
              <h1>{plan.name}</h1>
              <p className="loading-label">{loading.label}</p>
              {loading.error !== undefined ? (
                <>
                  <p className="loading-error">{loading.error}</p>
                  <button type="button" className="btn loading-retry" onClick={() => setAttempt(a => a + 1)}>
                    Try again
                  </button>
                </>
              ) : (
                <div className="bar">
                  <span style={{ transform: `scaleX(${Math.max(0.04, loading.p)})` }} />
                </div>
              )}
            </div>
          </div>
        )}
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </div>
  )
}

export { THREE }
