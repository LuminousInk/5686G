import { useState, type ReactNode } from 'react'
import { levelId, stairFlight } from '../../engine/house/levels'
import { SIDES } from '../../engine/house/massing'
import type { Block, Deck, HomePlan, Opening, Rect, Roof, RoomDef, RoomType, Side, Terrace } from '../../engine/house/types'
import { ZONES } from '../../engine/materials/catalog'
import { itemKey, moveWallEnd, resizeItem, stairDirection, type Selection } from './actions'
import { along, area, blocksAt, distance, sameMount, snapValue, stepFor, wallLines, type Units } from './geometry'
import { autoFloor, canRotate, cladOptions, enclosed, generated, groundLevel, mergeRect, orientVolume, roofFor, roomPartitions, ROOM_TYPES, underUpper } from './plan'

export const SIDE_NAMES: Record<Side, string> = { n: 'North', s: 'South', e: 'East', w: 'West' }
export const ROOF_NAMES: Record<Roof['type'], string> = { flat: 'Flat', shed: 'Shed', gable: 'Gable', hip: 'Hip' }
export const OPENING_NAMES: Record<Opening['kind'], string> = {
  window: 'Window', fixed: 'Picture window', clerestory: 'Clerestory', door: 'Swing door', entry: 'Entry door', slider: 'Sliding glass door', garage: 'Garage door',
}

export type Mutation = (draft: HomePlan) => void
interface Props {
  plan: HomePlan
  level: string
  selected: Selection | null
  notes: string[]
  units: Units
  onSelect(item: Selection | null): void
  onEdit(mutation: Mutation): boolean
  onRemove(): void
  onSplit(room: RoomDef, axis: 0 | 1, at: number): void
  onUpper(block: Block): void
  onAutoStair(): void
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ds-field"><span>{label}</span>{children}</label>
}

export function Dimension({ label, value, units, onChange }: { label: string; value: number; units: Units; onChange(v: number): void }) {
  const scale = units === 'ft' ? 0.3048 : 1
  const shown = String(+(value / scale).toFixed(2))
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    const v = Number(draft)
    if (draft?.trim() && Number.isFinite(v) && Math.abs(v * scale - value) > 0.001) onChange(Math.round(v * scale * 10000) / 10000)
    setDraft(null)
  }
  return <Field label={label}>
    <span className="ds-number">
      <input type="text" inputMode="decimal" value={draft ?? shown} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(null)
      }} />
      <span>{units}</span>
    </span>
  </Field>
}

export function listObjects(p: HomePlan, level: string) {
  const blocks = blocksAt(p, level)
  const rows: (Selection & { label: string })[] = blocks.map((b, i) => ({ kind: 'volume', id: b.id, label: `Volume ${i + 1} · ${ROOF_NAMES[b.roof.type]}` }))
  const list = wallLines(p, level)
  for (const r of p.rooms) if (levelId(p, r.level) === level) rows.push({ kind: 'room', id: r.id, label: r.name })
  for (const [i, w] of p.walls.filter(w => levelId(p, w.level) === level).entries()) rows.push({ kind: 'wall', id: w.id, label: `Interior wall ${i + 1}` })
  for (const o of p.openings) if (o.id && list.some(l => sameMount(l.mount, o))) rows.push({ kind: 'opening', id: o.id, label: OPENING_NAMES[o.kind] })
  for (const s of p.stairs) if (s.between ? [s.between.upper, s.between.lower].includes(level) : level === groundLevel(p))
    rows.push({ kind: 'stair', id: s.id, label: s.between ? 'Interior stair' : 'Outdoor stair' })
  if (level === groundLevel(p)) {
    p.decks.forEach((d, i) => rows.push({ kind: 'deck', id: d.id, label: `Deck ${i + 1}` }))
    p.terraces.forEach((t, i) => rows.push({ kind: 'terrace', id: t.id, label: `Terrace ${i + 1}` }))
  }
  return rows
}

