import { useEffect, useRef, useState } from 'react'
import type { Engine } from '../engine/Engine'
import type { Block, CladdingSpec, HomePlan, Opening, OpeningKind, Roof, Side } from '../engine/house/types'
import { sideFrame } from '../engine/house/massing'
import { ZONES } from '../engine/materials/catalog'
import { planById } from '../plans'
import { feetInches, planGeometry } from './FloorPlan'
import { Icon } from './icons'
import { getState, saveCustom, setState, toast } from './store'
import { clone, moveBlockEdge, sideLen, snap } from './planEdits'

type Sel = { kind: 'block'; id: string } | { kind: 'opening'; index: number } | { kind: 'wall'; id: string } | null
type Tool = 'select' | 'window' | 'door' | 'slider' | 'wall'

const CLADDINGS: { label: string; spec: CladdingSpec }[] = [
  { label: 'Cedar boards', spec: { zone: 'cedar', kind: 'boards' } },
  { label: 'Metal panel', spec: { zone: 'panel', kind: 'panel' } },
  { label: 'Light metal panel', spec: { zone: 'panel2', kind: 'panel' } },
  { label: 'Board & batten', spec: { zone: 'body', kind: 'batten' } },
  { label: 'Painted siding', spec: { zone: 'coastal', kind: 'boards' } },
  { label: 'Stucco', spec: { zone: 'stucco', kind: 'stucco' } },
]

const OPENING_KINDS: { kind: OpeningKind; label: string; w: number; h: number; sill: number }[] = [
  { kind: 'window', label: 'Window', w: 1.6, h: 1.4, sill: 0.85 },
  { kind: 'fixed', label: 'Picture window', w: 2.0, h: 2.2, sill: 0.3 },
  { kind: 'slider', label: 'Sliding door', w: 2.6, h: 2.3, sill: 0 },
  { kind: 'door', label: 'Glass door', w: 0.95, h: 2.2, sill: 0 },
  { kind: 'entry', label: 'Entry door', w: 1.1, h: 2.4, sill: 0 },
  { kind: 'clerestory', label: 'Clerestory', w: 2.4, h: 0.7, sill: 2.4 },
  { kind: 'garage', label: 'Garage door', w: 4.8, h: 2.3, sill: 0 },
]

/** Plan bounds plus a margin to grow into, as an SVG view box. */
function viewBoxFor(p: HomePlan) {
  const [x0, z0, x1, z1] = planGeometry(p).bounds
  const m = 4
  return { x: x0 - m, y: z0 - m, w: x1 - x0 + m * 2, h: z1 - z0 + m * 2 }
}

function roofHeights(r: Roof): [number, number] {
  if (r.type === 'shed') return [r.low, r.high]
  if (r.type === 'gable') return [r.eave, r.ridge]
  return [r.height, r.height]
}

