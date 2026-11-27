// Plan data model. Everything in meters. Plan space: x to the right (east), z toward the street (south, +z is
// the front of the lot), y up. A home is a set of rectangular blocks (massing volumes); walls, roofs, cladding,
// floors and ceilings are generated from them. Openings sit on block sides (exterior) or on interior walls.

export type Side = 'n' | 's' | 'e' | 'w' // n = back (-z), s = front (+z), e = right (+x), w = left (-x)

export type Rect = [x0: number, z0: number, x1: number, z1: number]

/** A cladding zone id; the finish catalog maps it to a material (see catalog.ts). */
export type CladdingKind = 'boards' | 'panel' | 'batten' | 'stucco' | 'stone' | 'lap'

export interface CladdingSpec {
  /** configurable zone this surface belongs to (e.g. 'cedar', 'panel', 'accent') */
  zone: string
  kind: CladdingKind
}

export type Roof =
  | {
      type: 'shed'
      /** height of the roof underside above the floor at the low and high edges */
      low: number
      high: number
      /** direction the roof rises toward */
      rises: Side
      overhang?: number | Partial<Record<Side, number>>
      thickness?: number
      solar?: { rows: number; cols: number; inset?: number }
    }
  | {
      type: 'gable'
      eave: number
      ridge: number
      /** axis the ridge runs along */
      ridgeAxis: 'x' | 'z'
      overhang?: number | Partial<Record<Side, number>>
      thickness?: number
    }
  | { type: 'flat'; height: number; overhang?: number | Partial<Record<Side, number>>; thickness?: number; parapet?: number }

export interface Block {
  id: string
  rect: Rect
  level?: string
  /** Rotation in radians around the centre, in Three.js's +Y convention. */
  yaw?: number
  roof: Roof
  cladding: Partial<Record<Side, CladdingSpec>> & { default: CladdingSpec }
  /** interior ceiling: 'vaulted' follows the roof, a number is a flat ceiling height */
  ceiling?: 'vaulted' | number
  /** finish of the ceiling surface */
  ceilingFinish?: 'paint' | 'wood'
  /** a garage or other unconditioned space (no interior finishes, no furniture) */
  utility?: boolean
}

export type OpeningKind = 'window' | 'fixed' | 'slider' | 'door' | 'entry' | 'garage' | 'clerestory'

export interface BuiltDoor {
  /** index in HomePlan.openings */
  openingIndex: number
  kind: OpeningKind
  leaf: boolean
  glass: boolean
  casing: boolean
}

export interface Opening {
  id?: string
  /** exterior: block id + side; interior: wall id */
  block?: string
  side?: Side
  wall?: string
  /** distance from the side's start corner (west end for n/s sides, north end for e/w sides) to the opening center */
  at: number
  width: number
  height: number
  sill?: number
  kind: OpeningKind
  /** vertical mullions */
  panes?: number
  /** horizontal transom bar height above sill */
  transom?: number
  /** Open slider configuration. Centre uses four leaves with both middle leaves partly retracted. */
  slide?: 'center' | 'right'
}

export interface InteriorWall {
  id: string
  a: [number, number]
  b: [number, number]
  thickness?: number
  level?: string
  /** Rotated block whose local coordinates are used for a, b. */
  frame?: string
}

export type RoomType =
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bedroom'
  | 'primary'
  | 'bath'
  | 'powder'
  | 'laundry'
  | 'closet'
  | 'hall'
  | 'entry'
  | 'office'
  | 'garage'
  | 'mudroom'
  | 'gym'

export interface RoomDef {
  id: string
  name: string
  type: RoomType
  rect: Rect
  level?: string
  /** Rotated block whose local coordinates are used for rect. */
  frame?: string
  /** floor finish zone: 'floor' (palette wood) or 'tile' */
  floor?: 'wood' | 'tile' | 'concrete'
  /** furniture layout hints */
  furnish?: Record<string, unknown> & { bath?: 'vanity' | 'shower' | 'toilet' }
}

export interface Deck {
  id: string
  rect: Rect
  /** top of deck above grade */
  height: number
  boardsAlong: 'x' | 'z'
  /** sides with railing */
  rails?: Side[]
  railHeight?: number
  zone?: string
  supportY?: number
  spa?: Rect
}

