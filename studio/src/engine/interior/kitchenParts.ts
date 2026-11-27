import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { MeshBatch } from '../geo'
import type { MaterialLibrary } from '../materials/library'

/**
 * Procedural kitchen pieces. Like the modern furniture kit, every builder returns a Group whose origin is the floor
 * centre of the piece (mounted pieces: the centre of their underside), fronts facing +z, one merged mesh per material.
 */

/** Black glass shared by the oven window and the induction hob. */
const darkGlass = new THREE.MeshStandardMaterial({ color: '#111316', roughness: 0.08, metalness: 0.2, name: 'kitchen-dark-glass' })
/** Grey print for the hob zones: fixtureMetal can be brass or black depending on the palette. */
const hobPrint = new THREE.MeshStandardMaterial({ color: '#5d6168', roughness: 0.4, name: 'kitchen-hob-print' })

/** Gap between neighbouring fronts; a black backer right behind the fronts makes it read as a dark shadow line. */
export const REVEAL = 0.003
export const TOE_H = 0.1
/** How far the toe kick sits back from the face of the fronts. */
export const TOE_SETBACK = 0.08
export const COUNTER_TOP = 0.92
export const ISLAND_TOP = 0.94
export const TALL_H = 2.3
export const TALL_W = 0.6
export const TALL_D = 0.66
export const SHELF_T = 0.03
/** LED profile depth under a shelf (the shelf's origin is the underside of the profile). */
export const SHELF_LED = 0.006
export const HOB = { w: 0.58, d: 0.5, t: 0.006 }
const COUNTER_T = 0.04
const BACKSPLASH_H = 0.58
const FRONT_T = 0.022
const BACKER_T = 0.003
/** Pull bar section and how far its stand-offs hold it off the front. */
const PULL_T = 0.012
const STANDOFF = 0.024
const WATERFALL_T = 0.04
/** Counter overhang on the island's seating side, so knees fit under it at the stools. */
const KNEE = 0.25
const FRONT_Y0 = TOE_H + REVEAL
const BASE_FRONT_H = COUNTER_TOP - COUNTER_T - REVEAL - FRONT_Y0
const ISLAND_FRONT_H = ISLAND_TOP - COUNTER_T - REVEAL - FRONT_Y0
const TALL_TOP = TALL_H - REVEAL
const FREEZER_H = 0.574
const OVEN_DRAWER_H = 0.474
export const OVEN_Y0 = FRONT_Y0 + OVEN_DRAWER_H + REVEAL
export const OVEN_H = 0.596

export interface Pull {
  x: number
  /** centre height */
  y: number
  length: number
  horizontal: boolean
}

/** One door or drawer front in its cabinet's local space (x along the width, y up from the floor). */
export interface Front {
  /** centre along the width */
  x: number
  /** bottom edge */
  y0: number
  w: number
  h: number
  kind: 'door' | 'drawer'
  /** bar pull; push-to-open fronts have none */
  pull?: Pull
}

/** Box spanning x ± w/2, y0..y0 + h and z0..z1 (either order), with optional soft edges. */
function box(b: MeshBatch, mat: THREE.Material, x: number, w: number, y0: number, h: number, z0: number, z1: number, r = 0, seg = 1) {
  const d = Math.abs(z1 - z0)
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)
  const geo = rr > 0 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d)
  geo.translate(x, y0 + h / 2, (z0 + z1) / 2)
  b.add(mat, geo)
}

function drawer(x: number, y0: number, w: number, h: number): Front {
  // every pull sits 7 cm below its drawer's top edge so a stack's pulls line up with the doors' rhythm
  const pull = { x, y: y0 + h - Math.min(h / 2, 0.07), length: THREE.MathUtils.clamp(w * 0.45, 0.16, 0.32), horizontal: true }
  return { x, y0, w, h, kind: 'drawer', pull }
}

/** Door with a vertical pull on its opening edge (`edge` -1 = left, 1 = right). */
function door(x: number, y0: number, w: number, h: number, edge: 1 | -1, tall = false): Front {
  const length = tall ? 0.32 : 0.24
  // base doors carry the pull at the top corner; a tall door keeps it at hand height near its bottom
  const y = tall ? y0 + 0.07 + length / 2 : y0 + h - 0.05 - length / 2
  return { x, y0, w, h, kind: 'door', pull: { x: x + edge * (w / 2 - 0.045), y, length, horizontal: false } }
}

/** A shallow cutlery drawer over two deep pan drawers, with reveals between them. */
export function drawerStack(x: number, w: number, y0: number, h: number): Front[] {
  const top = Math.min(0.2, (h - 2 * REVEAL) / 3)
  const deep = (h - top - 2 * REVEAL) / 2
  return [drawer(x, y0, w, deep), drawer(x, y0 + deep + REVEAL, w, deep), drawer(x, y0 + 2 * (deep + REVEAL), w, top)]
}

