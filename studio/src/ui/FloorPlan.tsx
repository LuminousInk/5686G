import { useMemo } from 'react'
import type { HomePlan, Opening, Side } from '../engine/house/types'
import { sideFrame, sideIntervals, SIDES } from '../engine/house/massing'

const FT = 3.28084

export function feetInches(m: number) {
  const totalIn = Math.round(m * FT * 12)
  const ft = Math.floor(totalIn / 12)
  const inch = totalIn % 12
  return inch ? `${ft}'${inch}"` : `${ft}'`
}

export interface FloorPlanProps {
  plan: HomePlan
  /** camera position + yaw for the "you are here" marker */
  you?: { x: number; z: number; yaw: number } | null
  compact?: boolean
  onRoom?: (roomId: string, x: number, z: number) => void
  selected?: string | null
  className?: string
  /** turn a wide plan 90 degrees to fill a portrait screen (labels stay upright) */
  rotate?: boolean
}

/** Architectural floor plan drawn from the plan data (walls, openings, door swings, rooms, outdoor areas). */
export function FloorPlan({ plan, you, compact, onRoom, selected, className, rotate }: FloorPlanProps) {
  const geo = useMemo(() => planGeometry(plan), [plan])
  const pad = compact ? 0.8 : 2.4
  const [minX, minZ, maxX, maxZ] = geo.bounds
  const vb = rotate
    ? `${minZ - pad} ${-(maxX + pad)} ${maxZ - minZ + pad * 2} ${maxX - minX + pad * 2}`
    : `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`
  // rotate(-90): plan (x, z) is drawn at (z, -x)
  const up = (cx: number, cz: number) => (rotate ? `rotate(90 ${cx} ${cz})` : undefined)
  return (
    <svg className={className} viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${plan.name} floor plan`}>
      <g transform={rotate ? 'rotate(-90)' : undefined}>
      <defs>
        <pattern id="deckhatch" width="0.3" height="0.3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="0.3" stroke="var(--plan-line-soft)" strokeWidth="0.05" />
        </pattern>
      </defs>
      {/* outdoor areas */}
      {plan.terraces.map(t => (
        <rect key={t.id} x={t.rect[0]} y={t.rect[1]} width={t.rect[2] - t.rect[0]} height={t.rect[3] - t.rect[1]} fill="var(--plan-outdoor)" stroke="var(--plan-line-soft)" strokeWidth="0.04" />
      ))}
      {plan.decks.map(d => (
        <rect key={d.id} x={d.rect[0]} y={d.rect[1]} width={d.rect[2] - d.rect[0]} height={d.rect[3] - d.rect[1]} fill="url(#deckhatch)" stroke="var(--plan-line-soft)" strokeWidth="0.04" />
      ))}
      {plan.porches.map(p => (
        <rect key={p.id} x={p.rect[0]} y={p.rect[1]} width={p.rect[2] - p.rect[0]} height={p.rect[3] - p.rect[1]} fill="none" stroke="var(--plan-line-soft)" strokeWidth="0.05" strokeDasharray="0.25 0.18" />
      ))}
      {/* house footprint */}
      {plan.blocks.map(b => (
        <rect key={b.id} x={b.rect[0]} y={b.rect[1]} width={b.rect[2] - b.rect[0]} height={b.rect[3] - b.rect[1]} fill="var(--plan-floor)" />
      ))}
      {/* rooms */}
      {plan.rooms.map(r => {
        const [x0, z0, x1, z1] = r.rect
        const cx = (x0 + x1) / 2
        const cz = (z0 + z1) / 2
        const w = x1 - x0
        const h = z1 - z0
        const small = Math.min(w, h) < 2.2
        const sel = selected === r.id
        return (
          <g
            key={r.id}
            className={onRoom ? 'plan-room' : undefined}
            onClick={onRoom ? () => onRoom(r.id, cx, cz) : undefined}
            style={{ cursor: onRoom ? 'pointer' : undefined }}
          >
            <rect x={x0} y={z0} width={w} height={h} fill={sel ? 'var(--plan-select)' : 'transparent'} />
            {!compact && (
              <>
                <g transform={up(cx, cz)}>
                  <text x={cx} y={cz - (small ? 0 : 0.18)} className="plan-label" fontSize={small ? 0.3 : 0.42} textAnchor="middle">
                    {r.name}
                  </text>
                  {!small && (
                    <text x={cx} y={cz + 0.42} className="plan-dim" fontSize={0.3} textAnchor="middle">
                      {feetInches(w)} × {feetInches(h)}
                    </text>
                  )}
                </g>
              </>
            )}
          </g>
        )
      })}
      {/* interior walls */}
      {geo.interior.map((s, i) => (
        <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke="var(--plan-wall)" strokeWidth={0.12} strokeLinecap="square" />
      ))}
      {/* exterior walls */}
      {geo.exterior.map((s, i) => (
        <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke="var(--plan-wall)" strokeWidth={0.22} strokeLinecap="square" />
      ))}
      {/* windows: thin lines in a light gap */}
      {geo.windows.map((s, i) => (
        <g key={i}>
          <line x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke="var(--plan-floor)" strokeWidth={0.24} />
          <line x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke="var(--plan-wall)" strokeWidth={0.04} />
        </g>
      ))}
      {/* doors: gap + swing */}
      {geo.doors.map((d, i) => (
        <g key={i}>
          <line x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} stroke="var(--plan-floor)" strokeWidth={0.26} />
          {!compact && <path d={d.swing} fill="none" stroke="var(--plan-line-soft)" strokeWidth={0.035} />}
        </g>
      ))}
      {you && (
        <g transform={`translate(${you.x} ${you.z}) rotate(${(-you.yaw * 180) / Math.PI})`}>
          <path d="M0 0 L-1.6 -3.2 A3.6 3.6 0 0 1 1.6 -3.2 Z" fill="var(--plan-you-cone)" />
          <circle r={compact ? 0.45 : 0.32} fill="var(--plan-you)" stroke="var(--plan-floor)" strokeWidth={0.08} />
        </g>
      )}
      {!compact && <NorthArrow x={maxX + pad * 0.55} z={minZ - pad * 0.1} />}
      </g>
    </svg>
  )
}

function NorthArrow({ x, z }: { x: number; z: number }) {
  return (
    <g transform={`translate(${x} ${z})`} className="plan-north">
      <path d="M0 -0.7 L0.32 0.35 L0 0.15 L-0.32 0.35 Z" fill="var(--plan-wall)" />
      <text y={-0.9} fontSize={0.36} textAnchor="middle" className="plan-dim">N</text>
    </g>
  )
}

interface PlanGeo {
  bounds: [number, number, number, number]
  exterior: [number, number, number, number][]
  interior: [number, number, number, number][]
  windows: [number, number, number, number][]
  doors: { a: [number, number]; b: [number, number]; swing: string }[]
}

export function planGeometry(plan: HomePlan): PlanGeo {
  const ext: [number, number, number, number][] = []
  const win: [number, number, number, number][] = []
  const doors: PlanGeo['doors'] = []
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  const grow = (r: [number, number, number, number]) => {
    minX = Math.min(minX, r[0])
    minZ = Math.min(minZ, r[1])
    maxX = Math.max(maxX, r[2])
    maxZ = Math.max(maxZ, r[3])
  }
  for (const b of plan.blocks) grow(b.rect)
  for (const d of plan.decks) grow(d.rect)
  for (const t of plan.terraces) grow(t.rect)
  for (const p of plan.porches) grow(p.rect)
  const inset = 0.11
  for (const b of plan.blocks) {
    for (const s of SIDES) {
      const { frame: f, intervals } = sideIntervals(b, s, plan.blocks)
      const P = (u: number): [number, number] => [f.sx + f.dx * u - f.ox * inset, f.sz + f.dz * u - f.oz * inset]
      for (const iv of intervals) {
        if (iv.neighbour) continue
        const a = P(iv.u0)
        const c = P(iv.u1)
        ext.push([a[0], a[1], c[0], c[1]])
      }
      for (const o of plan.openings.filter(x => x.block === b.id && x.side === s)) {
        const a = P(o.at - o.width / 2)
        const c = P(o.at + o.width / 2)
        if (o.kind === 'entry' || o.kind === 'door' || o.kind === 'garage' || o.kind === 'slider') {
          if (o.kind === 'slider' || o.kind === 'garage') {
            doors.push({ a, b: c, swing: '' })
            win.push([a[0], a[1], c[0], c[1]])
          } else doors.push({ a, b: c, swing: swing(a, c, f.ox, f.oz, -1) })
        } else win.push([a[0], a[1], c[0], c[1]])
      }
    }
  }
  const intr: [number, number, number, number][] = []
  for (const w of plan.walls) {
    intr.push([w.a[0], w.a[1], w.b[0], w.b[1]])
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const dx = (w.b[0] - w.a[0]) / L
    const dz = (w.b[1] - w.a[1]) / L
    for (const o of plan.openings.filter((x: Opening) => x.wall === w.id)) {
      const a: [number, number] = [w.a[0] + dx * (o.at - o.width / 2), w.a[1] + dz * (o.at - o.width / 2)]
      const c: [number, number] = [w.a[0] + dx * (o.at + o.width / 2), w.a[1] + dz * (o.at + o.width / 2)]
      // swing toward +perpendicular (matches the 3D door leaf)
      doors.push({ a, b: c, swing: swing(a, c, -dz, dx, 1) })
    }
  }
  void sideFrame
  return { bounds: [minX, minZ, maxX, maxZ], exterior: ext, interior: intr, windows: win, doors }
}

/** Quarter-circle door swing from hinge `a`, leaf length |b-a|, opening toward normal (nx, nz) * sign. */
function swing(a: [number, number], b: [number, number], nx: number, nz: number, sign: number) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const ex = a[0] + nx * sign * L
  const ez = a[1] + nz * sign * L
  // sweep direction: pick the flag that draws the short arc between b and e
  const cross = (b[0] - a[0]) * (ez - a[1]) - (b[1] - a[1]) * (ex - a[0])
  const sweep = cross > 0 ? 1 : 0
  return `M${a[0]} ${a[1]} L${ex} ${ez} A${L} ${L} 0 0 ${sweep} ${b[0]} ${b[1]}`
}

export type { Side }
