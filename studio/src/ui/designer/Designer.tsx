import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PLANS } from '../../plans'
import { FOOTPRINTS } from '../../plans/footprints'
import { MAIN_LEVEL } from '../../engine/house/levels'
import type { Block, HomePlan, Rect, RoomDef, RoomType } from '../../engine/house/types'
import { DRAFT_CODE, designerSource, PRESENTATION_ROUTE } from '../routes'
import { applyGesture, itemOnLevel, removeItem, splitRoom, type Gesture, type Selection, type Tool } from './actions'
import { decodeDocument, encodeDocument, historyReducer, MAX_LINK, newDocumentId, readDocuments, saveDocument, startHistory } from './documents'
import { blocksAt, OPENING_CATALOG, stepFor, type Units } from './geometry'
import { guidance } from './guidance'
import { Inspector, type Mutation } from './Inspector'
import { PlanCanvas } from './PlanCanvas'
import { addUpper, applyPlanEdit, findStair, groundLevel, newDesign, ROOM_TYPES, type Design } from './plan'
import './designer.css'

export interface DesignerProps {
  hash: string
  visible: boolean
  previewing: boolean
  cutaway: boolean
  onOpen(plan: HomePlan): void
  onPlan(plan: HomePlan): void
  onWalk(): void
  onPreviewMode(mode: 'orbit' | 'dollhouse'): void
  onFitView(): void
  onPhoneView(show: boolean): void
  busy: boolean
  previewError?: string
  onRetry(): void
}

const tools: { tool: Tool; label: string; glyph: string }[] = [
  { tool: 'select', label: 'Select', glyph: '↖' }, { tool: 'volume', label: 'Volume', glyph: '□' },
  { tool: 'room', label: 'Room', glyph: '⊞' }, { tool: 'wall', label: 'Wall', glyph: '╱' },
  { tool: 'opening', label: 'Opening', glyph: '⊏' }, { tool: 'stair', label: 'Stair', glyph: '↟' },
  { tool: 'deck', label: 'Deck', glyph: '▤' }, { tool: 'terrace', label: 'Terrace', glyph: '▧' },
  { tool: 'pan', label: 'Pan', glyph: '✥' },
]
const tips: Record<Tool, string> = {
  select: 'Select a shape or opening. Drag an edge to resize.',
  volume: 'Drag between opposite corners of the volume.',
  room: 'Drag a rectangle inside the footprint.',
  wall: 'Drag between two points. Walls snap to 45°.',
  opening: 'Tap a wall to place the opening.',
  stair: 'On the upper level, drag from the top landing in the direction of descent.',
  deck: 'Draw a rectangle outside the ground-floor footprint.',
  terrace: 'Draw a rectangle outside the ground-floor footprint.',
  pan: 'Drag to move the plan.',
}

function FootprintMark({ rects, stacked }: { rects: Rect[]; stacked?: boolean }) {
  const w = Math.max(...rects.map(r => r[2])) - Math.min(...rects.map(r => r[0]))
  const h = Math.max(...rects.map(r => r[3])) - Math.min(...rects.map(r => r[1]))
  const x = Math.min(...rects.map(r => r[0])) + w / 2
  const z = Math.min(...rects.map(r => r[1])) + h / 2
  return <svg viewBox={`${x - 11} ${z - 9} 22 18`} aria-hidden="true" className={stacked ? 'ds-template-icon is-stacked' : 'ds-template-icon'}>
    <path d={`M${x - 9} ${z + 7.5}h18M${x - 9} ${z - 7.5}h18M${x - 9} ${z - 7.5}v15M${x + 9} ${z - 7.5}v15`} />
    {rects.map(([a, c, d, e], i) => <rect key={i} x={a} y={c} width={d - a} height={e - c} />)}
    {stacked && <rect className="ds-template-upper" x={x - 3.6} y={z - 3.1} width={7.2} height={6.2} />}
  </svg>
}

