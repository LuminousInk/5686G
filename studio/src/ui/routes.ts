import { planById } from '../plans'

const studioFlags = ['plan', 'time', 'view', 'quality', 'frames', 'tm', 'ui', 'sheet', 'gallery']

const homePrefix = '#home-'
const tourPrefix = '#tour-'
export const DESIGN_ROUTE = '#design'
export const PRESENTATION_ROUTE = '#presentation-homes'
export const DRAFT_CODE = 'd1-'
export const designerRoute = (source?: string) => source ? `${DESIGN_ROUTE}-${source}` : DESIGN_ROUTE
export const isDesignerRoute = (hash: string) => hash === DESIGN_ROUTE
  || hash.startsWith(`#${DRAFT_CODE}`) || (hash.startsWith(`${DESIGN_ROUTE}-`) && !!planById(hash.slice(DESIGN_ROUTE.length + 1)))
export const designerSource = (hash: string) => hash.startsWith(`${DESIGN_ROUTE}-`) ? planById(hash.slice(DESIGN_ROUTE.length + 1))?.id : undefined

export const homeRoute = (id: string) => homePrefix + id
export const tourRoute = (id: string) => tourPrefix + id

export function homeFromRoute(hash: string) {
  return hash.startsWith(homePrefix) ? planById(hash.slice(homePrefix.length)) : undefined
}

export function tourFromRoute(hash: string) {
  const plan = hash.startsWith(tourPrefix) ? planById(hash.slice(tourPrefix.length)) : undefined
  return plan?.tour?.length ? plan : undefined
}

export interface StudioTarget { hash: string }

export interface StudioLoad {
  target: StudioTarget
  progress: number
  error?: string
}

export function shareCode(hash: string) {
  return hash.replace(/^#/, '').match(/^c-(\d+)-(\d+)((?:-\d+)*)(?:-v-([a-z0-9]+(?:-[a-z0-9]+)*)|-p-([a-z0-9-]+))?$/)
}

/** Hashes that request a specific studio load, including a home's tour. */
export function designCode(hash: string) {
  return !!(hash === PRESENTATION_ROUTE || isDesignerRoute(hash) || shareCode(hash) || tourFromRoute(hash))
}

export function isStudioRoute(hash: string, search: string): boolean {
  if (hash === '#studio' || (hash.startsWith('#') && designCode(hash))) return true
  // Keep screenshot, bake and smoke-test entry points working in local previews.
  const params = new URLSearchParams(search)
  return !hash && studioFlags.some(flag => params.has(flag))
}
