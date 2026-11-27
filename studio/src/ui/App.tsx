import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Engine } from '../engine/Engine'
import { loadModel, MODEL_YAW, setModelQuality, skippedModels } from '../engine/models'
import * as kit from '../engine/interior/modern'
import { Navigator, type NavMode } from '../engine/nav/navigator'
import { PLANS, planById } from '../plans'
import { FloorPlan } from './FloorPlan'
import { framePoint, levelFloor } from '../engine/house/levels'
import { Icon } from './icons'
import { Joystick } from './Joystick'
import { CustomizePanel, HelpSheet, PlanFacts, PlanSheet, ShareSheet } from './Panels'
import { decodeDesign, encodeDesign, getState, planFor, setState, toast, useStore, type UiMode } from './store'
import { GALLERY_SHOTS, designView, galleryView, type GalleryCatalog, type GalleryImage } from './galleryShots'
import { ZONES } from '../engine/materials/catalog'
import { TIME_PRESETS } from '../engine/env/environment'
import { isStudioRoute, type StudioLoad, type StudioTarget } from './routes'
import manifest from '../../public/gallery/gallery.json'
import './styles.css'

function galleryCatalog(): GalleryCatalog {
  const images = GALLERY_SHOTS.map<GalleryImage>(shot => {
    const plan = planById(shot.plan)!
    const view = galleryView(plan, shot.id)!
    const time = shot.time ?? 'golden'
    const finishes = { ...plan.finishes, ...shot.finishes }
    const zones = shot.styleZones ?? (view.kind === 'walk' ? ['palette', 'walls'] : ['cedar', 'panel', 'body'])
    const style = zones.filter(z => plan.zones.includes(z)).map(z => {
      const option = ZONES[z].options.find(o => o.id === finishes[z])
      if (!option) throw new Error(`Unknown gallery finish: ${z} / ${finishes[z]}`)
      return option.name
    }).join(' · ')
    if (Object.keys(shot.finishes ?? {}).some(z => !plan.zones.includes(z))) throw new Error(`Unknown finish zone on ${shot.id}`)
    return {
      id: shot.id, plan: plan.id, home: plan.name, kind: view.kind === 'orbit' ? 'exterior' : 'interior',
      space: shot.space, style, light: TIME_PRESETS.find(t => t.id === time)!.label,
      share: '#' + encodeDesign({ ...getState(), planId: plan.id, time, finishes: { [plan.id]: finishes }, viewId: shot.id }),
    }
  })
  const homes = PLANS.map(({ id, name, style, facts: { area, beds, baths } }) => ({ id, name, style, area, beds, baths }))
  return { homes, images, comparisons: manifest.comparisons }
}

declare global {
  interface Window {
    __engine?: Engine
    __nav?: Navigator
    __ready?: boolean
    __gallery?: GalleryCatalog
    /** offline bake hook (tools/bake): the loaded home as GLB + world sky + sun, base64 encoded */
    __bakeExport?: () => Promise<{ glb: string; sky: string; meta: unknown }>
    __models?: { load: (id: string) => Promise<THREE.Group>; lowRes: (lo: boolean) => void; three: typeof THREE; kit: typeof kit; skipped: string[]; yaw: Record<string, number> }
  }
}

let engine: Engine | null = null
let nav: Navigator | null = null

