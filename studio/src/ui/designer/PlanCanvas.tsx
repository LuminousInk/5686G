import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { framePoint, levelId, stairFlight } from '../../engine/house/levels'
import { SIDES } from '../../engine/house/massing'
import type { Block, HomePlan, Rect, Side } from '../../engine/house/types'
import { itemKey, type Gesture, type Selection, type Tool } from './actions'
import { along, blocksAt, center, distance, doorSwing, edgeIndex, isDoor, levelBounds, mountOpening, OPENING_CATALOG, rectEdge, rectFrom, sameMount, snapPoint, snapValue, stepFor, wallEnd, wallLines, type Point, type Units } from './geometry'
import { generated, groundLevel, newStair } from './plan'

const rectPoints = ([a, b, c, d]: Rect): Point[] => [[a, b], [c, b], [c, d], [a, d]]
const shape = (rect: Rect, block?: Block) => rectPoints(rect).map(p => framePoint(block, ...p).join(',')).join(' ')
const lineProps = (a: Point, b: Point) => ({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] })
const same = (a: Selection | null, b: Selection) => a?.kind === b.kind && a.id === b.id
export const displaySpan = (n: number, units: Units) => units === 'ft' ? `${+(n / 0.3048).toFixed(1)} ft` : `${+n.toFixed(2)} m`
const scaleBounds = ([a, b, c, d]: Rect, factor: number, offset: Point): Rect => {
  const [x, z] = [(a + c) / 2 + offset[0], (b + d) / 2 + offset[1]]
  const w = (c - a) * factor / 2, h = (d - b) * factor / 2
  return [x - w, z - h, x + w, z + h]
}

interface CanvasProps {
  plan: HomePlan
  level: string
  units: Units
  tool: Tool
  catalog: number
  selected: Selection | null
  onSelect(item: Selection | null): void
  onGesture(gesture: Gesture, radius: number): void
}

type Drag = { kind: 'draw'; a: Point; b: Point; tool: Tool }
  | { kind: 'edge'; a: Point; b: Point; item: Selection; side: Side }
  | { kind: 'wall-end'; a: Point; b: Point; id: string; endpoint: 'a' | 'b' }
  | { kind: 'opening'; a: Point; b: Point; id: string }
  | { kind: 'pan'; a: Point; b: Point }