export function Editor({ engine, plan, onClose }: { engine: Engine; plan: HomePlan; onClose: () => void }) {
  const [draft, setDraft] = useState<HomePlan>(plan)
  const [sel, setSel] = useState<Sel>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [show3d, setShow3d] = useState(false)
  const hist = useRef<{ past: HomePlan[]; future: HomePlan[] }>({ past: [], future: [] })
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<null | { kind: 'edge'; id: string; side: Side; start: HomePlan } | { kind: 'opening'; index: number; start: HomePlan } | { kind: 'wall'; id: string; start: HomePlan; p0: [number, number] } | { kind: 'draw'; a: [number, number]; b: [number, number] }>(null)
  const [drawLine, setDrawLine] = useState<null | { a: [number, number]; b: [number, number] }>(null)
  const timer = useRef(0)

  // The view box stays put while a finger or mouse drags, so the drawing never rescales under it. Once an edit
  // leaves the view (a long drag on a small phone drawing, undo, a new volume) it is refitted.
  const [vb, setVb] = useState(() => viewBoxFor(plan))
  const fitIfOutside = (p: HomePlan) => {
    const [x0, z0, x1, z1] = planGeometry(p).bounds
    const pad = 1
    if (x0 - pad < vb.x || z0 - pad < vb.y || x1 + pad > vb.x + vb.w || z1 + pad > vb.y + vb.h) setVb(viewBoxFor(p))
  }
  useEffect(() => {
    if (!drag.current) fitIfOutside(draft)
  }, [draft])

  const push = (next: HomePlan) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      engine.rebuildHouse(next)
      const custom = { ...getState().customPlans, [next.id]: next }
      setState({ customPlans: custom })
      saveCustom(custom)
    }, 90)
  }

  const commit = (next: HomePlan, prev: HomePlan = draft) => {
    hist.current.past.push(prev)
    if (hist.current.past.length > 80) hist.current.past.shift()
    hist.current.future = []
    setDraft(next)
    push(next)
  }

  const undo = () => {
    const prev = hist.current.past.pop()
    if (!prev) return
    hist.current.future.push(draft)
    setDraft(prev)
    push(prev)
  }
  const redo = () => {
    const next = hist.current.future.pop()
    if (!next) return
    hist.current.past.push(draft)
    setDraft(next)
    push(next)
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') removeSelection()
      else if (e.key === 'Escape') {
        setSel(null)
        setTool('select')
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const toPlan = (e: { clientX: number; clientY: number }): [number, number] => {
    const s = svg.current!
    const pt = s.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(s.getScreenCTM()!.inverse())
    return [p.x, p.y]
  }

  // ------------------------------------------------------------------ pointer handling
  const onDown = (e: React.PointerEvent, target: NonNullable<typeof drag.current>) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = target
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const [x, z] = toPlan(e)
    if (d.kind === 'edge') {
      const v = snap(d.side === 'w' || d.side === 'e' ? x : z)
      setDraft(moveBlockEdge(d.start, d.id, d.side, v))
    } else if (d.kind === 'opening') {
      const p = clone(d.start)
      const o = p.openings[d.index]
      if (o.block) {
        const b = p.blocks.find(bb => bb.id === o.block)!
        const f = sideFrame(b.rect, o.side!)
        const u = (x - f.sx) * f.dx + (z - f.sz) * f.dz
        o.at = Math.min(Math.max(snap(u), o.width / 2 + 0.15), f.length - o.width / 2 - 0.15)
      } else if (o.wall) {
        const w = p.walls.find(ww => ww.id === o.wall)!
        const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
        const u = ((x - w.a[0]) * (w.b[0] - w.a[0]) + (z - w.a[1]) * (w.b[1] - w.a[1])) / L
        o.at = Math.min(Math.max(snap(u), o.width / 2 + 0.1), L - o.width / 2 - 0.1)
      }
      setDraft(p)
    } else if (d.kind === 'wall') {
      const p = clone(d.start)
      const w = p.walls.find(ww => ww.id === d.id)!
      const horiz = Math.abs(w.a[1] - w.b[1]) < 0.01
      if (horiz) {
        const dz = snap(z - d.p0[1])
        w.a[1] += dz
        w.b[1] += dz
      } else {
        const dx = snap(x - d.p0[0])
        w.a[0] += dx
        w.b[0] += dx
      }
      setDraft(p)
    } else if (d.kind === 'draw') {
      // axis-locked wall
      const ax = Math.abs(x - d.a[0]) > Math.abs(z - d.a[1])
      d.b = ax ? [snap(x), d.a[1]] : [d.a[0], snap(z)]
      setDrawLine({ a: d.a, b: d.b })
    }
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'draw') {
      setDrawLine(null)
      const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1])
      if (len < 0.6) return
      const p = clone(draft)
      const id = `w${Date.now().toString(36)}`
      p.walls.push({ id, a: d.a, b: d.b })
      commit(p)
      setSel({ kind: 'wall', id })
      setTool('select')
      return
    }
    if ('start' in d && d.start !== draft) commit(draft, d.start)
    // committing the same draft does not re-render, so refit here rather than in the effect
    fitIfOutside(draft)
  }

  const onCanvasDown = (e: React.PointerEvent) => {
    const [x, z] = toPlan(e)
    if (tool === 'wall') {
      const a: [number, number] = [snap(x), snap(z)]
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      drag.current = { kind: 'draw', a, b: a }
      setDrawLine({ a, b: a })
      return
    }
    if (tool === 'window' || tool === 'door' || tool === 'slider') {
      // nearest exterior side
      let best: { b: Block; s: Side; u: number; d: number } | null = null
      for (const b of draft.blocks)
        for (const s of ['n', 's', 'e', 'w'] as Side[]) {
          const f = sideFrame(b.rect, s)
          const u = (x - f.sx) * f.dx + (z - f.sz) * f.dz
          if (u < 0 || u > f.length) continue
          const d = Math.abs((x - f.sx) * f.ox + (z - f.sz) * f.oz)
          if (!best || d < best.d) best = { b, s, u, d }
        }
      if (!best || best.d > 0.8) {
        toast('Tap on an outside wall to place it')
        return
      }
      const kind: OpeningKind = tool === 'window' ? 'window' : tool === 'door' ? 'door' : 'slider'
      const def = OPENING_KINDS.find(k => k.kind === kind)!
      const len = sideLen(best.b, best.s)
      if (def.w > len - 0.4) {
        toast('That wall is too short for this opening')
        return
      }
      const p = clone(draft)
      const o: Opening = { block: best.b.id, side: best.s, at: Math.min(Math.max(snap(best.u), def.w / 2 + 0.15), len - def.w / 2 - 0.15), width: def.w, height: def.h, sill: def.sill, kind }
      if (kind === 'slider') o.id = `slider-open-${Date.now().toString(36)}`
      p.openings.push(o)
      commit(p)
      setSel({ kind: 'opening', index: p.openings.length - 1 })
      setTool('select')
      return
    }
    setSel(null)
  }

  // ------------------------------------------------------------------ edits from the inspector
  const removeSelection = () => {
    if (!sel) return
    const p = clone(draft)
    if (sel.kind === 'opening') p.openings.splice(sel.index, 1)
    else if (sel.kind === 'wall') {
      p.walls = p.walls.filter(w => w.id !== sel.id)
      p.openings = p.openings.filter(o => o.wall !== sel.id)
    } else if (sel.kind === 'block') {
      if (p.blocks.length <= 1) {
        toast('A home needs at least one volume')
        return
      }
      p.blocks = p.blocks.filter(b => b.id !== sel.id)
      p.openings = p.openings.filter(o => o.block !== sel.id)
    }
    commit(p)
    setSel(null)
  }

  const updateBlock = (id: string, f: (b: Block) => void) => {
    const p = clone(draft)
    const b = p.blocks.find(x => x.id === id)!
    f(b)
    for (const z of new Set(p.blocks.flatMap(bb => [bb.cladding.default.zone, ...Object.values(bb.cladding).map(c => (c as CladdingSpec).zone)]))) {
      if (!p.zones.includes(z) && ZONES[z]) {
        p.zones = [...p.zones.filter(zz => zz !== 'palette'), z, 'palette']
        p.finishes[z] = ZONES[z].options[0].id
        setState(s => ({ finishes: { ...s.finishes, [p.id]: { ...s.finishes[p.id], [z]: ZONES[z].options[0].id } } }))
      }
    }
    commit(p)
  }

  const updateOpening = (i: number, f: (o: Opening) => void) => {
    const p = clone(draft)
    f(p.openings[i])
    const o = p.openings[i]
    if (o.block) {
      const b = p.blocks.find(x => x.id === o.block)!
      const len = sideLen(b, o.side!)
      o.width = Math.min(o.width, len - 0.3)
      o.at = Math.min(Math.max(o.at, o.width / 2 + 0.15), len - o.width / 2 - 0.15)
    }
    commit(p)
  }

  const addVolume = () => {
    const p = clone(draft)
    // a 5 x 5 m room attached to the east side of the right-most block
    const right = [...p.blocks].sort((a, b) => b.rect[2] - a.rect[2])[0]
    const id = `v${Date.now().toString(36)}`
    const z1 = right.rect[3]
    const b: Block = {
      id,
      rect: [right.rect[2], z1 - 5, right.rect[2] + 5, z1],
      roof: { type: 'shed', low: 2.8, high: 3.2, rises: 'n', overhang: { s: 0.5, n: 0.4, e: 0.4, w: 0 } },
      cladding: { default: { ...right.cladding.default } },
      ceiling: 'vaulted',
    }
    p.blocks.push(b)
    p.rooms.push({ id: `r${id}`, name: 'New room', type: 'bedroom', rect: [...b.rect] })
    p.openings.push({ block: id, side: 's', at: 2.5, width: 1.6, height: 1.5, sill: 0.8, kind: 'window' })
    commit(p)
    setSel({ kind: 'block', id })
  }

  const reset = () => {
    const base = planById(plan.id)!
    const custom = { ...getState().customPlans }
    delete custom[plan.id]
    setState({ customPlans: custom })
    saveCustom(custom)
    hist.current.past.push(draft)
    setDraft(clone(base))
    engine.rebuildHouse(base)
    setSel(null)
    toast('Plan reset to the original')
  }

  const copyJson = () => {
    const text = JSON.stringify(draft, null, 1)
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast('Plan data copied'))
      .catch(() => toast('Copy is not available in this view'))
  }

  // ------------------------------------------------------------------ drawing
  const geo = planGeometry(draft)
  const selBlock = sel?.kind === 'block' ? draft.blocks.find(b => b.id === sel.id) : undefined
  const selOpening = sel?.kind === 'opening' ? draft.openings[sel.index] : undefined
  const selWall = sel?.kind === 'wall' ? draft.walls.find(w => w.id === sel.id) : undefined
  const area = Math.round(draft.blocks.filter(b => !b.utility).reduce((a, b) => a + (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]), 0) * 10.7639)

  const openingSegs = draft.openings.map((o, i) => {
    if (o.block) {
      const b = draft.blocks.find(x => x.id === o.block)
      if (!b) return null
      const f = sideFrame(b.rect, o.side!)
      const a = [f.sx + f.dx * (o.at - o.width / 2) - f.ox * 0.1, f.sz + f.dz * (o.at - o.width / 2) - f.oz * 0.1]
      const c = [f.sx + f.dx * (o.at + o.width / 2) - f.ox * 0.1, f.sz + f.dz * (o.at + o.width / 2) - f.oz * 0.1]
      return { i, a, c, o }
    }
    const w = draft.walls.find(x => x.id === o.wall)
    if (!w) return null
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const dx = (w.b[0] - w.a[0]) / L
    const dz = (w.b[1] - w.a[1]) / L
    return { i, a: [w.a[0] + dx * (o.at - o.width / 2), w.a[1] + dz * (o.at - o.width / 2)], c: [w.a[0] + dx * (o.at + o.width / 2), w.a[1] + dz * (o.at + o.width / 2)], o }
  })

  return (
    <div className={`editor ${show3d ? 'show-3d' : ''}`} onPointerMove={onMove} onPointerUp={onUp}>
      <header className="editor-head">
        <div>
          <p className="eyebrow">Editing · changes save in this browser</p>
          <h2>{draft.name}</h2>
          <p className="facts"><span>{area.toLocaleString('en-US')} sf conditioned</span><span>{draft.blocks.length} volumes</span><span>{draft.openings.filter(o => o.block).length} openings</span></p>
        </div>
        <div className="editor-head-actions">
          <button className="icon-btn" onClick={undo} aria-label="Undo" title="Undo"><Icon.left /></button>
          <button className="icon-btn" onClick={redo} aria-label="Redo" title="Redo"><Icon.right /></button>
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </header>

      <div className="editor-tools" role="toolbar" aria-label="Editing tools">
        {(
          [
            ['select', 'Select'],
            ['window', '+ Window'],
            ['door', '+ Door'],
            ['slider', '+ Slider'],
            ['wall', 'Draw wall'],
          ] as const
        ).map(([t, label]) => (
          <button key={t} className={`tool ${tool === t ? 'is-on' : ''}`} onClick={() => setTool(t)}>
            {label}
          </button>
        ))}
        <button className="tool" onClick={addVolume}>+ Volume</button>
        <button className="tool tool-3d" onClick={() => setShow3d(!show3d)}>{show3d ? 'Plan' : '3D'}</button>
      </div>

      <div className="editor-canvas">
        <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" onPointerDown={onCanvasDown} className={`tool-${tool}`}>
          <defs>
            <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M1 0H0V1" fill="none" stroke="var(--grid)" strokeWidth="0.02" />
            </pattern>
          </defs>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#grid)" />
          {draft.decks.map(d => <rect key={d.id} x={d.rect[0]} y={d.rect[1]} width={d.rect[2] - d.rect[0]} height={d.rect[3] - d.rect[1]} fill="var(--plan-outdoor)" />)}
          {draft.terraces.map(t => <rect key={t.id} x={t.rect[0]} y={t.rect[1]} width={t.rect[2] - t.rect[0]} height={t.rect[3] - t.rect[1]} fill="var(--plan-outdoor)" opacity={0.7} />)}
          {draft.blocks.map(b => (
            <rect
              key={b.id}
              x={b.rect[0]}
              y={b.rect[1]}
              width={b.rect[2] - b.rect[0]}
              height={b.rect[3] - b.rect[1]}
              className={`ed-block ${sel?.kind === 'block' && sel.id === b.id ? 'is-sel' : ''}`}
              onPointerDown={e => {
                if (tool !== 'select') return
                e.stopPropagation()
                setSel({ kind: 'block', id: b.id })
              }}
            />
          ))}
          {draft.rooms.map(r => (
            <text key={r.id} x={(r.rect[0] + r.rect[2]) / 2} y={(r.rect[1] + r.rect[3]) / 2} className="plan-label ed-label" fontSize={0.34} textAnchor="middle">
              {r.name}
            </text>
          ))}
          {geo.exterior.map((s, i) => <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke="var(--plan-wall)" strokeWidth={0.22} strokeLinecap="square" pointerEvents="none" />)}
          {draft.walls.map(w => (
            <g key={w.id}>
              <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke={sel?.kind === 'wall' && sel.id === w.id ? 'var(--accent-strong)' : 'var(--plan-wall)'} strokeWidth={0.12} />
              <line
                x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke="transparent" strokeWidth={0.6} className="ed-hit"
                onPointerDown={e => {
                  if (tool !== 'select') return
                  setSel({ kind: 'wall', id: w.id })
                  onDown(e, { kind: 'wall', id: w.id, start: draft, p0: toPlan(e) })
                }}
              />
            </g>
          ))}
          {openingSegs.map(s =>
            s ? (
              <g key={s.i}>
                <line x1={s.a[0]} y1={s.a[1]} x2={s.c[0]} y2={s.c[1]} stroke="var(--plan-floor)" strokeWidth={0.26} pointerEvents="none" />
                <line x1={s.a[0]} y1={s.a[1]} x2={s.c[0]} y2={s.c[1]} stroke={sel?.kind === 'opening' && sel.index === s.i ? 'var(--accent-strong)' : s.o.kind === 'window' || s.o.kind === 'fixed' || s.o.kind === 'clerestory' ? '#3d79a8' : '#8a5a2b'} strokeWidth={0.1} pointerEvents="none" />
                <line
                  x1={s.a[0]} y1={s.a[1]} x2={s.c[0]} y2={s.c[1]} stroke="transparent" strokeWidth={0.7} className="ed-hit"
                  onPointerDown={e => {
                    if (tool !== 'select') return
                    setSel({ kind: 'opening', index: s.i })
                    onDown(e, { kind: 'opening', index: s.i, start: draft })
                  }}
                />
              </g>
            ) : null,
          )}
          {selBlock &&
            (['n', 's', 'e', 'w'] as Side[]).map(side => {
              const [x0, z0, x1, z1] = selBlock.rect
              const p = side === 'n' ? [(x0 + x1) / 2, z0] : side === 's' ? [(x0 + x1) / 2, z1] : side === 'e' ? [x1, (z0 + z1) / 2] : [x0, (z0 + z1) / 2]
              const horiz = side === 'n' || side === 's'
              return (
                <g key={side}>
                  <line
                    x1={horiz ? x0 : p[0]} y1={horiz ? p[1] : z0} x2={horiz ? x1 : p[0]} y2={horiz ? p[1] : z1}
                    stroke="var(--accent-strong)" strokeWidth={0.08} strokeDasharray="0.3 0.2" pointerEvents="none"
                  />
                  <rect
                    x={p[0] - (horiz ? 0.5 : 0.22)} y={p[1] - (horiz ? 0.22 : 0.5)} width={horiz ? 1 : 0.44} height={horiz ? 0.44 : 1} rx={0.12}
                    className="ed-handle"
                    onPointerDown={e => onDown(e, { kind: 'edge', id: selBlock.id, side, start: draft })}
                  />
                </g>
              )
            })}
          {selBlock && (
            <g pointerEvents="none">
              <text x={(selBlock.rect[0] + selBlock.rect[2]) / 2} y={selBlock.rect[1] - 0.5} className="plan-dim ed-dim" fontSize={0.4} textAnchor="middle">
                {feetInches(selBlock.rect[2] - selBlock.rect[0])}
              </text>
              <text x={selBlock.rect[2] + 0.5} y={(selBlock.rect[1] + selBlock.rect[3]) / 2} className="plan-dim ed-dim" fontSize={0.4} textAnchor="start">
                {feetInches(selBlock.rect[3] - selBlock.rect[1])}
              </text>
            </g>
          )}
          {drawLine && <line x1={drawLine.a[0]} y1={drawLine.a[1]} x2={drawLine.b[0]} y2={drawLine.b[1]} stroke="var(--accent-strong)" strokeWidth={0.12} />}
        </svg>
        <p className="editor-tip">
          {tool === 'select' && !sel && 'Tap a volume, wall, window or door to change it. Drag the handles to resize.'}
          {tool === 'select' && sel?.kind === 'block' && 'Drag the orange handles to resize this volume. Touching volumes move with it.'}
          {tool === 'select' && sel?.kind === 'opening' && 'Drag along the wall to move it.'}
          {tool === 'select' && sel?.kind === 'wall' && 'Drag to move this wall.'}
          {(tool === 'window' || tool === 'door' || tool === 'slider') && 'Tap an outside wall to place it.'}
          {tool === 'wall' && 'Drag inside the house to draw a wall.'}
        </p>
      </div>

      <div className="inspector">
        {!sel && (
          <div className="insp-empty">
            <p className="note">Nothing selected.</p>
            <div className="insp-row">
              <button className="btn btn-ghost" onClick={copyJson}><Icon.copy /> Copy plan data</button>
              <button className="btn btn-ghost" onClick={reset}>Reset plan</button>
            </div>
          </div>
        )}
        {selBlock && (
          <div className="insp">
            <h3>Volume</h3>
            <label className="insp-field">
              <span>Roof</span>
              <select
                id="ed-roof"
                value={selBlock.roof.type}
                onChange={e => {
                  const [lo, hi] = roofHeights(selBlock.roof)
                  const t = e.target.value as Roof['type']
                  updateBlock(selBlock.id, b => {
                    const oh = b.roof.overhang
                    b.roof =
                      t === 'shed'
                        ? { type: 'shed', low: lo, high: Math.max(hi, lo + 0.6), rises: 'n', overhang: oh }
                        : t === 'gable'
                          ? { type: 'gable', eave: lo, ridge: Math.max(hi, lo + 1.6), ridgeAxis: b.rect[2] - b.rect[0] > b.rect[3] - b.rect[1] ? 'x' : 'z', overhang: oh }
                          : { type: 'flat', height: lo, overhang: oh }
                  })
                }}
              >
                <option value="shed">Shed</option>
                <option value="gable">Gable</option>
                <option value="flat">Flat</option>
              </select>
            </label>
            {selBlock.roof.type !== 'flat' && (
              <label className="insp-field">
                <span>{selBlock.roof.type === 'shed' ? 'Slopes up toward' : 'Ridge runs'}</span>
                <select
                  id="ed-dir"
                  value={selBlock.roof.type === 'shed' ? selBlock.roof.rises : selBlock.roof.ridgeAxis}
                  onChange={e =>
                    updateBlock(selBlock.id, b => {
                      if (b.roof.type === 'shed') b.roof.rises = e.target.value as Side
                      else if (b.roof.type === 'gable') b.roof.ridgeAxis = e.target.value as 'x' | 'z'
                    })
                  }
                >
                  {selBlock.roof.type === 'shed' ? (
                    <>
                      <option value="s">Front</option>
                      <option value="n">Back</option>
                      <option value="e">Right</option>
                      <option value="w">Left</option>
                    </>
                  ) : (
                    <>
                      <option value="x">Side to side</option>
                      <option value="z">Front to back</option>
                    </>
                  )}
                </select>
              </label>
            )}
            <Stepper
              label={selBlock.roof.type === 'flat' ? 'Ceiling height' : selBlock.roof.type === 'shed' ? 'Low wall' : 'Eave'}
              value={roofHeights(selBlock.roof)[0]}
              min={2.3}
              max={6}
              onChange={v =>
                updateBlock(selBlock.id, b => {
                  if (b.roof.type === 'shed') b.roof.low = Math.min(v, b.roof.high - 0.1)
                  else if (b.roof.type === 'gable') b.roof.eave = Math.min(v, b.roof.ridge - 0.3)
                  else b.roof.height = v
                })
              }
            />
            {selBlock.roof.type !== 'flat' && (
              <Stepper
                label={selBlock.roof.type === 'shed' ? 'High wall' : 'Ridge'}
                value={roofHeights(selBlock.roof)[1]}
                min={2.6}
                max={8}
                onChange={v =>
                  updateBlock(selBlock.id, b => {
                    if (b.roof.type === 'shed') b.roof.high = Math.max(v, b.roof.low + 0.1)
                    else if (b.roof.type === 'gable') b.roof.ridge = Math.max(v, b.roof.eave + 0.3)
                  })
                }
              />
            )}
            <label className="insp-field">
              <span>Cladding</span>
              <select
                id="ed-clad"
                value={CLADDINGS.findIndex(c => c.spec.zone === selBlock.cladding.default.zone && c.spec.kind === selBlock.cladding.default.kind)}
                onChange={e =>
                  updateBlock(selBlock.id, b => {
                    b.cladding = { default: { ...CLADDINGS[Number(e.target.value)].spec } }
                  })
                }
              >
                {CLADDINGS.map((c, i) => (
                  <option key={c.label} value={i}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="insp-check">
              <input id="ed-garage" type="checkbox" checked={!!selBlock.utility} onChange={e => updateBlock(selBlock.id, b => { b.utility = e.target.checked; b.ceiling = e.target.checked ? 2.7 : 'vaulted' })} />
              <span>Garage or storage (unfinished)</span>
            </label>
            <div className="insp-row">
              <button className="btn btn-ghost danger" onClick={removeSelection}>Delete volume</button>
            </div>
          </div>
        )}
        {selOpening && sel?.kind === 'opening' && (
          <div className="insp">
            <h3>{OPENING_KINDS.find(k => k.kind === selOpening.kind)?.label ?? 'Opening'}</h3>
            {selOpening.block && (
              <label className="insp-field">
                <span>Type</span>
                <select
                  id="ed-kind"
                  value={selOpening.kind}
                  onChange={e => {
                    const def = OPENING_KINDS.find(k => k.kind === e.target.value)!
                    updateOpening(sel.index, o => {
                      o.kind = def.kind
                      o.width = def.w
                      o.height = def.h
                      o.sill = def.sill
                      if (def.kind === 'slider') o.id = `slider-open-${Date.now().toString(36)}`
                    })
                  }}
                >
                  {OPENING_KINDS.map(k => (
                    <option key={k.kind} value={k.kind}>{k.label}</option>
                  ))}
                </select>
              </label>
            )}
            <Stepper label="Width" value={selOpening.width} min={0.5} max={8} onChange={v => updateOpening(sel.index, o => (o.width = v))} />
            <Stepper label="Height" value={selOpening.height} min={0.4} max={4} onChange={v => updateOpening(sel.index, o => (o.height = v))} />
            {selOpening.block && (selOpening.sill ?? 0) > 0 && <Stepper label="Sill" value={selOpening.sill ?? 0} min={0.1} max={3.5} onChange={v => updateOpening(sel.index, o => (o.sill = v))} />}
            <div className="insp-row">
              <button className="btn btn-ghost danger" onClick={removeSelection}>Delete</button>
            </div>
          </div>
        )}
        {selWall && (
          <div className="insp">
            <h3>Wall</h3>
            <p className="note">{feetInches(Math.hypot(selWall.b[0] - selWall.a[0], selWall.b[1] - selWall.a[1]))} long</p>
            <div className="insp-row">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  const p = clone(draft)
                  const L = Math.hypot(selWall.b[0] - selWall.a[0], selWall.b[1] - selWall.a[1])
                  p.openings.push({ wall: selWall.id, at: L / 2, width: 0.86, height: 2.1, kind: 'door' })
                  commit(p)
                }}
              >
                Add doorway
              </button>
              <button className="btn btn-ghost danger" onClick={removeSelection}>Delete wall</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100) / 100)
  return (
    <div className="insp-field">
      <span>{label}</span>
      <div className="stepper">
        <button onClick={() => set(value - 0.15)} aria-label={`Less ${label}`}>−</button>
        <output>{feetInches(value)}</output>
        <button onClick={() => set(value + 0.15)} aria-label={`More ${label}`}>+</button>
      </div>
    </div>
  )
}