// Schedule heavy work after the landing page has had a chance to paint and handle input.
function afterPaint() {
  return new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

export function App({ target, visible, requested, onLoad }: {
  target: StudioTarget
  visible: boolean
  requested: boolean
  onLoad: (load: StudioLoad) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef({ target, visible, requested })
  latest.current = { target, visible, requested }
  const engineProgress = useRef<(p: number, label: string) => void>(() => {})
  const firstFrame = useRef<(() => void) | null>(null)
  const fitToCanvas = useRef<(() => void) | null>(null)
  const lastScroll = useRef(-Infinity)
  const loadQueue = useRef(Promise.resolve())
  const reportedTarget = useRef<StudioTarget | null>(null)
  const loaded = useRef<{ time: string; finishes: Record<string, string> } | null>(null)
  const [appliedTarget, setAppliedTarget] = useState<StudioTarget | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [bootAttempt, setBootAttempt] = useState(0)
  const [booted, setBooted] = useState(false)
  const planId = useStore(s => s.planId)
  const mode = useStore(s => s.mode)
  const sheet = useStore(s => s.sheet)
  const loading = useStore(s => s.loading)
  const toastMsg = useStore(s => s.toast)
  const walkHint = useStore(s => s.walkHint)
  const photo = useStore(s => s.photo)
  const editing = useStore(s => s.editing)
  const [editorModule, setEditorModule] = useState<typeof import('./Editor')>()
  const [photoModule, setPhotoModule] = useState<typeof import('./PhotoMode')>()
  const [you, setYou] = useState<{ x: number; z: number; yaw: number; level?: string } | null>(null)
  const [openedLevel, setOpenedLevel] = useState<string>()
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

  useEffect(() => {
    if (!editing || editorModule) return
    let cancelled = false
    import('./Editor').then(setEditorModule).catch(() => {
      if (cancelled) return
      setState({ editing: false })
      toast('Could not open the plan editor')
    })
    return () => { cancelled = true }
  }, [editing, editorModule])

  const takingPhoto = !!photo
  useEffect(() => {
    if (!takingPhoto || photoModule) return
    let cancelled = false
    import('./PhotoMode').then(setPhotoModule).catch(() => {
      if (cancelled) return
      setState({ photo: null })
      toast('Could not open photo mode')
    })
    return () => { cancelled = true }
  }, [takingPhoto, photoModule])

  // ------------------------------------------------------------ engine boot (once)
  useEffect(() => {
    const canvas = canvasRef.current!
    const params = new URLSearchParams(location.search)
    if (params.has('gallery')) window.__gallery = galleryCatalog()
    if (params.get('gallery') === 'catalog') return
    setBooted(false)
    window.__ready = false
    if (params.get('ui') === '0') document.documentElement.classList.add('no-ui')
    try {
      engine = new Engine({ canvas, onProgress: (p, label) => engineProgress.current(p, label) })
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      setState({ loading: { p: 0, label: 'Could not start the studio.', error: why.slice(0, 180) } })
      onLoad({ target: latest.current.target, progress: 0, error: why })
      return
    }
    engine.paused = true
    loaded.current = null
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
    window.__models = { load: loadModel, lowRes: setModelQuality, three: THREE, kit, skipped: skippedModels, yaw: MODEL_YAW }
    const blockKeys = (event: KeyboardEvent) => {
      if (!latest.current.visible) event.stopImmediatePropagation()
    }
    const trackScroll = () => { lastScroll.current = performance.now() }
    window.addEventListener('keydown', blockKeys)
    window.addEventListener('scroll', trackScroll, { capture: true, passive: true })
    nav = new Navigator(engine, canvas)
    // Gallery stills hold the exact shot camera while exposure and shadows converge.
    if (params.get('gallery') === '1') nav.update = () => {}
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
    let width = 0
    let height = 0
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      if (r.width === width && r.height === height) return
      width = r.width
      height = r.height
      engine!.resize(width, height)
    }
    fitToCanvas.current = fit
    fit()
    // Mobile browser chrome can resize the viewport during a gallery scroll.
    const ro = new ResizeObserver(() => { if (latest.current.visible) fit() })
    ro.observe(canvas)
    let last = 0
    engine.onRendered = () => {
      firstFrame.current?.()
      if (!latest.current.visible) return
      const now = performance.now()
      if (now - last < 120 || !nav) return
      last = now
      if (nav.mode === 'walk') setYou({ x: engine!.camera.position.x, z: engine!.camera.position.z, yaw: nav.yaw, level: nav.floorLevel })
      else setYou(null)
    }
    setBooted(true)
    return () => {
      ro.disconnect()
      fitToCanvas.current = null
      clearTimeout(hintTimer)
      window.removeEventListener('keydown', blockKeys)
      window.removeEventListener('scroll', trackScroll, true)
      nav?.dispose()
      engine?.dispose()
      engine = null
      nav = null
      firstFrame.current?.()
    }
  }, [bootAttempt, onLoad])

  useEffect(() => {
    if (!booted) return
    const params = new URLSearchParams(location.search)
    reportedTarget.current = null
    const design = decodeDesign(target.hash)
    const plan = params.get('plan')
    const time = params.get('time')
    const view = params.get('view')
    setState({
      ...design,
      ...(plan && planById(plan) ? { planId: plan, sheet: null } : {}),
      ...(time ? { time } : {}),
      ...(view ? { viewId: view } : {}),
      ...(params.get('sheet') === 'none' || !isStudioRoute('', location.search) ? { sheet: null } : {}),
      editing: false,
      photo: null,
    })
    setAppliedTarget(target)
  }, [booted, target])

  useEffect(() => {
    if (!booted || appliedTarget !== target) return
    let cancelled = false
    const report = (progress: number, error?: string) => {
      if (!cancelled && reportedTarget.current !== target) onLoad({ target, progress, error })
    }
    report(9)
    window.__ready = false
    loadQueue.current = loadQueue.current.then(async () => {
      const waitForPage = async () => {
        do {
          await afterPaint()
        } while (!cancelled && !latest.current.visible && !latest.current.requested &&
          performance.now() - lastScroll.current < 120)
      }
      await waitForPage()
      const currentEngine = engine
      const currentNav = nav
      if (cancelled || !currentEngine || !currentNav) return
      const s = getState()
      const p = planFor(planId)
      const start = designView(p, s.viewId) ?? p.views[0]
      currentEngine.paused = true
      currentEngine.stop()
      const progress = (p: number, label: string) => {
        if (cancelled) return
        setState({ loading: { p, label } })
        report(Math.round(9 + p * 85))
      }
      engineProgress.current = progress
      progress(0, 'Building the house')
      try {
        const finishes = s.finishes[p.id] ?? p.finishes
        const previous = loaded.current
        loaded.current = null
        const reusePlan = currentEngine.plan === p && previous
        if (reusePlan) {
          progress(0.75, 'Applying the design')
          // Use the same setters as the Style panel, then wait for all new assets.
          for (const [zone, option] of Object.entries(finishes)) {
            if (previous.finishes[zone] !== option) currentEngine.setFinish(zone, option)
          }
          if (previous.time !== s.time) await currentEngine.setTime(s.time)
          await currentEngine.lib.bank.ready()
        } else {
          await currentEngine.loadPlan(p, finishes, s.time, start, waitForPage)
        }
        loaded.current = { time: s.time, finishes }
        if (cancelled) return
        fitToCanvas.current?.()
        currentNav.setBounds(currentEngine.house!.bounds)
        if (currentNav.mode === 'dollhouse') currentNav.setMode('orbit', false)
        currentNav.goToView(start, false)
        setViewId(start.id)
        setState({ mode: start.kind === 'walk' ? 'walk' : 'orbit' })
        await waitForPage()
        if (cancelled) return
        progress(1, 'Preparing the first view')
        if (!reusePlan) await currentEngine.prepareFrame()
        if (cancelled) return
        // Warm the actual entry camera in the hidden canvas. Stop after one frame
        // so previewing the website doesn't also run the accumulation loop.
        await new Promise<void>(resolve => {
          firstFrame.current = () => {
            firstFrame.current = null
            if (!latest.current.visible) {
              currentEngine.paused = true
              currentEngine.stop()
            }
            resolve()
          }
          currentEngine.paused = false
          currentEngine.start()
        })
        if (cancelled) return
        setState({ loading: null })
        window.__ready = true
        report(100)
        reportedTarget.current = target
      } catch (error) {
        console.error(error)
        if (cancelled) return
        const why = error instanceof Error ? error.message : String(error)
        setState({ loading: { p: 1, label: 'Could not load this home.', error: why.slice(0, 180) } })
        report(94, why)
      }
    })
    return () => {
      cancelled = true
    }
  }, [booted, appliedTarget, target, planId, attempt, onLoad])

  useEffect(() => {
    if (!engine || !nav) return
    if (visible) fitToCanvas.current?.()
    nav.enabled = visible
    if (!visible && !firstFrame.current) {
      engine.paused = true
      engine.stop()
    } else if (visible && window.__ready) {
      engine.paused = false
      engine.start()
    }
  }, [visible, booted])

  const pickPlan = (id: string) => {
    setState({ sheet: matchMedia('(max-width: 899px)').matches ? null : getState().sheet === 'plans' ? 'plans' : null })
    if (id === getState().planId) {
      setState({ sheet: null })
      return
    }
    setState({ planId: id, mode: 'orbit', editing: false, viewId: null })
  }

  const stepPlan = (d: number) => {
    const i = PLANS.findIndex(p => p.id === planId)
    const next = PLANS[(i + d + PLANS.length) % PLANS.length]
    setState({ planId: next.id, mode: 'orbit', editing: false, viewId: null, sheet: getState().sheet === 'plans' ? 'plans' : null })
  }

  const setMode = (m: UiMode, level?: string) => {
    if (!nav || !engine) return
    setState({ viewId: null })
    if (m === 'plan') {
      setOpenedLevel(level)
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
    setState({ mode: v.kind === 'walk' ? 'walk' : 'orbit', viewId: v.id })
  }

  const onFinish = (zone: string, opt: string) => {
    loaded.current = null
    setState(s => ({ finishes: { ...s.finishes, [s.planId]: { ...s.finishes[s.planId], [zone]: opt } } }))
    engine?.setFinish(zone, opt)
  }

  const onTime = (id: string) => {
    setState({ time: id })
    loaded.current = null
    loadQueue.current = loadQueue.current.then(async () => {
      try {
        await engine?.setTime(id)
      } catch (error) {
        console.error(error)
        toast('Could not change the lighting')
      }
    })
  }

  const roomWalk = (roomId: string, x: number, z: number) => {
    if (!nav || !engine) return
    const r = plan.rooms.find(rr => rr.id === roomId)
    const preset = plan.views.find(v => v.room === roomId)
    if (preset) {
      nav.goToView(preset)
    } else if (r) {
      const fy = levelFloor(plan, r.level)
      const frame = plan.blocks.find(b => b.id === r.frame)
      const [lx, lz] = framePoint(frame, x, z, true)
      const [px, pz] = framePoint(frame, lx, Math.max(lz, Math.min(r.rect[3] - 0.6, lz + 1.2)))
      const [tx, tz] = framePoint(frame, (r.rect[0] + r.rect[2]) / 2, r.rect[1] + 0.3)
      nav.goToView({ id: 'room', label: r.name, kind: 'walk', pos: [px, fy + 1.62, pz], target: [tx, fy + 1.2, tz], fov: 66 })
    }
    setState({ mode: 'walk', viewId: preset?.id ?? null })
  }

  const exteriorViews = plan.views.filter(v => v.kind === 'orbit' && !v.id.startsWith('test'))
  const walkViews = plan.views.filter(v => v.kind === 'walk')
  const chips = mode === 'walk' ? walkViews : exteriorViews

  return (
    <div className={`app mode-${mode} ${sheet ? `has-${sheet}` : ''} ${editing && editorModule ? 'is-editing' : ''}`}>
      <canvas ref={canvasRef} className="stage" />

      {visible && <div className="hud">
        <header className="topbar">
          <a className="brand studio-home" href="#home" aria-label="Cuby Studio home">
            <img src="./cuby.svg" alt="" width={28} height={28} />
            <span className="brand-word">Cuby</span>
          </a>
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
          <button className="icon-btn" onClick={() => {
            loaded.current = null
            setState({ editing: !editing, sheet: null })
          }} aria-label="Edit plan" aria-pressed={editing}>
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

        {mode === 'walk' && (plan.levels && plan.levels.length > 1 ? (
          <FloorPlan className="minimap" plan={plan} you={you} compact onOpen={level => setMode('plan', level)} />
        ) : (
          <button className="minimap" onClick={() => setMode('plan')} aria-label="Open floor plan">
            <FloorPlan plan={plan} you={you} compact />
          </button>
        ))}

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
            <FloorPlan className="plan-big" plan={plan} you={plan.levels ? you : null} initialLevel={openedLevel} onRoom={roomWalk} rotate={portrait && plan.facts.width > plan.facts.depth * 1.15} />
            <p className="note center">Tap a room to stand in it.</p>
          </div>
        )}

        {sheet === 'plans' && <PlanSheet onPick={pickPlan} />}
        {sheet === 'customize' && <CustomizePanel onFinish={onFinish} onTime={onTime} />}
        {sheet === 'share' && <ShareSheet />}
        {sheet === 'help' && <HelpSheet />}
        {editing && engine && editorModule && <editorModule.Editor engine={engine} plan={plan} onClose={() => setState({ editing: false })} />}
        {photo && engine && photoModule && <photoModule.PhotoMode engine={engine} />}

        {loading && (
          <div className="loading" role="status" aria-live="polite">
            <div className="loading-card">
              <p className="eyebrow">Cuby Homes</p>
              <h1>{plan.name}</h1>
              <p className="loading-label">{loading.label}</p>
              {loading.error !== undefined ? (
                <>
                  <p className="loading-error">{loading.error}</p>
                  <button type="button" className="btn loading-retry" onClick={() => booted ? setAttempt(a => a + 1) : setBootAttempt(a => a + 1)}>
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
      </div>}
    </div>
  )
}

export { THREE }