function PasteDesign({ onImport }: { onImport(d: Design): void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  return <div className="ds-import">
    {!open ? <button type="button" className="ds-secondary" onClick={() => setOpen(true)}>Open a design code</button>
      : <form onSubmit={e => {
        e.preventDefault()
        const d = decodeDocument(value, newDocumentId())
        setInvalid(!d)
        if (d) onImport(d)
      }}>
        <label htmlFor="ds-import-code">Design code or share link</label>
        <textarea id="ds-import-code" maxLength={110000} value={value} onChange={e => { setValue(e.target.value); setInvalid(false) }} spellCheck={false} />
        <div className="ds-import-actions">
          <button className="ds-primary" type="submit" disabled={!value.trim()}>Open design</button>
          <button className="ds-quiet" type="button" onClick={() => setOpen(false)}>Cancel</button>
        </div>
        {invalid && <p role="alert" className="ds-error-text">This design code could not be opened. Check that the whole code was copied.</p>}
      </form>}
  </div>
}

function ShareDialog({ source, plan, close }: { source: string; plan: HomePlan; close(): void }) {
  const code = useMemo(() => encodeDocument({ source, plan }), [source, plan])
  const url = new URL(location.href)
  for (const flag of ['plan', 'time', 'view', 'sheet', 'ui', 'gallery']) url.searchParams.delete(flag)
  url.hash = code
  const fits = url.href.length <= MAX_LINK
  const value = fits ? url.href : code
  const [status, setStatus] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const fallback = () => {
    input.current?.focus()
    input.current?.select()
    setStatus('Selected. Copy the text to share it.')
  }
  return <dialog className="ds-share" ref={dialog} onCancel={close}>
    <div className="ds-share-head"><h2>Share {plan.name}</h2><button className="ds-quiet" type="button" onClick={close} aria-label="Close share">×</button></div>
    <p>{fits ? 'Open this link to load a copy of this design.' : 'This design is too large for a link. The recipient can paste the code into Open a design code.'}</p>
    <textarea ref={input} readOnly aria-label={fits ? 'Design share link' : 'Design code'} value={value} onFocus={e => e.currentTarget.select()} />
    <div className="ds-share-buttons">
      <button type="button" className="ds-primary" onClick={() => {
        if (!navigator.clipboard?.writeText) { fallback(); return }
        void navigator.clipboard.writeText(value).then(() => setStatus('Copied.'), fallback)
      }}>{fits ? 'Copy link' : 'Copy code'}</button>
      <button type="button" className="ds-secondary" onClick={fallback}>Select text</button>
    </div>
    <p role="status">{status}</p>
  </dialog>
}

export function Designer(props: DesignerProps) {
  const [decoded] = useState(() => props.hash.startsWith(`#${DRAFT_CODE}`) ? decodeDocument(props.hash, newDocumentId()) : undefined)
  const [docs, setDocs] = useState(readDocuments)
  const [active, setActive] = useState<Design | undefined>(decoded)
  const [saved, setSaved] = useState(true)
  const [showProjects, setShowProjects] = useState(!decoded)
  const [creating, setCreating] = useState(!decoded)
  const namedSource = designerSource(props.hash)

  const persist = (next: Design) => {
    setActive(next)
    setDocs(current => [next, ...current.filter(d => d.plan.id !== next.plan.id)])
    setSaved(saveDocument(next))
  }
  const open = (d: Design) => {
    persist(d)
    props.onOpen(d.plan)
    setShowProjects(false)
    setCreating(false)
  }
  useEffect(() => {
    if (decoded) open(decoded)
  }, [])

  const create = (source: string) => {
    const design = newDesign(source, newDocumentId())
    if (design) open(design)
  }

  return <>
    {active && <Workspace key={active.plan.id} {...props} visible={!showProjects && props.visible} design={active} saved={saved}
      onSave={persist} onProjects={() => { setShowProjects(true); setCreating(false) }} />}
    {props.visible && showProjects && <section className="ds-start" aria-label="Start a home design">
      <header className="ds-start-header">
        <a href="#home" aria-label="Cuby Homes website" className="ds-wordmark"><img src="./cuby.svg" alt="" /> Cuby Studio</a>
        {active ? <button type="button" className="ds-secondary" onClick={() => setShowProjects(false)}>Back to design</button>
          : <a className="ds-secondary" href={PRESENTATION_ROUTE}>Explore homes</a>}
      </header>
      <div className="ds-start-scroll">
        <div className="ds-start-body">
          <div className="ds-start-title">
            <h1>Design your own home</h1>
            <p>Start with a footprint on the Cuby hillside, then shape the rooms, rooflines, and finishes.</p>
          </div>
          {props.hash.startsWith(`#${DRAFT_CODE}`) && !decoded && (
            <p className="ds-error-text" role="alert">This share link could not be opened. Paste the full design code below or start a new design.</p>
          )}
          {docs.length > 0 && <section className="ds-saved" aria-labelledby="ds-saved-heading">
            <div className="ds-section-heading"><h2 id="ds-saved-heading">Your designs</h2>
              <button type="button" className={creating ? 'ds-quiet' : 'ds-primary'} onClick={() => setCreating(!creating)} aria-expanded={creating}>
                {creating ? 'Hide templates' : 'New design'}
              </button>
            </div>
            <div className="ds-saved-list">{docs.map(d => <button type="button" onClick={() => open(d)} key={d.plan.id}>
              <span>{d.plan.name}</span>
              <small>{d.plan.facts.area.toLocaleString()} ft² · {d.plan.facts.stories} {d.plan.facts.stories === 1 ? 'level' : 'levels'}</small>
              <span aria-hidden="true">↗</span>
            </button>)}</div>
          </section>}
          {creating && <>
            <section aria-labelledby="ds-footprints-heading">
              <h2 id="ds-footprints-heading">Footprint templates</h2>
              <div className="ds-template-grid">{FOOTPRINTS.map(t => <button type="button" className="ds-template" key={t.id} onClick={() => create(t.id)}>
                <FootprintMark rects={t.rects} stacked={t.id === 'box'} />
                <strong>{t.name}</strong><span>{t.description}</span>
              </button>)}</div>
            </section>
            <section aria-labelledby="ds-duplicate-heading">
              <h2 id="ds-duplicate-heading">Duplicate a presentation home</h2>
              <div className="ds-duplicate-list">{[...PLANS].sort((a, b) => Number(b.id === namedSource) - Number(a.id === namedSource)).map(p =>
                <button type="button" className={`ds-secondary${p.id === namedSource ? ' is-source' : ''}`} key={p.id} onClick={() => create(p.id)}>
                  {p.name}<span aria-hidden="true">↗</span>
                </button>)}</div>
            </section>
          </>}
          <PasteDesign onImport={open} />
        </div>
      </div>
    </section>}
  </>
}

interface WorkspaceProps extends DesignerProps {
  design: Design
  saved: boolean
  onSave(design: Design): void
  onProjects(): void
}

function Workspace({ design, saved, visible, previewing, cutaway, onSave, onProjects, onPlan, onWalk, onPreviewMode, onFitView, onPhoneView, previewError, busy, onRetry }: WorkspaceProps) {
  const [history, dispatch] = useReducer(historyReducer, design.plan, startHistory)
  const plan = history.plan
  const [units, setUnits] = useState<Units>('ft')
  const [storey, setStorey] = useState<string | undefined>()
  const [selectedItem, setSelected] = useState<Selection | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [canvasKey, resetCanvas] = useReducer((i: number) => i + 1, 0)
  const [roomType, setRoom] = useState<RoomType>('bedroom')
  const [catalog, setCatalog] = useState(0)
  const [alert, setAlert] = useState('')
  const [phoneScene, setPhoneScene] = useState(false)
  const [share, setShare] = useState(false)
  const levels = plan.levels ?? [MAIN_LEVEL]
  const level = levels.some(l => l.id === storey) ? storey! : groundLevel(plan)
  const selected = selectedItem && itemOnLevel(plan, selectedItem, level) ? selectedItem : null
  const notes = useMemo(() => guidance(plan), [plan])
  const lastPlan = useRef(plan)
  useEffect(() => {
    if (lastPlan.current === plan) return
    lastPlan.current = plan
    onSave({ source: design.source, plan })
    onPlan(plan)
  }, [plan, design.source, onPlan, onSave])
  useEffect(() => { onPhoneView(phoneScene && visible && !previewing) }, [phoneScene, visible, previewing, onPhoneView])

  const edit = (mutation: Mutation) => {
    const result = applyPlanEdit(plan, mutation)
    if (result.issue) {
      setAlert(result.issue)
      return false
    }
    setAlert('')
    if (result.plan) dispatch({ type: 'edit', plan: result.plan })
    return !!result.plan
  }
  const chooseTool = (name: Tool) => {
    if (tool === name && name !== 'select') setTool('select')
    else setTool(name)
    setAlert('')
  }
  const select = (item: Selection | null) => {
    setSelected(item)
    setAlert('')
    if (item && tool !== 'select') setTool('select')
  }
  const remove = () => {
    if (selected && edit(p => removeItem(p, selected))) setSelected(null)
  }

  useEffect(() => {
    if (!visible || previewing || share) return
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea, [contenteditable]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setAlert('')
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (e.key === 'Escape') {
        setTool('select')
        select(null)
      } else if (e.key === 'Delete') remove()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const gesture = (g: Gesture, radius: number) => {
    const next = structuredClone(plan)
    const item = applyGesture(next, g, level, roomType, catalog, stepFor(units), radius)
    if (typeof item === 'string') { setAlert(item); return }
    if (edit(p => Object.assign(p, next))) select(item)
  }

  const makeUpper = (block: Block) => {
    const next = structuredClone(plan)
    const upper = addUpper(next, block.id)
    if (!upper) {
      setAlert('Select a volume on the highest floor with room for a storey above.')
      return
    }
    const stair = findStair(next, upper.level, upper.block.rect)
    if (stair) next.stairs.push(stair)
    if (!edit(p => Object.assign(p, next))) return
    setStorey(upper.level)
    setSelected(stair ? { kind: 'stair', id: stair.id } : { kind: 'volume', id: upper.block.id })
    if (!stair) setAlert('The new floor is ready. Use Stair to place a flight with room at both landings.')
  }

  const autoStair = () => {
    const s = blocksAt(plan, level).map(b => findStair(plan, level, b.rect)).find(Boolean)
    if (!s) {
      setAlert('No clear stair position was found. Draw a flight or make more room for its landings.')
      return
    }
    if (edit(p => p.stairs.push(s))) select({ kind: 'stair', id: s.id })
  }

  const split = (room: RoomDef, axis: 0 | 1, at: number) => {
    const next = structuredClone(plan)
    const item = splitRoom(next, room, axis, at)
    if (!item) { setAlert('Leave at least 0.9 m on each side of the split.'); return }
    if (edit(p => Object.assign(p, next))) select(item)
  }

  if (!visible || previewing) return null
  const rename = (field: HTMLInputElement) => {
    const name = field.value.trim()
    field.value = name || plan.name
    if (name && name !== plan.name) edit(p => { p.name = name })
  }

  return <section className={`ds-workspace${phoneScene ? ' ds-show-scene' : ''}`} aria-label="Home designer">
    <header className="ds-header">
      <button className="ds-projects ds-quiet" type="button" onClick={onProjects}><span aria-hidden="true">‹</span> Designs</button>
      <div className="ds-title">
        <input key={plan.name} aria-label="Design name" defaultValue={plan.name} autoComplete="off" maxLength={72}
          onBlur={e => rename(e.currentTarget)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <small>{saved ? 'Saved on this device' : 'Saved for this visit'}</small>
      </div>
      <div className="ds-header-actions">
        <div className="ds-history">
          <button type="button" aria-label="Undo" title="Undo" disabled={!history.past.length} onClick={() => { setAlert(''); dispatch({ type: 'undo' }) }}>↶</button>
          <button type="button" aria-label="Redo" title="Redo" disabled={!history.future.length} onClick={() => { setAlert(''); dispatch({ type: 'redo' }) }}>↷</button>
        </div>
        <button className="ds-secondary" type="button" onClick={() => setShare(true)}>Share</button>
        <button className="ds-primary ds-walk" type="button" disabled={!!previewError} onClick={onWalk}><span>Walk through</span><span aria-hidden="true">↗</span></button>
      </div>
    </header>
    <div className="ds-panels">
      <div className="ds-plan-panel">
        <div className="ds-plan-header">
          <h2>Floor plan</h2>
          <div className="ds-levels" aria-label="Design floor">
            {levels.map(l => <button className="ds-level" key={l.id} type="button" aria-pressed={l.id === level} onClick={() => { setStorey(l.id); select(null) }}>{l.label}</button>)}
          </div>
          <select className="ds-units" value={units} aria-label="Drawing units" onChange={e => setUnits(e.target.value as Units)}>
            <option value="ft">ft</option><option value="m">m</option>
          </select>
        </div>
        <nav className="ds-tools" aria-label="Drawing tools">
          {tools.map(({ tool: name, label, glyph }) => <button type="button" key={name} aria-pressed={name === tool} onClick={() => chooseTool(name)}>
            <span aria-hidden="true">{glyph}</span><span>{label}</span>
          </button>)}
        </nav>
        {(tool === 'room' || tool === 'opening') && <div className="ds-tool-options">
          {tool === 'room' ? <label>Room type<select value={roomType} onChange={e => setRoom(e.target.value as RoomType)}>
            {ROOM_TYPES.map(r => <option value={r.type} key={r.type}>{r.label}</option>)}
          </select></label> : <label>Opening catalog<select value={catalog} onChange={e => setCatalog(Number(e.target.value))}>
            {OPENING_CATALOG.map(({ name }, i) => <option value={i} key={name}>{name}</option>)}
          </select></label>}
        </div>}
        <PlanCanvas key={`${level}:${canvasKey}`} plan={plan} level={level} units={units} tool={tool} catalog={catalog}
          selected={selected} onSelect={select} onGesture={gesture} />
        <p className={`ds-help-line${alert ? ' ds-error-text' : ''}`} role="status">{alert || tips[tool]}</p>
        <Inspector plan={plan} level={level} units={units} selected={selected} notes={notes} onSelect={select} onEdit={edit} onRemove={remove}
          onSplit={split} onUpper={makeUpper} onAutoStair={autoStair} />
      </div>
      <div className="ds-preview">
        <div className="ds-preview-toolbar">
          <h2>Live 3D</h2>
          <div>
            <button type="button" className="ds-secondary" onClick={onFitView}>Fit view</button>
            <button type="button" className="ds-secondary" aria-pressed={cutaway} onClick={() => onPreviewMode(cutaway ? 'orbit' : 'dollhouse')}>{cutaway ? 'Show roof' : 'Lift roof'}</button>
          </div>
        </div>
        {(busy || previewError) && <div className="ds-preview-message" role="status">
          <p>{previewError ? 'The 3D preview could not update.' : 'Building your home…'}</p>
          {previewError && <button type="button" className="ds-secondary" onClick={onRetry}>Try again</button>}
        </div>}
      </div>
    </div>
    <footer className="ds-footer">
      <div className="ds-facts" aria-label="Design facts">
        <span><b>{plan.facts.area.toLocaleString()}</b> ft²</span><span><b>{plan.facts.beds}</b> {plan.facts.beds === 1 ? 'bed' : 'beds'}</span>
        <span><b>{plan.facts.baths}</b> {plan.facts.baths === 1 ? 'bath' : 'baths'}</span><span><b>{plan.facts.stories}</b> {plan.facts.stories === 1 ? 'level' : 'levels'}</span>
      </div>
      <div className="ds-phone-toggle" aria-label="Designer view">
        <button type="button" aria-pressed={!phoneScene} onClick={() => { if (phoneScene) resetCanvas(); setPhoneScene(false) }}>Plan</button>
        <button type="button" aria-pressed={phoneScene} onClick={() => setPhoneScene(true)}>3D</button>
      </div>
    </footer>
    {share && <ShareDialog source={design.source} plan={plan} close={() => setShare(false)} />}
  </section>
}
