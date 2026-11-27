import { deflateSync, inflateSync } from 'fflate'
import type { HomePlan } from '../../engine/house/types'
import { ZONES } from '../../engine/materials/catalog'
import { DRAFT_CODE } from '../routes'
import { designSource, editIssues, finishPlan, LIMITS, newDesign, ROOM_TYPES, type Design } from './plan'

const KEY = 'cuby-designs-v1'
const sessionDocuments = new Map<string, Design>()
const MAX_BYTES = 160_000
const MAX_CODE = 100_000
export const MAX_LINK = 1800

type ObjectValue = Record<string, unknown>
type Check = (value: unknown) => boolean

const object = (o: unknown): o is ObjectValue => !!o && typeof o === 'object' && !Array.isArray(o)
const text = (max: number): Check => value => typeof value === 'string' && !!value.trim() && value.length <= max
const numeric = (lo: number, hi: number): Check => value => typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi
const integer = (lo: number, hi: number): Check => value => Number.isInteger(value) && numeric(lo, hi)(value)
const oneOf = (...options: unknown[]): Check => v => options.includes(v)
const maybe = (check: Check): Check => v => v === undefined || check(v)
const list = (max: number, check: Check): Check => v => Array.isArray(v) && v.length <= max && v.every(check)
const record = (fields: Record<string, Check>): Check => value => object(value)
  && Object.keys(value).every(k => Object.hasOwn(fields, k))
  && Object.entries(fields).every(([key, check]) => check(value[key]))
const tuple = (size: number, check: Check): Check => value => Array.isArray(value) && value.length === size && value.every(check)
const id = text(145), name = text(72), level = maybe(id), bool = oneOf(true, false)
const point = tuple(2, numeric(-64, 64))
const rect = tuple(4, numeric(-64, 64))
const side = oneOf('n', 's', 'e', 'w'), axis = oneOf('x', 'z')
const roofHeight = numeric(1.75, 9)
const zone: Check = v => typeof v === 'string' && Object.hasOwn(ZONES, v)
const overhang: Check = v => numeric(0, 4)(v) || record({ n: maybe(numeric(0, 4)), e: maybe(numeric(0, 4)), s: maybe(numeric(0, 4)), w: maybe(numeric(0, 4)) })(v)
const top = { thickness: maybe(numeric(0.07, 1)), overhang: maybe(overhang) }
const roof: Check = v => {
  if (!object(v)) return false
  switch (v.type) {
    case 'flat': return record({ type: oneOf('flat'), height: roofHeight, bearing: maybe(bool), parapet: maybe(numeric(0, 2)), ...top })(v)
    case 'shed': return record({
      type: oneOf('shed'), low: roofHeight, high: roofHeight, rises: side, ...top,
      solar: maybe(record({ rows: integer(1, 12), cols: integer(1, 24), inset: maybe(numeric(0, 3)) })),
    })(v) && Number(v.high) >= Number(v.low)
    case 'gable':
    case 'hip': return record({
      type: oneOf('hip', 'gable'), eave: roofHeight, ridge: roofHeight, ...top,
      ...(v.type === 'gable' ? { ridgeAxis: axis } : {}),
    })(v) && Number(v.ridge) > Number(v.eave)
    default: return false
  }
}
const siding = record({ zone, kind: oneOf('boards', 'panel', 'batten', 'stucco', 'stone', 'lap') })
const block = record({
  id, rect, roof, level, yaw: maybe(numeric(-Math.PI, Math.PI)), ceiling: maybe(v => v === 'vaulted' || roofHeight(v)),
  ceilingFinish: maybe(oneOf('paint', 'wood')), utility: maybe(bool),
  cladding: record({ default: siding, n: maybe(siding), s: maybe(siding), e: maybe(siding), w: maybe(siding) }),
})
const room = record({
  id, name, rect, type: oneOf(...ROOM_TYPES.map(r => r.type)), level, frame: maybe(id),
  floor: maybe(oneOf('wood', 'tile', 'concrete')), enclosed: maybe(bool), sourceFurnish: maybe(bool),
})
const wall = record({ id, a: point, b: point, level, frame: maybe(id), thickness: maybe(numeric(0.06, 0.4)) })
const opening = record({
  id, block: maybe(id), wall: maybe(id), side: maybe(side), at: numeric(0, 184), width: numeric(0.3, 16), height: numeric(0.25, 8),
  kind: oneOf('window', 'fixed', 'slider', 'door', 'entry', 'garage', 'clerestory'), sill: maybe(numeric(0, 7)),
  panes: maybe(integer(1, 16)), transom: maybe(numeric(0, 8)), slide: maybe(oneOf('center', 'right')),
})
const deck = record({
  id, rect, height: numeric(-6, 12), boardsAlong: axis, rails: maybe(list(4, side)), railHeight: maybe(numeric(0.5, 2)),
  zone: maybe(zone), supportY: maybe(numeric(-15, 5)), spa: maybe(rect),
})
const porch = record({
  id, rect, frame: maybe(id), posts: list(24, point), height: numeric(1.6, 8), roofThickness: maybe(numeric(0.05, 1)), rises: maybe(side),
})
const stair = record({
  id, from: point, dir: side, width: numeric(0.45, 8), rise: numeric(0.1, 8), steps: integer(1, 60),
  rails: maybe(list(2, oneOf('left', 'right'))), going: maybe(numeric(0.15, 0.6)), between: maybe(record({ upper: id, lower: id })),
})
const terrace = record({
  id, rect, frame: maybe(id), kind: oneOf('pavers', 'concrete', 'gravel'), height: maybe(numeric(-8, 12)), supportY: maybe(numeric(-15, 5)),
})
const finish = (v: unknown) => object(v) && Object.entries(v).every(([key, value]) => zone(key) && ZONES[key].options.some(option => option.id === value))
const fields = {
  name, blocks: list(LIMITS.blocks, block), rooms: list(LIMITS.rooms, room), walls: list(LIMITS.walls, wall),
  openings: list(LIMITS.openings, opening), decks: list(LIMITS.decks, deck), porches: list(LIMITS.porches, porch),
  stairs: list(LIMITS.stairs, stair), terraces: list(LIMITS.terraces, terrace), finishes: finish,
  levels: maybe(list(LIMITS.levels, record({ id, label: name, offset: numeric(-9, 14) }))),
}
const fieldsValid = record(fields)
type Geometry = Omit<Pick<HomePlan, keyof typeof fields>, 'rooms'> & { rooms: (HomePlan['rooms'][number] & { sourceFurnish?: boolean })[] }