export function Inspector({ plan, level, selected, notes, units, onSelect, onEdit, onRemove, onSplit, onUpper, onAutoStair }: Props) {
  const [panel, setPanel] = useState<'object' | 'finish' | 'checks'>('object')
  const [side, setSide] = useState<'default' | Side>('default')
  const [direction, setDirection] = useState<0 | 1>(0)
  const [split, setSplit] = useState<{ id: string; at: number }>()
  const [zone, setZone] = useState('roof')
  const objects = listObjects(plan, level)
  const selectedName = objects.find(o => o.kind === selected?.kind && o.id === selected.id)?.label
  const block = selected?.kind === 'volume' ? plan.blocks.find(b => b.id === selected.id) : undefined
  const room = selected?.kind === 'room' ? plan.rooms.find(r => r.id === selected.id) : undefined
  const wall = selected?.kind === 'wall' ? plan.walls.find(w => w.id === selected.id) : undefined
  const opening = selected?.kind === 'opening' ? plan.openings.find(o => o.id === selected.id) : undefined
  const stair = selected?.kind === 'stair' ? plan.stairs.find(s => s.id === selected.id) : undefined
  const deck = selected?.kind === 'deck' ? plan.decks.find(d => d.id === selected.id) : undefined
  const terrace = selected?.kind === 'terrace' ? plan.terraces.find(t => t.id === selected.id) : undefined
  const shape = block ?? room ?? deck ?? terrace
  const editBlock = (edit: (b: Block) => void) => block && onEdit(p => edit(p.blocks.find(b => b.id === block.id)!))
  const editRoom = (edit: (r: RoomDef) => void, partition = false) => room && onEdit(p => {
    const r = p.rooms.find(r => r.id === room.id)!
    edit(r)
    if (partition) roomPartitions(p, level, r.frame)
  })
  const editOpening = (edit: (o: Opening) => void) => opening && onEdit(p => edit(p.openings.find(o => o.id === opening.id)!))
  const splitMid = room ? snapValue((room.rect[direction] + room.rect[direction + 2]) / 2, stepFor(units)) : 0
  const splitAt = split?.id === room?.id ? split?.at : undefined
  const mergeable = room ? plan.rooms.filter(r => r.id !== room.id && r.frame === room.frame && levelId(plan, r.level) === level && mergeRect(room.rect, r.rect)) : []
  const finishZones = plan.zones.filter(z => ZONES[z])
  const activeZone = finishZones.includes(zone) ? zone : finishZones[0]
  const finish = activeZone && ZONES[activeZone]
  const bindDimension = (r: Rect, dir: 'w' | 'd', size: number) => onEdit(p => {
    const coordinate = dir === 'w' ? r[0] + size : r[1] + size
    resizeItem(p, selected!, dir === 'w' ? 'e' : 's', coordinate)
  })

  return <aside className="ds-inspector" aria-label="Design inspector">
    <nav className="ds-inspector-tabs" aria-label="Inspector panels">
      <button type="button" aria-pressed={panel === 'object'} onClick={() => setPanel('object')}>Properties</button>
      <button type="button" aria-pressed={panel === 'finish'} onClick={() => setPanel('finish')}>Finishes</button>
      <button type="button" aria-pressed={panel === 'checks'} onClick={() => setPanel('checks')}>Plan checks <span>{notes.length}</span></button>
    </nav>
    <div className="ds-inspector-body">
      {panel === 'checks' && (notes.length
        ? <ul className="ds-notes">{notes.map(note => <li key={note}>{note}</li>)}</ul>
        : <p className="ds-note">The current layout passes the design checks.</p>)}
      {panel === 'finish' && finish && <>
        <Field label="Finish zone"><select value={activeZone} onChange={e => setZone(e.target.value)}>
          {finishZones.map(z => <option key={z} value={z}>{ZONES[z].label}</option>)}
        </select></Field>
        <div className="ds-swatches" aria-label={finish.label}>
          {finish.options.map(o => <button type="button" key={o.id} aria-pressed={plan.finishes[activeZone] === o.id}
            onClick={() => onEdit(p => { p.finishes[activeZone] = o.id })}>
            <span style={{ backgroundColor: o.swatch }} />{o.name}
          </button>)}
        </div>
      </>}
      {panel === 'object' && <>
        <div className="ds-object-line">
          <select aria-label="Plan objects" value={selected ? `${selected.kind}:${selected.id}` : ''} onChange={e => {
            const row = objects.find(o => `${o.kind}:${o.id}` === e.target.value)
            setSplit(undefined)
            onSelect(row ? { kind: row.kind, id: row.id } : null)
          }}>
            <option value="">Select an object</option>
            {objects.map(o => <option value={`${o.kind}:${o.id}`} key={`${o.kind}:${o.id}`}>{o.label}</option>)}
          </select>
          {selected && <button type="button" className="ds-quiet ds-delete" onClick={onRemove} aria-label={`Delete ${selectedName ?? selected.kind}`}>Delete</button>}
        </div>
        {!selected && <p className="ds-note">Select a volume, room or wall on the plan to edit it.</p>}
        {shape && <div className="ds-fields">
          <Dimension label="Width" units={units} value={shape.rect[2] - shape.rect[0]} onChange={size => bindDimension(shape.rect, 'w', size)} />
          <Dimension label="Depth" units={units} value={shape.rect[3] - shape.rect[1]} onChange={size => bindDimension(shape.rect, 'd', size)} />
        </div>}
        {block && <>
          <div className="ds-fields">
            <Field label="Roof">
              <select aria-label="Roof" disabled={underUpper(plan, block)} value={block.roof.type} onChange={e => editBlock(b => {
                b.roof = roofFor(b, e.target.value as Roof['type'], b.roof.overhang === 0)
                const min = b.roof.type === 'flat' ? b.roof.height : b.roof.type === 'shed' ? b.roof.low : b.roof.eave
                if (typeof b.ceiling === 'number') b.ceiling = Math.min(b.ceiling, min - 0.06)
              })}>
                {Object.entries(ROOF_NAMES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </Field>
            {block.roof.type === 'shed' && <Field label="Slopes toward"><select value={block.roof.rises} onChange={e => editBlock(b => {
              if (b.roof.type === 'shed') b.roof.rises = e.target.value as Side
            })}>{SIDES.map(s => <option key={s} value={s}>{SIDE_NAMES[s]}</option>)}</select></Field>}
            {block.roof.type === 'gable' && <Field label="Ridge axis"><select value={block.roof.ridgeAxis} onChange={e => editBlock(b => {
              if (b.roof.type === 'gable') b.roof.ridgeAxis = e.target.value as 'x' | 'z'
            })}><option value="x">East–west</option><option value="z">North–south</option></select></Field>}
            {!underUpper(plan, block) && <Dimension
              label={block.roof.type === 'flat' ? 'Wall height' : block.roof.type === 'shed' ? 'Low wall' : 'Eave'}
              units={units} value={block.roof.type === 'flat' ? block.roof.height : block.roof.type === 'shed' ? block.roof.low : block.roof.eave}
              onChange={height => editBlock(b => {
                const next = Math.max(2.35, Math.min(6, height))
                if (b.roof.type === 'flat') b.roof.height = next
                else if (b.roof.type === 'shed') { b.roof.low = next; b.roof.high = Math.max(next + 0.2, b.roof.high) }
                else { b.roof.eave = next; b.roof.ridge = Math.max(next + 0.3, b.roof.ridge) }
                if (typeof b.ceiling === 'number') b.ceiling = Math.min(b.ceiling, next - 0.06)
              })} />}
            {block.roof.type !== 'flat' && !underUpper(plan, block) && <Dimension
              label={block.roof.type === 'shed' ? 'High wall' : 'Ridge height'} units={units}
              value={block.roof.type === 'shed' ? block.roof.high : block.roof.ridge}
              onChange={height => editBlock(b => {
                if (b.roof.type === 'shed') b.roof.high = Math.min(8, Math.max(b.roof.low + 0.2, height))
                else if (b.roof.type !== 'flat') b.roof.ridge = Math.min(8, Math.max(b.roof.eave + 0.3, height))
              })} />}
          </div>
          <div className="ds-fields">
            <Field label="Cladding side"><select value={side} onChange={e => setSide(e.target.value as Side | 'default')}>
              <option value="default">Default for volume</option>{SIDES.map(s => <option key={s} value={s}>{SIDE_NAMES[s]}</option>)}
            </select></Field>
            <Field label="Cladding finish zone"><select
              value={(() => { const spec = block.cladding[side]; return spec ? cladOptions.findIndex(c => c.spec.zone === spec.zone && c.spec.kind === spec.kind) : 'inherit' })()}
              onChange={e => editBlock(b => {
                const value = e.target.value
                if (value === 'inherit' && side !== 'default') delete b.cladding[side]
                else if (cladOptions[Number(value)]) {
                  b.cladding[side] = { ...cladOptions[Number(value)].spec }
                }
              })}>
              {side !== 'default' && <option value="inherit">Use default</option>}
              <option value="-1" disabled>Original cladding</option>
              {cladOptions.map((c, i) => <option key={c.name} value={i}>{c.name}</option>)}
            </select></Field>
          </div>
          {canRotate(plan, block) && <Field label="Volume orientation">
            <select value={String(+((block.yaw ?? 0) * 180 / Math.PI).toFixed(2))}
              onChange={e => onEdit(p => orientVolume(p, block.id, Number(e.target.value) * Math.PI / 180))}>
              {[...new Set([0, 45, 90, 135, 180, -135, -90, -45, +((block.yaw ?? 0) * 180 / Math.PI).toFixed(2)])]
                .map(angle => <option key={angle} value={angle}>{angle}°</option>)}
            </select>
          </Field>}
          <button type="button" onClick={() => onUpper(block)} className="ds-secondary" disabled={block.yaw !== undefined && !!block.yaw || underUpper(plan, block)}>
            Add storey above
          </button>
          {underUpper(plan, block) && <p className="ds-note">The floor above sets this volume’s roof height.</p>}
        </>}
        {room && <>
          <div className="ds-fields">
            <Field label="Room name"><input key={`${room.id}:${room.name}`} defaultValue={room.name} maxLength={72} onBlur={e => {
              const name = e.target.value.trim()
              if (name && name !== room.name) editRoom(r => { r.name = name })
              else e.target.value = room.name
            }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></Field>
            <Field label="Room type"><select value={room.type} onChange={e => {
              const type = e.target.value as RoomType
              editRoom(r => { r.type = type; r.floor = autoFloor(type); r.furnish = undefined })
            }}>{ROOM_TYPES.map(t => <option value={t.type} key={t.type}>{t.label}</option>)}</select></Field>
          </div>
          <label className="ds-check"><input checked={enclosed(room)} type="checkbox" onChange={e => editRoom(r => { r.enclosed = e.target.checked }, true)} /> Add partition walls at room edges</label>
          <div className="ds-fields ds-split">
            <Field label="Divide room"><select value={direction} onChange={e => { setDirection(Number(e.target.value) as 0 | 1); setSplit(undefined) }}>
              <option value={0}>Along width</option><option value={1}>Along depth</option>
            </select></Field>
            <Dimension label="Split distance" units={units} value={(splitAt ?? splitMid) - room.rect[direction]} onChange={size => setSplit({ id: room.id, at: room.rect[direction] + size })} />
            <button type="button" className="ds-secondary" onClick={() => onSplit(room, direction, splitAt ?? splitMid)}>Split room</button>
          </div>
          {mergeable.length > 0 && <Field label="Merge with adjacent room"><select value="" onChange={e => {
            const next = mergeable.find(r => r.id === e.target.value)
            if (!next) return
            onEdit(p => {
              const thisRoom = p.rooms.find(r => r.id === room.id)!
              thisRoom.rect = mergeRect(room.rect, next.rect)!
              thisRoom.enclosed = enclosed(room) || enclosed(next)
              p.rooms = p.rooms.filter(r => r.id !== next.id)
              roomPartitions(p, level, room.frame)
            })
          }}><option value="">Choose room</option>{mergeable.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
        </>}
        {wall && (generated(wall) ? <p className="ds-note">Resize the room to move this partition.</p> :
          <Dimension label="Partition length" units={units} value={distance(wall.a, wall.b)}
            onChange={length => onEdit(p => moveWallEnd(p, wall.id, 'b', along(wall.a, wall.b, Math.max(0.55, length))))} />)}
        {opening && <div className="ds-fields">
          <Dimension label="Wall offset" units={units} value={opening.at} onChange={v => editOpening(o => { o.at = v })} />
          <Dimension label="Opening width" units={units} value={opening.width} onChange={v => editOpening(o => { o.width = Math.max(0.4, Math.min(9, v)) })} />
          <Dimension label="Opening height" units={units} value={opening.height} onChange={v => editOpening(o => { o.height = Math.max(0.4, Math.min(4, v)) })} />
          {['window', 'fixed', 'clerestory'].includes(opening.kind) && <Dimension label="Sill height" units={units} value={opening.sill ?? 0} onChange={v => editOpening(o => { o.sill = Math.max(0.1, Math.min(3.8, v)) })} />}
        </div>}
        {stair && <>
          <p className="ds-note">{stair.steps} treads · {Math.round(area(stairFlight(stair).rect) * 10.7639)} ft² stairwell</p>
          {stair.between && <Field label="Direction of descent"><select value={stair.dir} onChange={e => onEdit(p => stairDirection(p, stair.id, e.target.value as Side))}>
            {SIDES.map(s => <option key={s} value={s}>{SIDE_NAMES[s]}</option>)}</select></Field>}
        </>}
        {deck && <Field label="Deck boards"><select value={deck.boardsAlong} onChange={e => onEdit(p => {
          p[itemKey.deck].find(d => d.id === deck.id)!.boardsAlong = e.target.value as Deck['boardsAlong']
        })}><option value="x">East–west</option><option value="z">North–south</option></select></Field>}
        {terrace && <Field label="Terrace surface"><select value={terrace.kind} onChange={e => onEdit(p => {
          p[itemKey.terrace].find(t => t.id === terrace.id)!.kind = e.target.value as Terrace['kind']
        })}><option value="pavers">Pavers</option><option value="concrete">Concrete</option><option value="gravel">Gravel</option></select></Field>}
        {level !== groundLevel(plan) && !plan.stairs.some(s => s.between?.upper === level) &&
          <button className="ds-secondary" type="button" onClick={onAutoStair}>Find a stair position</button>}
      </>}
    </div>
  </aside>
}
