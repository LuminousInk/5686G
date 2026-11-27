import { useSyncExternalStore } from 'react'
import { ZONES } from '../engine/materials/catalog'
import { TIME_PRESETS } from '../engine/env/environment'
import { PLANS, planById } from '../plans'
import type { HomePlan } from '../engine/house/types'
import { designView } from './galleryShots'
import { shareCode } from './routes'
import { decodePose, encodePose } from './sharePose'
import type { CameraPose } from '../engine/nav/pose'

const STORE_KEY = 'cuby-studio-edits-v1'
function loadCustom(): Record<string, HomePlan> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, HomePlan>) : {}
  } catch {
    return {}
  }
}
export function saveCustom(c: Record<string, HomePlan>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(c))
  } catch {
    /* storage may be unavailable (private window); edits still live for this visit */
  }
}

export type UiMode = 'orbit' | 'walk' | 'dollhouse' | 'plan'
export type Sheet = null | 'plans' | 'customize' | 'help' | 'share'

export interface AppState {
  planId: string
  /** per plan: zone -> option id */
  finishes: Record<string, Record<string, string>>
  time: string
  mode: UiMode
  sheet: Sheet
  /** progress of the current load; `error` is set when it failed (shown with a Try again button) */
  loading: { p: number; label: string; error?: string } | null
  viewId: string | null
  pose?: CameraPose
  toast: string | null
  photo: null | { state: 'rendering' | 'done'; samples: number; url?: string }
  editing: boolean
  walkHint: boolean
  fps: number
  /** plans edited in the editor (saved in this browser) */
  customPlans: Record<string, HomePlan>
}

const listeners = new Set<() => void>()
let state: AppState = {
  planId: PLANS[0].id,
  finishes: Object.fromEntries(PLANS.map(p => [p.id, { ...p.finishes }])),
  time: 'golden',
  mode: 'orbit',
  sheet: 'plans',
  loading: { p: 0, label: 'Starting' },
  viewId: null,
  toast: null,
  photo: null,
  editing: false,
  walkHint: true,
  fps: 0,
  customPlans: loadCustom(),
}

export function getState() {
  return state
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  for (const l of listeners) l()
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => sel(state),
  )
}

let toastTimer = 0
export function toast(msg: string) {
  setState({ toast: msg })
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => setState({ toast: null }), 2600)
}

// ------------------------------------------------------------------ share codes
// Artifact hosts only pass a plain "#name" hash (letters, digits, hyphens). Encode the design as
// #c-<plan>-<time>-<option per zone ...>[-v-<view id> | -p-<pose>]

export function encodeDesign(s: AppState = state): string {
  const pi = PLANS.findIndex(p => p.id === s.planId)
  const plan = PLANS[pi]
  const ti = Math.max(0, TIME_PRESETS.findIndex(t => t.id === s.time))
  const f = s.finishes[plan.id] ?? plan.finishes
  const parts = plan.zones.map(z => Math.max(0, ZONES[z].options.findIndex(o => o.id === f[z])))
  const base = ['c', pi, ti, ...parts].join('-')
  const pose = s.pose && encodePose(s.pose)
  if (s.viewId) return `${base}-v-${s.viewId}`
  return pose ? `${base}-p-${pose}` : base
}

export function decodeDesign(hash: string): Partial<AppState> | null {
  const m = shareCode(hash)
  if (!m) return null
  const plan = PLANS[Number(m[1])]
  if (!plan) return null
  const time = TIME_PRESETS[Number(m[2])]?.id ?? 'golden'
  const idx = m[3].split('-').filter(Boolean).map(Number)
  const f: Record<string, string> = { ...plan.finishes }
  plan.zones.forEach((z, i) => {
    const o = ZONES[z].options[idx[i]]
    if (o) f[z] = o.id
  })
  const viewId = m[4] && designView(plan, m[4]) ? m[4] : null
  return { planId: plan.id, time, finishes: { ...state.finishes, [plan.id]: f }, sheet: null, viewId, pose: m[5] ? decodePose(m[5]) : undefined }
}

export function currentPlan(): HomePlan {
  return state.customPlans[state.planId] ?? planById(state.planId)!
}

export function planFor(id: string): HomePlan {
  return state.customPlans[id] ?? planById(id)!
}