function payload(d: Design): [string, Geometry] {
  const geometry = Object.fromEntries(Object.keys(fields).map(key => [key, d.plan[key as keyof Geometry]])) as Geometry
  geometry.rooms = geometry.rooms.map(room => {
    const { furnish, ...shape } = room
    return { ...shape, sourceFurnish: furnish ? true : undefined }
  })
  return [d.source, geometry]
}

const uniqueIds = (items: { id?: string }[]) => new Set(items.map(item => item.id)).size === items.length

function restore(data: unknown, key: string): Design | undefined {
  if (!Array.isArray(data) || data.length !== 2 || typeof data[0] !== 'string') return
  const source = data[0]
  const base = newDesign(source, key)
  if (!base || !fieldsValid(data[1])) return
  const g = data[1] as Geometry
  const template = designSource(source)!
  const p: HomePlan = { ...base.plan, ...g, finishes: { ...template.finishes, ...g.finishes } }
  const levels = p.levels?.map(l => l.id) ?? ['main']
  if (!p.blocks.length || !levels.length || (p.levels && p.levels[0].offset !== 0)) return
  const offsets = p.levels?.map(l => l.offset).sort((a, b) => a - b) ?? [0]
  if (offsets.some((offset, i) => i > 0 && offset - offsets[i - 1] < 2.3)) return
  if (![p.blocks, p.rooms, p.walls, p.openings, p.decks, p.porches, p.stairs, p.terraces, p.levels ?? []].every(uniqueIds)) return
  const blocked = (v: { level?: string; frame?: string }) => (v.level && !levels.includes(v.level)) || (v.frame && !p.blocks.some(b => b.id === v.frame && b.yaw && (v.level ?? levels[0]) === (b.level ?? levels[0])))
  if ([...p.blocks, ...p.rooms, ...p.walls].some(blocked)) return
  if (p.openings.some(o => o.wall
    ? o.block || o.side || !p.walls.some(w => w.id === o.wall)
    : !o.side || !p.blocks.some(b => b.id === o.block))) return
  if (p.stairs.some(s => s.between && (!p.levels || s.between.upper === s.between.lower || !levels.includes(s.between.upper) || !levels.includes(s.between.lower)
    || Math.abs(s.rise - ((p.levels!.find(l => l.id === s.between!.upper)?.offset ?? 0) - (p.levels!.find(l => l.id === s.between!.lower)?.offset ?? 0))) > 0.01))) return
  if ([...p.porches, ...p.terraces].some(o => o.frame && !p.blocks.some(b => b.id === o.frame))) return
  if ([...p.decks, ...p.porches, ...p.terraces].some(({ rect: [a, b, c, d] }) => c <= a || d <= b)) return
  const baseline = editIssues(base.plan)
  if ([...editIssues(p)].some(issue => !baseline.has(issue))) return
  p.rooms = g.rooms.map(({ sourceFurnish, ...r }) => ({
    ...r, furnish: sourceFurnish ? template.rooms.find(t => t.id === r.id && t.type === r.type)?.furnish : undefined,
  }))
  return { source, plan: finishPlan(p) }
}