/**
 * Fronts of a base run `w` wide centred on x = 0, in ~0.6 m modules: a 3-drawer stack at the centre (under the hob)
 * and on every third module outward, so roughly one stack per 1.8 m, with pairs of doors in between whose pulls meet.
 */
export function baseFronts(w: number): Front[] {
  const n = Math.max(1, Math.round(w / 0.6))
  const mw = w / n
  const out: Front[] = []
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * mw
    // module offset from the centre; on an even run both middle modules count as the centre
    const off = i + 0.5 - n / 2
    const dist = Math.floor(Math.abs(off))
    if (dist % 3 === 0) {
      out.push(...drawerStack(x, mw - REVEAL, FRONT_Y0, BASE_FRONT_H))
    } else {
      const edge = ((dist % 3 === 1 ? 1 : -1) * Math.sign(off)) as 1 | -1
      out.push(door(x, FRONT_Y0, mw - REVEAL, BASE_FRONT_H, edge))
    }
  }
  return out
}

/** Island fronts `w` wide: drawer stacks all the way along. */
export function islandFronts(w: number): Front[] {
  const n = Math.max(1, Math.round(w / 0.6))
  const mw = w / n
  const out: Front[] = []
  for (let i = 0; i < n; i++) out.push(...drawerStack(-w / 2 + (i + 0.5) * mw, mw - REVEAL, FRONT_Y0, ISLAND_FRONT_H))
  return out
}

/** Integrated fridge: a tall door over a freezer drawer, the door's pull on its `edge` side. */
export function fridgeFronts(edge: 1 | -1 = -1): Front[] {
  const w = TALL_W - REVEAL
  const y1 = FRONT_Y0 + FREEZER_H + REVEAL
  return [drawer(0, FRONT_Y0, w, FREEZER_H), door(0, y1, w, TALL_TOP - y1, edge, true)]
}

/** Oak housing around a freestanding fridge, with a vent gap below the upper doors. */
export function fridgeSurround(lib: MaterialLibrary, h: number, w = 0.91, d = 0.78): THREE.Group {
  const b = new MeshBatch()
  const overhead = 1.84
  const jamb = 0.019
  for (const side of [-1, 1]) {
    box(b, lib.cabinet, side * (w - jamb) / 2, jamb, 0, h, -d / 2, d / 2, 0.002)
    box(b, lib.cabinet, side * w / 4, w / 2 - REVEAL, overhead + REVEAL, h - overhead - 2 * REVEAL,
      d / 2 - FRONT_T, d / 2, 0.002)
  }
  box(b, lib.cabinet, 0, w - 2 * jamb, overhead, h - overhead, -d / 2, d / 2 - FRONT_T - 0.003)
  return b.toGroup('fridge-surround')
}

/** Oven tower: a drawer under the oven and a handleless push-to-open door above it. */
export function ovenTowerFronts(): Front[] {
  const w = TALL_W - REVEAL
  const y1 = OVEN_Y0 + OVEN_H + REVEAL
  return [drawer(0, FRONT_Y0, w, OVEN_DRAWER_H), { x: 0, y0: y1, w, h: TALL_TOP - y1, kind: 'door' }]
}

/** Bar pull on two stand-offs, on a face at `frontZ` that points along `face`. */
function barPull(b: MeshBatch, mat: THREE.Material, p: Pull, frontZ: number, face: 1 | -1) {
  const w = p.horizontal ? p.length : PULL_T
  const h = p.horizontal ? PULL_T : p.length
  box(b, mat, p.x, w, p.y - h / 2, h, frontZ + face * STANDOFF, frontZ + face * (STANDOFF + PULL_T))
  for (const k of [-1, 1]) {
    const along = k * (p.length / 2 - 0.025)
    const x = p.x + (p.horizontal ? along : 0)
    const y = p.y + (p.horizontal ? 0 : along)
    box(b, mat, x, 0.01, y - 0.005, 0.01, frontZ, frontZ + face * STANDOFF)
  }
}

function addFronts(b: MeshBatch, lib: MaterialLibrary, fronts: Front[], frontZ: number, face: 1 | -1, finish = lib.cabinet) {
  for (const f of fronts) {
    box(b, finish, f.x, f.w, f.y0, f.h, frontZ, frontZ - face * FRONT_T, 0.002)
    if (f.pull) barPull(b, lib.blackMetal, f.pull, frontZ, face)
  }
}

/**
 * Cabinet body `w` wide from the floor to `top`, between `backZ` and the fronts whose outer face is at `frontZ`
 * (pointing along `face`): a black toe kick set back under the fronts, the carcass, and a thin black backer
 * directly behind the fronts that every reveal looks onto.
 */