export function PlanCanvas({ plan, level, units, tool, catalog, selected, onSelect, onGesture }: CanvasProps) {
  const svg = useRef<SVGSVGElement>(null)
  const active = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<{ point: Point; radius: number } | null>(null)
  const [anchor, setAnchor] = useState<{ point: Point; tool: Tool } | null>(null)
  const first = anchor?.tool === tool ? anchor.point : null
  const [size, setSize] = useState({ w: 640, h: 440 })
  useEffect(() => {
    const node = svg.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 1 && height > 1) setSize({ w: width, h: height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>([0, 0])
  const gridId = useId()
  const blocks = useMemo(() => blocksAt(plan, level), [plan, level])
  const lower = (plan.levels ?? []).filter(l => l.offset < (plan.levels?.find(item => item.id === level)?.offset ?? 0)).sort((a, b) => b.offset - a.offset)[0]
  const allBlocks = lower ? [...blocks, ...blocksAt(plan, lower.id)] : blocks
  const rooms = plan.rooms.filter(r => levelId(plan, r.level) === level)
  const ground = level === groundLevel(plan)
  const outdoor = ground ? [...plan.decks.map(item => ({ item, kind: 'deck' as const })), ...plan.terraces.map(item => ({ item, kind: 'terrace' as const }))] : []
  const lines = useMemo(() => wallLines(plan, level), [plan, level])
  const step = stepFor(units)
  const blockBounds = levelBounds(allBlocks.length ? allBlocks : plan.blocks)
  const xs = [blockBounds[0], blockBounds[2]], zs = [blockBounds[1], blockBounds[3]]
  for (const { item } of outdoor) { xs.push(item.rect[0], item.rect[2]); zs.push(item.rect[1], item.rect[3]) }
  const raw: Rect = [Math.min(...xs) - 3.3, Math.min(...zs) - 3.3, Math.max(...xs) + 3.3, Math.max(...zs) + 3.3]
  const aspect = size.w / size.h
  const fitW = Math.max(raw[2] - raw[0], (raw[3] - raw[1]) * aspect)
  const fitH = fitW / aspect
  const [cx, cz] = center(raw)
  const pan: Point = drag?.kind === 'pan' ? [offset[0] + drag.a[0] - drag.b[0], offset[1] + drag.a[1] - drag.b[1]] : offset
  const fixedView = scaleBounds([cx - fitW / 2, cz - fitH / 2, cx + fitW / 2, cz + fitH / 2], zoom, offset)
  const [x, z, r, d] = scaleBounds([cx - fitW / 2, cz - fitH / 2, cx + fitW / 2, cz + fitH / 2], zoom, pan)

  const screen = (e: PointerEvent<SVGSVGElement>) => {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return { raw: [0, 0] as Point, radius: 0.5, snapRadius: 0.15 }
    const px = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
    const p: Point = [px.x, px.y]
    if (active.current?.kind === 'pan') {
      p[0] += fixedView[0] - x
      p[1] += fixedView[1] - z
    }
    const meter = 1 / Math.abs(matrix.a)
    return { raw: p, radius: Math.max(0.25, Math.min(1, meter * 17)), snapRadius: Math.min(0.28, meter * 6) }
  }
  const snap = (raw: Point, tolerance: number, item?: Selection): Point => {
    const result = snapPoint(raw, step)
    const anchors = [
      ...blocks.filter(b => !b.yaw && !(item?.kind === 'volume' && item.id === b.id)).flatMap(b => rectPoints(b.rect)),
      ...rooms.filter(r => !r.frame && !(item?.kind === 'room' && item.id === r.id)).flatMap(r => rectPoints(r.rect)),
      ...plan.walls.filter(w => !w.frame && levelId(plan, w.level) === level).flatMap(w => [w.a, w.b]),
    ]
    for (const axis of [0, 1]) {
      let least = tolerance
      for (const point of anchors) {
        const delta = Math.abs(point[axis] - raw[axis])
        if (delta < least) {
          result[axis] = point[axis]
          least = delta
        }
      }
    }
    return result
  }

  const start = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !e.isPrimary) return
    const { raw, radius, snapRadius } = screen(e)
    const target = (e.target as SVGElement).closest<SVGElement>('[data-item]')
    const item = target ? { kind: target.dataset.kind!, id: target.dataset.item! } as Selection : null
    const a = snap(raw, snapRadius)
    let next: Drag | null = null
    if (tool === 'select') {
      onSelect(item)
      const handle = target?.dataset.side as Side | undefined
      const endpoint = target?.dataset.endpoint as 'a' | 'b' | undefined
      if (item?.kind === 'wall' && endpoint) next = { kind: 'wall-end', a: raw, b: raw, id: item.id, endpoint }
      else if (item && handle) next = { kind: 'edge', a: raw, b: raw, item, side: handle }
      else if (item?.kind === 'opening') next = { kind: 'opening', id: item.id, a: raw, b: raw }
    } else if (tool === 'opening') onGesture({ kind: 'opening', at: raw }, radius)
    else if (tool === 'pan') next = { kind: 'pan', a: raw, b: raw }
    else next = { kind: 'draw', a: first ?? a, b: a, tool }
    if (next) {
      e.currentTarget.setPointerCapture(e.pointerId)
      active.current = next
      setDrag(next)
    }
  }

  const update = (e: PointerEvent<SVGSVGElement>) => {
    const current = active.current
    const { raw, radius, snapRadius } = screen(e)
    if (!current) {
      if (tool === 'opening' && e.pointerType === 'mouse') setHover({ point: raw, radius })
      return { radius }
    }
    const a = current.a
    let b = raw
    if (current.kind === 'edge') b = snap(raw, snapRadius, current.item)
    if (current.kind === 'wall-end') b = snap(raw, snapRadius)
    if (current.kind === 'draw') {
      b = snap(raw, snapRadius)
      if (current.tool === 'wall') {
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 4)
        if (Math.abs(angle - Math.round(angle)) > 1e-4) b = wallEnd(a, b, step)
      }
    }
    const next = { ...current, b }
    active.current = next
    setDrag(next)
    return { radius, next }
  }

  const end = (e: PointerEvent<SVGSVGElement>) => {
    const { next, radius } = update(e)
    active.current = null
    setDrag(null)
    if (!next) return
    const moved = distance(next.a, next.b) > Math.min(0.2, radius * 0.36)
    if (next.kind === 'pan') {
      setOffset([offset[0] + next.a[0] - next.b[0], offset[1] + next.a[1] - next.b[1]])
      return
    }
    if (next.kind === 'edge') {
      if (moved) onGesture({ kind: 'edge', item: next.item, side: next.side, at: next.b }, radius)
      return
    }
    if (next.kind === 'wall-end') {
      if (moved) onGesture({ kind: 'wall-end', id: next.id, endpoint: next.endpoint, at: next.b }, radius)
      return
    }
    if (next.kind === 'opening') {
      if (moved) onGesture({ kind: 'opening', id: next.id, at: next.b }, radius)
      return
    }
    if (next.tool === 'select' || next.tool === 'pan' || next.tool === 'opening') return
    if (!moved && !first) { setAnchor({ point: next.a, tool }); return }
    setAnchor(null)
    onGesture({ kind: next.tool, a: next.a, b: next.b }, radius)
  }

  const textScale = (r - x) * 12 / size.w
  const pick = (item: Selection) => ({ 'data-item': item.id, 'data-kind': item.kind })
  const isSelected = (item: Selection) => same(selected, item) ? ' is-selected' : ''
  const rectItem = selected && ['volume', 'room', 'deck', 'terrace'].includes(selected.kind)
    ? (plan[itemKey[selected.kind]] as { id?: string; rect?: Rect; frame?: string; yaw?: number }[]).find(item => item.id === selected.id) : undefined
  const itemFrame = rectItem?.yaw ? blocks.find(b => b.id === rectItem.id) : blocks.find(b => b.id === rectItem?.frame)
  let currentRect = rectItem?.rect
  if (currentRect && drag?.kind === 'edge') {
    currentRect = [...currentRect]
    const edge = edgeIndex(drag.side)
    currentRect[edge] = framePoint(itemFrame, ...drag.b, true)[edge % 2]
  }
  const selectedWall = selected?.kind === 'wall' ? plan.walls.find(w => w.id === selected.id && !generated(w)) : undefined
  const wallFrame = blocks.find(b => b.id === selectedWall?.frame)
  const selectedWallPoints = selectedWall ? { a: framePoint(wallFrame, ...selectedWall.a), b: framePoint(wallFrame, ...selectedWall.b) } : undefined
  if (selectedWallPoints && selectedWall && drag?.kind === 'wall-end') {
    const anchor = selectedWall[drag.endpoint === 'a' ? 'b' : 'a']
    selectedWallPoints[drag.endpoint] = framePoint(wallFrame, ...wallEnd(anchor, framePoint(wallFrame, ...drag.b, true), step))
  }
  const openingGhost = drag?.kind === 'opening' ? plan.openings.find(o => o.id === drag.id) : undefined
  const nextOpening = openingGhost && drag?.kind === 'opening'
    ? mountOpening(plan, level, drag.b, openingGhost, step, 1.5, openingGhost) : undefined
  const previewOpening = tool === 'opening' && hover
    ? mountOpening(plan, level, hover.point, { ...OPENING_CATALOG[catalog].item, at: 0 }, step, hover.radius) : undefined
  const draftBox = drag?.kind === 'draw' ? rectFrom(drag.a, drag.b) : undefined
  const draftStair = drag?.kind === 'draw' && drag.tool === 'stair' && distance(drag.a, drag.b) > 0.5 ? (() => {
    const [dx, dz] = [drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]]
    const dir = Math.abs(dx) > Math.abs(dz) ? dx > 0 ? 'e' : 'w' : dz > 0 ? 's' : 'n'
    return newStair(plan, level, drag.a, dir)
  })() : undefined
  const gridUnit = zoom < 0.6 ? step : units === 'ft' ? step * 2 : 0.5
  const major = units === 'ft' ? step * 5 : 1

  return <div className="ds-canvas">
    <div className="ds-map-controls">
      <button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.min(2, zoom * 1.3))}>−</button>
      <button type="button" aria-label="Fit plan" onClick={() => { setZoom(1); setOffset([0, 0]) }}>Fit</button>
      <button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.max(0.25, zoom / 1.3))}>+</button>
    </div>
    <div className="ds-north" aria-label="North is up">N<span>↑</span></div>
    <svg ref={svg} className={`ds-plan tool-${tool}`} viewBox={`${x} ${z} ${r - x} ${d - z}`} role="group" aria-label="Editable floor plan"
      onPointerDown={start} onPointerMove={update} onPointerLeave={() => setHover(null)} onPointerUp={end} onPointerCancel={() => { active.current = null; setDrag(null); setAnchor(null) }}>
      <defs>
        <pattern id={`${gridId}-small`} width={gridUnit} height={gridUnit} patternUnits="userSpaceOnUse">
          <path d={`M ${gridUnit} 0 H0 V${gridUnit}`} className="ds-grid-minor" />
        </pattern>
        <pattern id={`${gridId}-major`} width={major} height={major} patternUnits="userSpaceOnUse">
          <path d={`M ${major} 0 H0 V${major}`} className="ds-grid-major" />
        </pattern>
      </defs>
      <rect x={x} y={z} width={r - x} height={d - z} fill={`url(#${gridId}-small)`} />
      <rect x={x} y={z} width={r - x} height={d - z} fill={`url(#${gridId}-major)`} />
      {lower && blocksAt(plan, lower.id).map(b => <polygon key={b.id} points={shape(b.rect, b)} className="ds-below" />)}
      {outdoor.map(({ item, kind }) => {
        const sel = { kind, id: item.id }
        const p = center(item.rect)
        const frame = 'frame' in item ? blocks.find(b => b.id === item.frame) : undefined
        return <g key={item.id} {...pick(sel)} className={`ds-outdoor ds-${kind}${isSelected(sel)}`}>
          <polygon points={shape(item.rect, frame)} />
          <text x={p[0]} y={p[1]} fontSize={textScale}>{kind === 'deck' ? 'Deck' : 'Terrace'}</text>
        </g>
      })}
      {blocks.map((b, i) => {
        const sel = { kind: 'volume' as const, id: b.id }
        const p = framePoint(b, b.rect[0] + textScale * 0.62, b.rect[1] + textScale * 1.5)
        const roomOverlap = rooms.some(room => room.rect[0] < b.rect[0] + textScale * 2.2 && room.rect[1] < b.rect[1] + textScale * 1.65 &&
          room.rect[2] > b.rect[0] && room.rect[3] > b.rect[1])
        return <g key={b.id} {...pick(sel)} aria-label={`Volume ${i + 1}`} className={`ds-volume${isSelected(sel)}`}>
          <polygon points={shape(b.rect, b)} />
          {!roomOverlap && <text x={p[0]} y={p[1]} fontSize={textScale * 0.8}>Volume {i + 1}</text>}
        </g>
      })}
      {rooms.map(room => {
        const sel = { kind: 'room' as const, id: room.id }
        const frame = blocks.find(b => b.id === room.frame)
        const p = framePoint(frame, ...center(room.rect))
        const width = room.rect[2] - room.rect[0]
        const size = Math.min(textScale * 1.02, width * 1.7 / (room.name.length + 1))
        return <g key={room.id} {...pick(sel)} aria-label={room.name} className={`ds-room room-${room.type}${isSelected(sel)}`}>
          <polygon points={shape(room.rect, frame)} />
          <text x={p[0]} y={p[1]} fontSize={size}>{room.name}</text>
          <text x={p[0]} y={p[1] + size * 1.22} fontSize={size * 0.78} className="ds-room-area">
            {Math.round((room.rect[2] - room.rect[0]) * (room.rect[3] - room.rect[1]) * (units === 'm' ? 1 : 10.7639))} {units === 'm' ? 'm²' : 'ft²'}
          </text>
        </g>
      })}
      {lines.filter(line => 'wall' in line.mount || !line.neighbour).map((line, i) => {
        const a = along(line.a, line.b, line.range[0]), b = along(line.a, line.b, line.range[1])
        const item: Selection = 'wall' in line.mount ? { kind: 'wall', id: line.mount.wall } : { kind: 'volume', id: line.mount.block }
        return <g key={i} {...pick(item)} className={`ds-wall${isSelected(item)}`}>
          <line {...lineProps(a, b)} className="ds-wall-ink" />
          <line {...lineProps(a, b)} className="ds-wall-hit" />
        </g>
      })}
      {plan.stairs.filter(s => s.between ? [s.between.lower, s.between.upper].includes(level) : ground).map(stair => {
        const flight = stairFlight(stair)
        const item: Selection = { kind: 'stair', id: stair.id }
        return <g key={stair.id} {...pick(item)} className={`ds-stair${stair.between?.upper === level ? ' is-cut' : ''}${isSelected(item)}`}>
          <polygon points={shape(flight.rect)} />
          {Array.from({ length: stair.steps - 1 }, (_, i) => {
            const [x0, z0] = stair.from
            const u = (i + 1) * flight.going, w = stair.width / 2
            return <line key={i} {...lineProps([x0 + flight.dx * u - flight.dz * w, z0 + flight.dz * u - flight.dx * w], [x0 + flight.dx * u + flight.dz * w, z0 + flight.dz * u + flight.dx * w])} />
          })}
          <text x={center(flight.rect)[0]} y={center(flight.rect)[1]} fontSize={textScale * 1.3}>{stair.dir === 'n' ? '↑' : stair.dir === 's' ? '↓' : stair.dir === 'e' ? '→' : '←'}</text>
        </g>
      })}
      {plan.openings.map(original => {
        const o = original.id && original.id === nextOpening?.id ? nextOpening : original
        const line = lines.find(l => sameMount(l.mount, o) && o.at >= l.range[0] && o.at <= l.range[1])
        if (!line || !o.id) return null
        const item: Selection = { kind: 'opening', id: o.id }
        const a = along(line.a, line.b, o.at - o.width / 2), b = along(line.a, line.b, o.at + o.width / 2)
        const dx = b[0] - a[0], dz = b[1] - a[1]
        const swing = ('wall' in line.mount || line.neighbour) && (o.kind === 'door' || o.kind === 'entry') ? doorSwing(plan, line, o.at) : 0
        return <g key={o.id} {...pick(item)} className={`ds-opening ${isDoor(o) ? 'is-door' : 'is-window'}${isSelected(item)}`}>
          <line {...lineProps(a, b)} className="ds-opening-cut" />
          <line {...lineProps(a, b)} className="ds-opening-ink" />
          {!!swing && <>
            <line {...lineProps(a, [a[0] - dz * swing, a[1] + dx * swing])} className="ds-opening-swing" />
            <path d={`M ${b.join(' ')} A ${o.width} ${o.width} 0 0 ${swing > 0 ? 1 : 0} ${a[0] - dz * swing} ${a[1] + dx * swing}`} className="ds-opening-swing" />
          </>}
          <line {...lineProps(a, b)} className="ds-opening-hit" />
        </g>
      })}
      {previewOpening && (() => {
        const o = previewOpening
        const line = lines.find(l => sameMount(l.mount, o) && o.at >= l.range[0] && o.at <= l.range[1])
        return line && <line {...lineProps(along(line.a, line.b, o.at - o.width / 2), along(line.a, line.b, o.at + o.width / 2))} className="ds-opening-preview" />
      })()}
      {tool === 'select' && selected && currentRect && <g className="ds-handles">
        <polygon points={shape(currentRect, itemFrame)} className="ds-selected-outline" />
        {SIDES.map(side => {
          const [a, b] = rectEdge(currentRect, side).map(p => framePoint(itemFrame, ...p))
          const [hx, hz] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          return <g key={side} {...pick(selected)} data-side={side} className={`ds-grip is-${side}`}>
            <line {...lineProps(a, b)} />
            <circle cx={hx} cy={hz} r={textScale * 0.64} className="ds-grip-dot" />
            <circle cx={hx} cy={hz} r={textScale * 1.5} className="ds-grip-hit" />
          </g>
        })}
        {(['s', 'e'] as const).map(side => {
          const [a, b] = rectEdge(currentRect, side).map(p => framePoint(itemFrame, ...p))
          return <text key={side} x={(a[0] + b[0]) / 2 + (side === 'e' ? textScale * 1.25 : 0)}
            y={(a[1] + b[1]) / 2 + (side === 's' ? textScale * 1.55 : -textScale * 0.75)}
            fontSize={textScale} className="ds-dimension-text">{displaySpan(distance(a, b), units)}</text>
        })}
      </g>}
      {selectedWallPoints && selected && tool === 'select' && <g className="ds-handles">
        {drag?.kind === 'wall-end' && <line {...lineProps(selectedWallPoints.a, selectedWallPoints.b)} className="ds-sketch" />}
        {(['a', 'b'] as const).map(endpoint => {
          const p = selectedWallPoints[endpoint]
          return <g className="ds-grip is-wall" key={endpoint} {...pick(selected)} data-endpoint={endpoint}>
            <circle cx={p[0]} cy={p[1]} r={textScale * 0.64} className="ds-grip-dot" />
            <circle cx={p[0]} cy={p[1]} r={textScale * 1.5} className="ds-grip-hit" />
          </g>
        })}
      </g>}
      {first && <circle className="ds-sketch-anchor" cx={first[0]} cy={first[1]} r={textScale * 0.6} />}
      {drag?.kind === 'draw' && <>
        {drag.tool === 'wall' || drag.tool === 'stair' ? <line {...lineProps(drag.a, drag.b)} className="ds-sketch" />
          : draftBox && <polygon points={shape(draftBox)} className="ds-sketch" />}
        {draftStair && <polygon points={shape(stairFlight(draftStair).rect)} className="ds-sketch" />}
        {distance(drag.a, drag.b) > 0.2 && <text x={drag.b[0]} y={drag.b[1] - textScale} fontSize={textScale} className="ds-dimension-text">
          {drag.tool === 'wall' ? displaySpan(distance(drag.a, drag.b), units)
            : draftBox && drag.tool !== 'stair' ? `${displaySpan(draftBox[2] - draftBox[0], units)} × ${displaySpan(draftBox[3] - draftBox[1], units)}` : ''}
        </text>}
      </>}
    </svg>
    <div className="ds-grid-note">
      {tool === 'opening' ? OPENING_CATALOG[catalog].name : <>{units === 'ft' ? '1 ft' : '0.1 m'} snap <span>·</span> {displaySpan(snapValue(major, step), units)} grid</>}
    </div>
  </div>
}