export interface Porch {
  id: string
  rect: Rect
  /** Rotated block whose local coordinates are used for rect and posts. */
  frame?: string
  /** underside of the porch roof above grade */
  height: number
  posts: [number, number][]
  roofThickness?: number
  /** slope rises toward this side (small pitch) */
  rises?: Side
}

export interface Stair {
  id: string
  /** start (top landing edge center) in plan */
  from: [number, number]
  /** direction of descent */
  dir: Side
  width: number
  rise: number
  steps: number
  rails?: ('left' | 'right')[]
  /** Tread depth (defaults to 0.3 m). */
  going?: number
  /** An indoor stair's upper and lower floor. Rise must match their difference. */
  between?: { upper: string; lower: string }
}

export interface Terrace {
  id: string
  rect: Rect
  /** Rotated block whose local coordinates are used for rect. */
  frame?: string
  kind: 'pavers' | 'concrete' | 'gravel'
  /** top of the terrace above grade (raised terraces sit on a retained fill) */
  height?: number
  /** Base of the retaining edge where local ground is below grade. */
  supportY?: number
}

export interface CameraView {
  id: string
  label: string
  kind: 'orbit' | 'walk'
  /** camera position and look-at target (world, y up) */
  pos: [number, number, number]
  target: [number, number, number]
  fov?: number
  room?: string
}

export interface LandscapeSpec {
  /** rock garden berms: center, radii, height */
  berms?: { x: number; z: number; rx: number; rz: number; h: number; rot?: number; seed?: number }[]
  /** tree placements (pines) and a background ring */
  trees?: { x: number; z: number; s?: number; kind?: 'pine' | 'pine-small' | 'aspen' | 'bush' }[]
  forest?: { radius: number; count: number }
  fence?: [number, number][]
  driveway?: Rect[]
  paths?: { pts: [number, number][]; width: number }[]
  planters?: { x: number; z: number; kind: 'tall' | 'bowl' | 'low'; grass?: boolean }[]
  lounge?: { x: number; z: number; rot: number }[]
  dining?: { x: number; z: number; rot: number }[]
  /** keep these areas free of tall planting (sight lines to the terrace, paths) */
  clear?: Rect[]
  /** hillside lot (Pacific Palisades style): how the ground falls away from the house pad */
  site?: SiteSpec
}

/** Hillside lot. The house sits on a level pad at grade (y = 0); beyond it the ground falls toward `downhill`. */
export interface SiteSpec {
  /** compass bearing the lot falls toward, degrees (0 = +z / front, 90 = +x) */
  downhill: number
  /** average slope beyond the pad, rise over run (0.12 = 12%) */
  grade?: number
  /** the ground drops `drop` metres along this side of the house, exposing a walkout lower level */
  walkout?: { side: Side; drop: number }
  /** ocean in the downhill direction, this far away in metres (omit for no ocean) */
  oceanDistance?: number
}

export interface PlanFacts {
  area: number
  beds: number
  baths: number
  garage?: number
  stories: number
  width: number
  depth: number
  main?: number
  adu?: number
  lower?: number
  deck?: number
  total?: number
}

export interface FloorLevel {
  id: string
  label: string
  /** Finished floor offset from the main floor. The first level is the main floor. */
  offset: number
}

export interface HomePlan {
  id: string
  name: string
  style: string
  tagline: string
  facts: PlanFacts
  /** finished floor height above grade */
  floorY: number
  levels?: FloorLevel[]
  blocks: Block[]
  walls: InteriorWall[]
  openings: Opening[]
  rooms: RoomDef[]
  decks: Deck[]
  porches: Porch[]
  stairs: Stair[]
  terraces: Terrace[]
  landscape: LandscapeSpec
  views: CameraView[]
  /** default finish selections (zone -> option id) */
  finishes: Record<string, string>
  /** finish zones offered for this plan, in UI order */
  zones: string[]
  /** where the sun comes from for this plan's hero view (degrees, 0 = from +z/front, 90 = from +x) */
  sunAzimuth?: number
}
