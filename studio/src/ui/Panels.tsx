import { ZONES, type FinishOption } from '../engine/materials/catalog'
import { TIME_PRESETS } from '../engine/env/environment'
import { PLANS } from '../plans'
import { feetInches } from './FloorPlan'
import { Icon } from './icons'
import { setState, useStore, getState, toast, encodeDesign } from './store'
import { useState } from 'react'

const sf = (n: number) => n.toLocaleString('en-US')

export function PlanFacts({ id, short }: { id: string; short?: boolean }) {
  const p = PLANS.find(x => x.id === id)!
  const f = p.facts
  return (
    <span className="facts">
      <span>{sf(f.area)} sf</span>
      <span>{f.beds} bd</span>
      <span>{f.baths} ba</span>
      {!short && <span>{f.width}′ × {f.depth}′</span>}
    </span>
  )
}

/** The home browser: every plan as a card. */
export function PlanSheet({ onPick }: { onPick: (id: string) => void }) {
  const current = useStore(s => s.planId)
  return (
    <aside className="sheet sheet-plans" aria-label="Home plans">
      <header className="sheet-head">
        <div>
          <p className="eyebrow">Cuby Homes · {PLANS.length} plans</p>
          <h2>Choose a home</h2>
        </div>
        <button className="icon-btn" onClick={() => setState({ sheet: null })} aria-label="Close plans">
          <Icon.close />
        </button>
      </header>
      <div className="plan-list">
        {PLANS.map((p, i) => (
          <button key={p.id} className={`plan-card ${p.id === current ? 'is-current' : ''}`} onClick={() => onPick(p.id)}>
            <div className="plan-thumb" style={{ backgroundImage: `url(./thumbs/${p.id}.webp)` }}>
              <span className="plan-index">{String(i + 1).padStart(2, '0')}</span>
              {p.id === current && <span className="plan-badge">Viewing</span>}
            </div>
            <div className="plan-meta">
              <div className="plan-title">
                <h3>{p.name}</h3>
                <span className="chip">{p.style}</span>
              </div>
              <PlanFacts id={p.id} />
              <p className="plan-tag">{p.tagline}</p>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}

function swatchStyle(o: FinishOption): React.CSSProperties {
  const isWood = !!o.params.tex
  return {
    background: isWood
      ? `repeating-linear-gradient(90deg, ${o.swatch} 0 5px, color-mix(in srgb, ${o.swatch} 82%, black) 5px 6px), ${o.swatch}`
      : `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${o.swatch} 70%, white) 0, ${o.swatch} 55%, color-mix(in srgb, ${o.swatch} 80%, black) 100%)`,
  }
}

/** Finishes, interior palette and light. */
export function CustomizePanel({ onFinish, onTime }: { onFinish: (zone: string, opt: string) => void; onTime: (id: string) => void }) {
  const planId = useStore(s => s.planId)
  const finishes = useStore(s => s.finishes[s.planId])
  const time = useStore(s => s.time)
  const [tab, setTab] = useState<'exterior' | 'interior' | 'light'>('exterior')
  const plan = PLANS.find(p => p.id === planId)!
  const zones = plan.zones.filter(z => ZONES[z].group === tab)
  return (
    <aside className="sheet sheet-custom" aria-label="Customize">
      <header className="sheet-head">
        <div>
          <p className="eyebrow">{plan.name}</p>
          <h2>Make it yours</h2>
        </div>
        <button className="icon-btn" onClick={() => setState({ sheet: null })} aria-label="Close customize">
          <Icon.close />
        </button>
      </header>
      <div className="tabs" role="tablist">
        {(['exterior', 'interior', 'light'] as const).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
            {t === 'exterior' ? 'Exterior' : t === 'interior' ? 'Interior' : 'Light'}
          </button>
        ))}
      </div>
      <div className="custom-body">
        {tab !== 'light' &&
          zones.map(z => {
            const zone = ZONES[z]
            const cur = finishes[z] ?? plan.finishes[z]
            const curName = zone.options.find(o => o.id === cur)?.name
            return (
              <section key={z} className="zone">
                <div className="zone-head">
                  <h3>{zone.label}</h3>
                  <span className="zone-value">{curName}</span>
                </div>
                <div className={`swatches ${z === 'palette' ? 'swatches-wide' : ''}`}>
                  {zone.options.map(o => (
                    <button
                      key={o.id}
                      className={`swatch ${o.id === cur ? 'is-on' : ''}`}
                      onClick={() => onFinish(z, o.id)}
                      aria-pressed={o.id === cur}
                      title={o.name}
                    >
                      <span className="swatch-dot" style={swatchStyle(o)} />
                      <span className="swatch-name">{o.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        {tab === 'light' && (
          <section className="zone">
            <div className="zone-head">
              <h3>Time of day</h3>
              <span className="zone-value">{TIME_PRESETS.find(t => t.id === time)?.label}</span>
            </div>
            <div className="times">
              {TIME_PRESETS.map(t => (
                <button key={t.id} className={`time ${t.id === time ? 'is-on' : ''}`} onClick={() => onTime(t.id)}>
                  <span className={`time-sky time-${t.id}`} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <p className="note">Real sky captures (CC0, Poly Haven). Lamps switch on at dusk and night.</p>
          </section>
        )}
      </div>
    </aside>
  )
}

export function ShareSheet() {
  const url = `${location.href.split('#')[0]}#${encodeDesign(getState())}`
  return (
    <aside className="sheet sheet-small" aria-label="Share">
      <header className="sheet-head">
        <div>
          <p className="eyebrow">Share this design</p>
          <h2>Link</h2>
        </div>
        <button className="icon-btn" onClick={() => setState({ sheet: null })} aria-label="Close share">
          <Icon.close />
        </button>
      </header>
      <p className="note">The link opens this plan with your finishes and light.</p>
      <div className="share-row">
        <input id="share-url" className="share-url" readOnly value={url} onFocus={e => e.currentTarget.select()} />
        <button
          className="btn"
          onClick={() => {
            navigator.clipboard
              ?.writeText(url)
              .then(() => toast('Link copied'))
              .catch(() => {
                const el = document.getElementById('share-url') as HTMLInputElement | null
                el?.select()
                toast('Press Copy on your keyboard to copy the selected link')
              })
          }}
        >
          <Icon.copy /> Copy
        </button>
      </div>
    </aside>
  )
}

/** Sketchfab authors of the CC BY furniture (tools/objaverse.json) */
const CREDITS = ["13213213213", "allenbranch", "CioJay", "classe-saga", "crosslag", "dearsindy", "fedomo", "grove4069", "kreion", "mikkoh", "mohitoz", "olamii", "Pablo.Portela", "TabbieCat", "trendforward", "ubaid.kfat", "wadeedchishty", "williamozelimtorres", "zhousongjiang"]

export function HelpSheet() {
  const touch = matchMedia('(pointer: coarse)').matches
  return (
    <aside className="sheet sheet-small" aria-label="How to move around">
      <header className="sheet-head">
        <div>
          <p className="eyebrow">Getting around</p>
          <h2>Controls</h2>
        </div>
        <button className="icon-btn" onClick={() => setState({ sheet: null })} aria-label="Close help">
          <Icon.close />
        </button>
      </header>
      <dl className="help">
        <dt>Outside</dt>
        <dd>{touch ? 'Drag to circle the house and tilt up or down. Pinch to zoom. Two fingers to slide.' : 'Drag to circle and tilt. Scroll to zoom. Right-drag or Shift-drag to slide.'}</dd>
        <dt>Walk</dt>
        <dd>{touch ? 'Drag to look around, up and down. Tap the floor to walk there. Use the stick to walk, or pinch to step forward.' : 'Drag to look around. Click the floor to walk there. W A S D or the arrow keys walk, Shift runs.'}</dd>
        <dt>Dollhouse</dt>
        <dd>The roof lifts off. Tap a room to walk into it.</dd>
        <dt>Floor plan</dt>
        <dd>Tap a room to stand in it. Sizes are interior dimensions in feet.</dd>
      </dl>
      <p className="note">Hold still for a moment and the picture sharpens: shadows soften and edges clean up.</p>
      <details className="credits">
        <summary>Credits</summary>
        <p className="note">
          Skies, textures, plants and some furniture: Poly Haven (CC0). Sofas and chairs: Wayfair via the Khronos glTF
          Sample Assets (CC BY 4.0). Furniture and fixtures from Sketchfab creators via Objaverse (CC BY 4.0):{' '}
          {CREDITS.join(', ')}. Trees: ez-tree (MIT).
        </p>
      </details>
    </aside>
  )
}

export { feetInches }