export function encodeDocument(d: Design) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload(d)))
  const packed = deflateSync(bytes, { level: 6 })
  // Keep standard Base64 alphanumerics. Encode punctuation with a two-character escape.
  const body = btoa(Array.from(packed, byte => String.fromCharCode(byte)).join(''))
    .replace(/=+$/, '').replace(/\+/g, '-p').replace(/\//g, '-s')
  return `${DRAFT_CODE}${bytes.length.toString(36)}-${body}`
}

export function decodeDocument(code: string, key: string): Design | undefined {
  try {
    const raw = code.trim().split('#').at(-1) ?? ''
    const match = raw.match(/^d1-([a-z0-9]{1,5})-([A-Za-z0-9-]+)$/)
    if (!match || raw.length > MAX_CODE) return
    const size = Number.parseInt(match[1], 36)
    if (!size || size > MAX_BYTES) return
    const body = match[2].replace(/-p/g, '+').replace(/-s/g, '/')
    const compressed = Uint8Array.from(atob(body), c => c.charCodeAt(0))
    const bytes = inflateSync(compressed, { out: new Uint8Array(size + 1) })
    if (bytes.length !== size) return
    return restore(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), key)
  } catch {
    return undefined
  }
}

export function newDocumentId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `draft-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
}

export function readDocuments(): Design[] {
  const inSession = [...sessionDocuments.values()].reverse()
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(data)) return inSession
    return [...inSession, ...data.flatMap(item => {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || !/^draft-[a-z0-9-]{4,80}$/.test(item[0]) || sessionDocuments.has(item[0])) return []
      try {
        const design = restore(item[1], item[0])
        return design ? [design] : []
      } catch {
        return []
      }
    })]
  } catch {
    return inSession
  }
}

export function saveDocument(doc: Design) {
  sessionDocuments.delete(doc.plan.id)
  sessionDocuments.set(doc.plan.id, doc)
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    const stored = Array.isArray(raw) ? raw.filter(row => Array.isArray(row) && row[0] !== doc.plan.id) : []
    localStorage.setItem(KEY, JSON.stringify([[doc.plan.id, payload(doc)], ...stored]))
    return true
  } catch {
    return false
  }
}

export interface History {
  past: HomePlan[]
  plan: HomePlan
  future: HomePlan[]
}
export type HistoryAction = { type: 'undo' | 'redo' } | { type: 'edit'; plan: HomePlan }
export const startHistory = (plan: HomePlan): History => ({ past: [], plan, future: [] })

export function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === 'undo') {
    const plan = state.past.at(-1)
    return plan ? { past: state.past.slice(0, -1), plan, future: [state.plan, ...state.future] } : state
  }
  if (action.type === 'redo') {
    const [plan, ...future] = state.future
    return plan ? { past: [...state.past, state.plan], plan, future } : state
  }
  return action.type === 'edit' && action.plan !== state.plan
    ? { past: [...state.past.slice(-49), state.plan], plan: action.plan, future: [] }
    : state
}
