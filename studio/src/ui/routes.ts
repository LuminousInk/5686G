import { planById } from '../plans'

const studioFlags = ['plan', 'time', 'view', 'quality', 'frames', 'tm', 'ui', 'sheet', 'gallery']

const homePrefix = '#home-'

export const homeRoute = (id: string) => homePrefix + id

export function homeFromRoute(hash: string) {
  return hash.startsWith(homePrefix) ? planById(hash.slice(homePrefix.length)) : undefined
}

export interface StudioTarget { hash: string }

export interface StudioLoad {
  target: StudioTarget
  progress: number
  error?: string
}

export function designCode(hash: string) {
  return hash.replace(/^#/, '').match(/^c-(\d+)-(\d+)((?:-\d+)*)(?:-v-([a-z0-9]+(?:-[a-z0-9]+)*))?$/)
}

export function isStudioRoute(hash: string, search: string): boolean {
  if (hash === '#studio' || (hash.startsWith('#') && designCode(hash))) return true
  // Keep screenshot, bake and smoke-test entry points working in local previews.
  const params = new URLSearchParams(search)
  return !hash && studioFlags.some(flag => params.has(flag))
}