function carcass(b: MeshBatch, lib: MaterialLibrary, w: number, top: number, backZ: number, frontZ: number, face: 1 | -1, backToe = 0, finish = lib.cabinet) {
  const inner = frontZ - face * FRONT_T
  box(b, lib.blackMetal, 0, w, 0, TOE_H, backZ + face * backToe, frontZ - face * TOE_SETBACK)
  box(b, finish, 0, w, TOE_H, top - TOE_H, backZ, inner - face * BACKER_T, 0.003)
  box(b, lib.blackMetal, 0, w - 0.002, TOE_H, top - TOE_H, inner - face * BACKER_T, inner)
}

/** Base run `w` wide and `d` deep (to the face of the fronts) with its stone top and upstand. */
export function baseCabinets(lib: MaterialLibrary, w: number, d = 0.62, backsplash = BACKSPLASH_H, finish = lib.cabinet): THREE.Group {
  const b = new MeshBatch()
  const frontZ = d / 2
  carcass(b, lib, w - 0.006, COUNTER_TOP - COUNTER_T, -d / 2, frontZ, 1, 0, finish)
  addFronts(b, lib, baseFronts(w), frontZ, 1, finish)
  // 40 mm top overhanging the fronts by 20 mm, and a slim upstand of the same stone up to the shelves
  box(b, lib.counter, 0, w, COUNTER_TOP - COUNTER_T, COUNTER_T, -d / 2, frontZ + 0.02, 0.004, 2)
  if (backsplash > 0) box(b, lib.counter, 0, w, COUNTER_TOP, backsplash, -d / 2, -d / 2 + 0.015, 0.002)
  return b.toGroup('kitchen-base')
}

/** A 30 mm floating oak shelf (its bracket is hidden in the slab) with a warm LED profile under the front edge. */
export function openShelf(lib: MaterialLibrary, w: number, d = 0.28, light = lib.lamp('strip', '#ffd9a8', 6)): THREE.Group {
  const b = new MeshBatch()
  box(b, light, 0, w - 0.06, 0, SHELF_LED, d / 2 - 0.045, d / 2 - 0.03)
  box(b, lib.cabinet, 0, w, SHELF_LED, SHELF_T, -d / 2, d / 2, 0.002)
  return b.toGroup('kitchen-shelf')
}

function tallCarcass(b: MeshBatch, lib: MaterialLibrary) {
  carcass(b, lib, TALL_W - 0.006, TALL_H, -TALL_D / 2, TALL_D / 2, 1)
}

/** Integrated fridge column: two flush fronts, a tall door over a freezer drawer. */
export function fridgeColumn(lib: MaterialLibrary, handleEdge: 1 | -1 = -1): THREE.Group {
  const b = new MeshBatch()
  tallCarcass(b, lib)
  addFronts(b, lib, fridgeFronts(handleEdge), TALL_D / 2, 1)
  return b.toGroup('kitchen-fridge')
}

/** Oven tower: drawer, built-in oven (black fascia, dark glass window, stainless handle and controls), push door. */
export function ovenTower(lib: MaterialLibrary): THREE.Group {
  const b = new MeshBatch()
  const frontZ = TALL_D / 2
  tallCarcass(b, lib)
  addFronts(b, lib, ovenTowerFronts(), frontZ, 1)
  // the oven stands 4 mm proud of the fronts
  const ow = TALL_W - REVEAL
  const oz = frontZ + 0.004
  box(b, lib.blackMetal, 0, ow, OVEN_Y0, OVEN_H, frontZ - FRONT_T, oz, 0.003)
  box(b, darkGlass, 0, 0.5, OVEN_Y0 + 0.07, 0.34, oz, oz + 0.004, 0.002)
  barPull(b, lib.fixtureMetal, { x: 0, y: OVEN_Y0 + 0.465, length: 0.46, horizontal: true }, oz, 1)
  // control strip along the top with a display and two knobs
  const sy = OVEN_Y0 + OVEN_H - 0.08
  box(b, lib.fixtureMetal, 0, ow - 0.02, sy, 0.07, oz, oz + 0.004, 0.002)
  box(b, darkGlass, 0, 0.12, sy + 0.022, 0.026, oz + 0.004, oz + 0.0065)
  for (const x of [-0.2, 0.2]) {
    const knob = new THREE.CylinderGeometry(0.016, 0.016, 0.016, 20)
    knob.rotateX(Math.PI / 2)
    knob.translate(x, sy + 0.035, oz + 0.012)
    b.add(lib.blackMetal, knob)
  }
  return b.toGroup('kitchen-oven')
}

