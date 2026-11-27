import { levelFloor } from '../engine/house/levels'
import type { CameraView, HomePlan } from '../engine/house/types'

export interface GalleryImage {
  id: string
  plan: string
  home: string
  kind: 'exterior' | 'interior'
  space: string
  style: string
  light: string
  share: string
  width?: number
  height?: number
}

export interface GalleryCatalog {
  homes: { id: string; name: string; style: string; area: number; beds: number; baths: number }[]
  images: GalleryImage[]
  comparisons: GalleryPair[]
}

export interface GalleryPair {
  before: string
  after: string
  beforeLabel: string
  afterLabel: string
}

export function availableComparisons(pairs: GalleryPair[], images: GalleryImage[], missing: ReadonlySet<string>) {
  const byId = new Map(images.filter(image => !missing.has(image.id)).map(image => [image.id, image]))
  return pairs.flatMap(pair => {
    const before = byId.get(pair.before)
    const after = byId.get(pair.after)
    return before && after && before.plan === after.plan ? [{ ...pair, before, after }] : []
  })
}

interface Shot {
  id: string
  plan: string
  space: string
  view: CameraView
  time?: 'day' | 'dusk'
  finishes?: Record<string, string>
  styleZones?: string[]
}

function orbit(pos: CameraView['pos'], target: [number, number], fov: number): CameraView {
  return { id: '', label: '', kind: 'orbit', pos, target: [target[0], pos[1], target[1]], fov }
}

function room(id: string, pos: [number, number], target: [number, number], lens = 25, eye = 1.36): CameraView {
  // Convert the full-frame focal length to vertical FOV on a 16:9 gate.
  const fov = 2 * Math.atan((36 * 9 / 16) / (2 * lens)) * 180 / Math.PI
  return { id: '', label: '', kind: 'walk', room: id, pos: [pos[0], eye, pos[1]], target: [target[0], eye, target[1]], fov }
}

export const GALLERY_SHOTS: Shot[] = [
  { id: 'cedar-ridge-golden', plan: 'cedar-ridge', space: 'Garden elevation', view: orbit([-7.5, 2.65, 21.5], [1.8, -3], 35) },
  { id: 'coastal-modern-golden', plan: 'coastal-modern', space: 'Entry elevation', view: orbit([-7.5, 2.35, 18.5], [-1, -2.5], 36), styleZones: ['coastal', 'cedar'] },
  { id: 'woodland-modern-golden', plan: 'woodland-modern', space: 'Garden elevation', view: orbit([-10.5, 2.6, 23], [-0.5, -3], 40) },
  { id: 'aspen-custom-golden', plan: 'aspen-custom', space: 'Walkout elevation', view: orbit([-16, 1, -43], [-1, -3], 40) },
  { id: 'modern-farmhouse-golden', plan: 'modern-farmhouse', space: 'Porch elevation', view: orbit([-9.5, 2.9, 23.5], [0, -3], 36) },
  { id: 'cedar-great-room', plan: 'cedar-ridge', space: 'Great room', view: room('great', [2.55, -5.78], [0.1, -1.3], 25) },
  { id: 'coastal-kitchen', plan: 'coastal-modern', space: 'Kitchen', view: room('kitchen', [2.65, -5.0], [-0.15, -8.65], 25, 1.44), time: 'day' },
  { id: 'woodland-primary', plan: 'woodland-modern', space: 'Primary bedroom', view: room('primary', [-12.8, -0.52], [-9.9, -4.0], 26, 1.28) },
  { id: 'aspen-lower-suite', plan: 'aspen-custom', space: 'Lower suite', view: room('bed5', [7.75, -0.6], [10.86, -3.35], 24, 1.28) },
  { id: 'farmhouse-great-room', plan: 'modern-farmhouse', space: 'Great room', view: room('great', [-2.58, -0.59], [0.4, -4.5], 25) },
  { id: 'cedar-charred', plan: 'cedar-ridge', space: 'Garden elevation', view: orbit([-7.5, 2.65, 21.5], [1.8, -3], 35), finishes: { cedar: 'charcoal' }, styleZones: ['cedar'] },
  { id: 'coastal-weathered', plan: 'coastal-modern', space: 'Entry elevation', time: 'day', view: orbit([-7.5, 2.35, 18.5], [-1, -2.5], 36), finishes: { coastal: 'weathered-cedar' }, styleZones: ['coastal'] },
  { id: 'woodland-day', plan: 'woodland-modern', space: 'Entry terrace', time: 'day', view: orbit([17, 2.6, 22], [2.2, -3], 37) },
  { id: 'aspen-dusk', plan: 'aspen-custom', space: 'Walkout elevation', time: 'dusk', view: orbit([21, 1.25, -44], [-1, -3], 40) },
  { id: 'farmhouse-sage', plan: 'modern-farmhouse', space: 'Porch elevation', time: 'day', view: orbit([-9.5, 2.9, 23.5], [0, -3], 36), finishes: { body: 'sage' }, styleZones: ['body'] },
  { id: 'cedar-dusk', plan: 'cedar-ridge', space: 'Terrace elevation', time: 'dusk', view: orbit([-4.4, 2.6, 18.5], [1.2, -2], 37) },
  { id: 'cedar-kitchen', plan: 'cedar-ridge', space: 'Kitchen', view: room('kitchen', [-3.4, -3.05], [-6.02, -7.62], 25, 1.44), finishes: { palette: 'walnut', walls: 'limewash' } },
  { id: 'coastal-living', plan: 'coastal-modern', space: 'Great room', view: room('living', [-1.87, -4.8], [0.32, -0.1], 24), finishes: { palette: 'ash', walls: 'warm-white' } },
  { id: 'woodland-great-room', plan: 'woodland-modern', space: 'Great room', view: room('great', [2.62, 0.78], [-0.65, -6.05], 24), finishes: { walls: 'limewash' } },
  { id: 'aspen-great-room', plan: 'aspen-custom', space: 'Great room', view: room('great', [-0.08, 7.55], [0.65, -0.22], 25), finishes: { palette: 'walnut' } },
  { id: 'farmhouse-kitchen', plan: 'modern-farmhouse', space: 'Kitchen', view: room('kitchen', [2.65, -4.3], [5.6, -8.2], 25, 1.44), finishes: { walls: 'greige' } },
  { id: 'cedar-primary-bath', plan: 'cedar-ridge', space: 'Primary bath', view: room('pbath', [14.63, -6.34], [12.61, -9.12], 24, 1.39) },
]

export function galleryView(plan: HomePlan, id: string): CameraView | undefined {
  const shot = GALLERY_SHOTS.find(s => s.plan === plan.id && s.id === id)
  if (!shot) return
  const { view } = shot
  const space = plan.rooms.find(r => r.id === view.room)
  const y = view.kind === 'walk' ? levelFloor(plan, space?.level) + view.pos[1] : view.pos[1]
  return {
    ...view,
    id,
    label: shot.space,
    pos: [view.pos[0], y, view.pos[2]],
    target: [view.target[0], y, view.target[2]],
  }
}

export function designView(plan: HomePlan, id: string | null): CameraView | undefined {
  return id ? plan.views.find(v => v.id === id) ?? galleryView(plan, id) : undefined
}