/** Black glass induction hob with four printed zones and a touch slider; origin under the glass. */
export function inductionHob(): THREE.Group {
  const b = new MeshBatch()
  box(b, darkGlass, 0, HOB.w, 0, HOB.t, -HOB.d / 2, HOB.d / 2, 0.0015)
  for (const [x, z, r] of [[-0.14, -0.1, 0.09], [0.14, -0.1, 0.075], [-0.14, 0.12, 0.075], [0.14, 0.12, 0.09]]) {
    const ring = new THREE.RingGeometry(r - 0.003, r, 40)
    ring.rotateX(-Math.PI / 2)
    ring.translate(x, HOB.t + 0.001, z - 0.01)
    b.add(hobPrint, ring)
  }
  box(b, hobPrint, 0, 0.18, HOB.t, 0.001, HOB.d / 2 - 0.036, HOB.d / 2 - 0.03)
  return b.toGroup('kitchen-hob')
}

/**
 * Slim stainless canopy hood `w` wide with its chimney against the wall (-z); `h` is the overall height from the
 * underside of the canopy, so the chimney can run up to the ceiling.
 */
export function rangeHood(lib: MaterialLibrary, w = 0.9, h = 0.78, d = 0.54): THREE.Group {
  const b = new MeshBatch()
  const back = -d / 2
  box(b, lib.blackMetal, 0, w - 0.1, 0, 0.004, back + 0.04, d / 2 - 0.04)
  box(b, lib.fixtureMetal, 0, w, 0.004, 0.05, back, d / 2, 0.006)
  box(b, lib.fixtureMetal, 0, 0.32, 0.054, Math.max(0.05, h - 0.054), back, back + 0.26, 0.004)
  return b.toGroup('kitchen-hood')
}

/**
 * Island `w` x `d` with a waterfall counter. Its cabinet faces the run (-z) with drawer stacks; the stool side (+z)
 * keeps a knee-space overhang under the counter.
 */
export function kitchenIsland(lib: MaterialLibrary, w: number, d = 1, withSink = false, finish = lib.cabinet): THREE.Group {
  const b = new MeshBatch()
  const top = ISLAND_TOP - COUNTER_T
  const cw = w - 2 * WATERFALL_T
  const frontZ = -d / 2 + 0.03
  carcass(b, lib, cw, withSink ? top - 0.125 : top, d / 2 - KNEE, frontZ, -1, 0.05, finish)
  addFronts(b, lib, islandFronts(cw), frontZ, -1, finish)
  if (withSink) {
    // Cap the opening above the recessed carcass at the seating side.
    box(b, finish, 0, cw, top - 0.125, 0.125, d / 2 - KNEE - 0.019, d / 2 - KNEE)
    islandSink(b, lib, w, d, top)
  } else {
    box(b, lib.counter, 0, w, top, COUNTER_T, -d / 2, d / 2, 0.004, 2)
  }
  for (const s of [-1, 1]) box(b, lib.counter, s * (w / 2 - WATERFALL_T / 2), WATERFALL_T, 0, top, -d / 2, d / 2, 0.003)
  return b.toGroup('kitchen-island')
}

/** Counter slabs surround an opening with an inset stainless basin and deck-mounted tap. */
function islandSink(b: MeshBatch, lib: MaterialLibrary, w: number, d: number, top: number) {
  const x = -w * 0.2
  const left = x - 0.25
  const right = x + 0.25
  const back = -0.225
  const front = 0.12
  for (const [a, e] of [[-w / 2, left], [right, w / 2]]) {
    box(b, lib.counter, (a + e) / 2, e - a, top, COUNTER_T, -d / 2, d / 2)
  }
  box(b, lib.counter, x, right - left, top, COUNTER_T, -d / 2, back)
  box(b, lib.counter, x, right - left, top, COUNTER_T, front, d / 2)
  const bottom = top - 0.105
  const steel = lib.fixtureMetal
  box(b, steel, x, 0.5, bottom, 0.012, back, front, 0.005)
  box(b, steel, x, 0.5, bottom, 0.128, back, back + 0.009)
  box(b, steel, x, 0.5, bottom, 0.128, front - 0.009, front)
  for (const e of [left + 0.004, right - 0.004]) box(b, steel, e, 0.009, bottom, 0.128, back, front)
  const drain = new THREE.CylinderGeometry(0.028, 0.028, 0.004, 16)
  drain.translate(x, bottom + 0.013, -0.04)
  b.add(darkGlass, drain)
  const faucetZ = back - 0.078
  const base = new THREE.CylinderGeometry(0.027, 0.028, 0.032, 16)
  base.translate(x, ISLAND_TOP + 0.016, faucetZ)
  b.add(steel, base)
  const arc = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, ISLAND_TOP + 0.015, faucetZ),
    new THREE.Vector3(x, ISLAND_TOP + 0.24, faucetZ),
    new THREE.Vector3(x, ISLAND_TOP + 0.29, faucetZ + 0.09),
    new THREE.Vector3(x, ISLAND_TOP + 0.23, faucetZ + 0.17),
  ])
  b.add(steel, new THREE.TubeGeometry(arc, 14, 0.013, 8, false))
}
