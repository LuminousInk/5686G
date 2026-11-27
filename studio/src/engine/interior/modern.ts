import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { MaterialLibrary } from '../materials/library'
import { V3 } from '../geo'

const bookCloth = new THREE.MeshStandardMaterial({ color: '#6b7770', roughness: 0.85, name: 'book-cloth' })
const bookPaper = new THREE.MeshStandardMaterial({ color: '#d7cabb', roughness: 0.92, name: 'book-paper' })

export function decor<T extends THREE.Object3D>(object: T): T {
  object.userData.bakeIgnore = true
  return object
}

/**
 * Accumulates geometry per material in a piece's local space, then merges each material into a single mesh. Every
 * geometry is de-indexed first so RoundedBoxGeometry, BoxGeometry and CylinderGeometry can share one merge.
 */
export class Piece {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>()

  add(mat: THREE.Material, geo: THREE.BufferGeometry) {
    if (!geo.getAttribute('position') || geo.getAttribute('position').count === 0) return
    const g = geo.index ? geo.toNonIndexed() : geo
    let list = this.parts.get(mat)
    if (!list) this.parts.set(mat, (list = []))
    list.push(g)
  }

  /** Soft-edged box with its centre at (x, y, z). */
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, r: number, seg = 2) {
    const geo = new RoundedBoxGeometry(w, h, d, seg, r)
    geo.translate(x, y, z)
    this.add(mat, geo)
  }

  /** Sharp-edged slab for grooves, pulls and screens. */
  slab(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
    const geo = new THREE.BoxGeometry(w, h, d)
    geo.translate(x, y, z)
    this.add(mat, geo)
  }

  cylinder(mat: THREE.Material, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, open = false, seg = 24) {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open)
    geo.translate(x, y, z)
    this.add(mat, geo)
  }

  /** Slab specified from its bottom face, for casework and tile courses. */
  slabFromBase(mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
    this.slab(mat, w, h, d, x, y + h / 2, z)
  }

  /** Square-section leg running from `top` down to `bottom` (used for splayed legs). */
  leg(mat: THREE.Material, top: THREE.Vector3, bottom: THREE.Vector3, size: number) {
    const dir = V3(bottom.x - top.x, bottom.y - top.y, bottom.z - top.z)
    const len = dir.length()
    if (len < 1e-5) return
    const geo = new RoundedBoxGeometry(size, len, size, 2, Math.min(size / 2 - 1e-4, 0.008))
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.normalize()))
    geo.translate((top.x + bottom.x) / 2, (top.y + bottom.y) / 2, (top.z + bottom.z) / 2)
    this.add(mat, geo)
  }

  /** Soft-edged slab tilted back by `angle` (radians), anchored so its bottom-front edge centre lands on `p`. */
  tiltBack(mat: THREE.Material, w: number, h: number, t: number, p: THREE.Vector3, angle: number, r: number) {
    const geo = new RoundedBoxGeometry(w, h, t, 3, r)
    geo.rotateX(-angle) // top tips toward -z, front stays facing +z
    const halfH = h / 2
    const halfT = t / 2
    const dy = -halfH * Math.cos(angle) + halfT * Math.sin(angle)
    const dz = halfH * Math.sin(angle) + halfT * Math.cos(angle)
    geo.translate(p.x, p.y - dy, p.z - dz)
    this.add(mat, geo)
  }

  build(name: string): THREE.Group {
    const group = new THREE.Group()
    group.name = name
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false)
      if (!merged) continue
      merged.computeBoundingBox()
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
    return group
  }
}

/** Low oak platform bed with a fitted duvet and separately staged linens. */
export function platformBed(lib: MaterialLibrary, w: number, l: number, headHeight = 0.96, accent = lib.oliveLinen): THREE.Group {
  const p = new Piece()
  const pw = w + 0.1 // platform slightly overhangs the mattress
  const pl = l + 0.1
  const bedTop = 0.32
  p.box(lib.darkWood, pw - 0.16, 0.12, pl - 0.16, 0, 0.06, 0, 0.02)
  p.box(lib.cabinet, pw, 0.2, pl, 0, bedTop - 0.10, 0, 0.025)
  p.box(lib.linen, w, 0.23, l, 0, bedTop + 0.115, 0, 0.045)
  const headZ = -pl / 2 - 0.04
  p.box(lib.cabinet, pw, headHeight, 0.08, 0, headHeight / 2, headZ, 0.026)
  p.box(lib.fabric, pw - 0.10, headHeight - 0.37, 0.045, 0, (headHeight + 0.29) / 2, headZ + 0.055, 0.02)
  p.add(lib.linen, bedcover(w - 0.096, -l * 0.28, l * 0.50 + 0.036, 0.575, 0.19, 0.17))
  const linens = new Piece()
  const throwWidth = w - 0.083
  const runner = bedcover(throwWidth, l * 0.14, l * 0.43, 0.603, 0.20, 0)
  runner.rotateY(0.014)
  linens.add(lib.throwLinen, runner)
  const heel = bedcover(throwWidth, l * 0.156, l * 0.188, 0.606, 0.20, 0)
  heel.rotateY(0.014)
  linens.add(accent, heel)
  for (const side of [-1, 1]) {
    const x = side * w * 0.238
    const pillowHeight = Math.max(0.13, Math.min(0.39, headHeight - 0.56))
    linens.tiltBack(lib.linen, w * 0.44, pillowHeight, 0.135, V3(x, 0.548, -l / 2 + 0.265), 0.27, 0.052)
    linens.tiltBack(lib.fabric2, w * 0.36, pillowHeight * 0.82, 0.125, V3(x * 0.98, 0.555, -l / 2 + 0.39), 0.34, 0.048)
    linens.tiltBack(accent, w * 0.23, pillowHeight * 0.65, 0.105, V3(x * 0.73, 0.567, -l / 2 + 0.50), 0.37, 0.038)
  }
  const bed = p.build('platformBed')
  bed.add(decor(linens.build('bed-throws-and-pillows')))
  return bed
}

/** Fabric rolls down the sides and foot while broad folds continue across the mattress. */
function bedcover(width: number, head: number, foot: number, top: number, sideDrop: number, footDrop: number) {
  const geo = new THREE.PlaneGeometry(1, 1, 24, 12)
  const position = geo.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const u = position.getX(i) * 2
    const v = 0.5 - position.getY(i)
    const side = Math.max(0, (Math.abs(u) - 0.80) / 0.20)
    const end = footDrop ? Math.max(0, (v - 0.85) / 0.15) : 0
    const roll = side * Math.PI / 2
    const hem = end * Math.PI / 2
    const inner = width / 2 - 0.018
    const fold = Math.sin(u * 23 + v * 3) + 0.45 * Math.sin(u * 39 - v * 8)
    const x = u * inner / Math.max(0.80, Math.abs(u)) + Math.sign(u) * 0.086 * Math.sin(roll)
    const z = footDrop
      ? head + Math.min(v / 0.85, 1) * (foot - head - 0.082) + 0.082 * Math.sin(hem)
      : THREE.MathUtils.lerp(head, foot, v)
    const y = top - Math.max((1 - Math.cos(roll)) * sideDrop, (1 - Math.cos(hem)) * footDrop)
    position.setXYZ(i, x + side * 0.008 * Math.sin(v * 18), y + fold * (0.005 + 0.009 * side), z)
  }
  geo.computeVertexNormals()
  return geo
}

export function linenBench(lib: MaterialLibrary, width: number) {
  const p = new Piece()
  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) {
    for (const z of [-0.15, 0.15]) p.leg(lib.cabinet, V3(x, 0.35, z), V3(x * 1.04, 0, z * 1.15), 0.035)
  }
  p.box(lib.cabinet, width, 0.06, 0.42, 0, 0.33, 0, 0.014)
  p.box(lib.fabric, width - 0.028, 0.095, 0.397, 0, 0.399, 0, 0.033)
  return p.build('linen-bench')
}

export function nightstand(lib: MaterialLibrary, w = 0.48, withLamp: boolean | null = true): THREE.Group {
  const p = new Piece()
  const d = 0.4
  const h = 0.46
  const legH = 0.12
  p.box(lib.cabinet, w, h, d, 0, legH + h / 2, 0, 0.015)
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    p.box(lib.blackMetal, 0.03, legH, 0.03, sx * (w / 2 - 0.03), legH / 2, sz * (d / 2 - 0.03), 0.008)
  // single drawer: a 3 mm groove line and a slim pull, both on the +z face
  const faceZ = d / 2 + 0.001
  p.slab(lib.blackMetal, w - 0.06, 0.003, 0.003, 0, legH + h - 0.05, faceZ)
  p.slab(lib.blackMetal, 0.12, 0.008, 0.008, 0, legH + h / 2 - 0.1, faceZ + 0.002)
  const g = p.build('nightstand')
  if (withLamp === null) return g
  const accessory = withLamp ? tableLamp(lib) : bookStack(lib)
  accessory.position.y = legH + h
  g.add(accessory)
  return g
}

export function tableLamp(lib: MaterialLibrary): THREE.Group {
  const p = new Piece()
  // tapered ceramic base
  p.cylinder(lib.bathStone, 0.066, 0.09, 0.245, 0, 0.1225, 0)
  p.cylinder(lib.fixtureMetal, 0.012, 0.012, 0.085, 0, 0.301, 0)
  p.cylinder(lib.linenShade, 0.104, 0.14, 0.18, 0, 0.382, 0, true, 20)
  p.cylinder(lib.diffuser, 0.101, 0.101, 0.006, 0, 0.437, 0, false, 16)
  return decor(p.build('tableLamp'))
}

export function floorLamp(lib: MaterialLibrary): THREE.Group {
  const p = new Piece()
  p.cylinder(lib.blackMetal, 0.15, 0.16, 0.02, 0, 0.01, 0)
  p.cylinder(lib.blackMetal, 0.01, 0.01, 1.55, 0, 0.02 + 1.55 / 2, 0, false, 16)
  p.cylinder(lib.linenShade, 0.16, 0.20, 0.2, 0, 0.02 + 1.55 + 0.1, 0, true, 20)
  return decor(p.build('floorLamp'))
}

export function diningTable(lib: MaterialLibrary, w: number, d: number): THREE.Group {
  const p = new Piece()
  const topY = 0.75
  p.box(lib.cabinet, w, 0.04, d, 0, topY - 0.02, 0, 0.006)
  for (const k of [-1, 1]) {
    p.box(lib.cabinet, w - 0.18, 0.057, 0.032, 0, topY - 0.066, k * (d / 2 - 0.099), 0.003)
  }
  const lx = w / 2 - 0.08 - 0.0225
  const lz = d / 2 - 0.08 - 0.0225
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    p.box(lib.cabinet, 0.045, topY - 0.04, 0.045, sx * lx, (topY - 0.04) / 2, sz * lz, 0.008)
  return p.build('diningTable')
}

export function diningChair(lib: MaterialLibrary): THREE.Group {
  const p = new Piece()
  const seatTop = 0.46
  const lean = (8 * Math.PI) / 180
  p.box(lib.cabinet, 0.45, 0.02, 0.45, 0, 0.39, 0, 0.006)
  p.box(lib.fabric2, 0.45, 0.06, 0.45, 0, seatTop - 0.03, 0, 0.02)
  // rounded back slab, tilted back so its top lands at 0.82
  p.tiltBack(lib.cabinet, 0.42, 0.3, 0.04, V3(0, 0.82 - 0.3 * Math.cos(lean), -0.2), lean, 0.02)
  const a = 0.18 // leg top inset from the centre
  const splay = Math.tan((3 * Math.PI) / 180) * 0.38
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    p.leg(lib.cabinet, V3(sx * a, 0.38, sz * a), V3(sx * (a + splay), 0, sz * (a + splay)), 0.03)
  return p.build('diningChair')
}

export function barStool(lib: MaterialLibrary): THREE.Group {
  const p = new Piece()
  const seatTop = 0.65
  p.cylinder(lib.cabinet, 0.2, 0.2, 0.04, 0, seatTop - 0.02, 0)
  p.cylinder(lib.blackMetal, 0.14, 0.14, 0.02, 0, 0.25, 0, true)
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    p.leg(lib.blackMetal, V3(Math.cos(a) * 0.14, seatTop - 0.04, Math.sin(a) * 0.14), V3(Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14), 0.03)
  }
  return p.build('barStool')
}

export function bookStack(lib: MaterialLibrary, cloth = bookCloth, paper = bookPaper): THREE.Group {
  const p = new Piece()
  for (const [i, w, d, x] of [[0, 0.22, 0.155, 0], [1, 0.185, 0.13, 0.018]]) {
    const y = i * 0.028
    const cover = i === 0 ? lib.darkWood : cloth
    p.box(cover, w, 0.003, d, x, y + 0.0015, 0, 0.001)
    p.slab(paper, w - 0.006, 0.022, d - 0.004, x, y + 0.014, 0)
    p.slab(cover, 0.004, 0.022, d, x - w / 2 + 0.002, y + 0.014, 0)
    p.box(cover, w, 0.003, d, x, y + 0.0265, 0, 0.001)
  }
  return decor(p.build('books'))
}

export function bench(lib: MaterialLibrary, w: number, d: number): THREE.Group {
  const p = new Piece()
  p.box(lib.cabinet, w, 0.046, d, 0, 0.419, 0, 0.012)
  for (const k of [-1, 1]) {
    p.box(lib.darkWood, 0.053, 0.396, d - 0.065, k * (w / 2 - 0.098), 0.198, 0, 0.009)
  }
  p.box(lib.fabric2, w * 0.56, 0.046, d - 0.06, -w * 0.12, 0.465, 0, 0.022)
  return p.build('entryBench')
}

export function towelRail(lib: MaterialLibrary, w: number): THREE.Group {
  const p = new Piece()
  for (const k of [-1, 1]) {
    p.box(lib.fixtureMetal, 0.028, 0.028, 0.074, k * (w / 2 - 0.018), 0, 0, 0.004)
  }
  p.box(lib.fixtureMetal, w, 0.014, 0.014, 0, 0, 0.033, 0.006)
  const towelW = w * 0.76
  p.box(lib.fabric2, towelW, 0.35, 0.016, 0, -0.161, 0.041, 0.006)
  p.box(lib.fabric2, towelW, 0.29, 0.014, 0, -0.129, 0.057, 0.006)
  p.box(lib.fabric, towelW - 0.013, 0.021, 0.003, 0, -0.24, 0.065, 0.001)
  return decor(p.build('towelRail'))
}

export function sideboard(lib: MaterialLibrary, w: number): THREE.Group {
  const p = new Piece()
  const d = 0.45
  const h = 0.72
  const legH = 0.12
  p.box(lib.cabinet, w, h, d, 0, legH + h / 2, 0, 0.015)
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    p.box(lib.blackMetal, 0.03, legH, 0.03, sx * (w / 2 - 0.03), legH / 2, sz * (d / 2 - 0.03), 0.008)
  const doors = w >= 2.0 ? 4 : 3
  const dw = w / doors
  for (let i = 1; i < doors; i++)
    p.slab(lib.blackMetal, 0.003, h, 0.003, -w / 2 + i * dw, legH + h / 2, d / 2 + 0.002)
  return p.build('sideboard')
}

export function mediaConsole(lib: MaterialLibrary, w: number): THREE.Group {
  const p = new Piece()
  const d = 0.42
  const h = 0.5
  const legH = 0.12
  p.box(lib.cabinet, w, h, d, 0, legH + h / 2, 0, 0.015)
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    p.box(lib.blackMetal, 0.03, legH, 0.03, sx * (w / 2 - 0.03), legH / 2, sz * (d / 2 - 0.03), 0.008)
  const doors = w >= 2.0 ? 4 : 3
  const dw = w / doors
  for (let i = 1; i < doors; i++)
    p.slab(lib.blackMetal, 0.003, h, 0.003, -w / 2 + i * dw, legH + h / 2, d / 2 + 0.002)
  const g = p.build('mediaConsole')
  const t = tv(lib, Math.min(1.58, w * 0.99))
  t.position.y = legH + h
  g.add(t)
  return g
}

export function tv(lib: MaterialLibrary, diag = 1.4): THREE.Group {
  const p = new Piece()
  const w = diag * (16 / Math.hypot(16, 9))
  const h = diag * (9 / Math.hypot(16, 9))
  // The pedestal sits flat on the console top, with a short stem under the screen.
  p.box(lib.tvCase, w * 0.38, 0.014, 0.19, 0, 0.007, 0, 0.005)
  p.slab(lib.tvCase, 0.09, 0.064, 0.032, 0, 0.044, 0)
  p.box(lib.tvCase, w, h, 0.03, 0, h / 2 + 0.07, 0, 0.006)
  p.slab(lib.tvGlass, w - 0.016, h - 0.016, 0.004, 0, h / 2 + 0.07, 0.016)
  return p.build('tv')
}

export function wardrobe(lib: MaterialLibrary, w: number, d = 0.6): THREE.Group {
  const p = new Piece()
  const h = 2.2
  const plinthH = 0.08
  p.box(lib.darkWood, w - 0.1, plinthH, d - 0.1, 0, plinthH / 2, 0, 0.01)
  p.box(lib.cabinet, w, h, d, 0, plinthH + h / 2, 0, 0.02)
  const doors = Math.max(2, Math.round(w / 0.5))
  const dw = w / doors
  for (let i = 1; i < doors; i++)
    p.slab(lib.blackMetal, 0.003, h, 0.003, -w / 2 + i * dw, plinthH + h / 2, d / 2 + 0.002)
  for (let i = 0; i < doors; i++)
    p.slab(lib.blackMetal, 0.02, 0.6, 0.008, -w / 2 + (i + 0.5) * dw, plinthH + 1.2, d / 2 + 0.006)
  return p.build('wardrobe')
}

export function modernSofa(lib: MaterialLibrary, w: number): THREE.Group {
  const p = new Piece()
  const D = 0.95
  const armW = 0.18
  const seatTop = 0.42
  const backTop = 0.75
  const innerW = w - armW * 2
  p.box(lib.darkWood, w - 0.1, 0.1, D - 0.1, 0, 0.05, 0, 0.01)
  p.box(lib.fabric2, w, 0.2, D, 0, 0.2, 0, 0.02)
  // low upholstered back panel behind the back cushions
  p.box(lib.fabric2, innerW, backTop - seatTop, 0.18, 0, seatTop + (backTop - seatTop) / 2, -D / 2 + 0.09, 0.02)
  for (const sx of [-1, 1])
    p.box(lib.fabric2, armW, 0.12, D, sx * (w / 2 - armW / 2), 0.36, 0, 0.02)
  const n = w >= 2.2 ? 3 : 2
  const gap = 0.015
  const cw = (innerW - gap * (n - 1)) / n
  const lean = (10 * Math.PI) / 180
  for (let i = 0; i < n; i++) {
    const x = -innerW / 2 + cw / 2 + i * (cw + gap)
    p.box(lib.fabric2, cw, 0.12, 0.6, x, 0.36, 0.165, 0.04, 3)
    p.tiltBack(lib.fabric2, cw, (backTop - seatTop) / Math.cos(lean), 0.16, V3(x, seatTop, -0.14), lean, 0.03)
  }
  return p.build('modernSofa')
}

export function areaRug(lib: MaterialLibrary, w: number, d: number): THREE.Group {
  const p = new Piece()
  p.box(lib.rug, w, 0.012, d, 0, 0.006, 0, 0.006)
  return p.build('areaRug')
}

/** Nominal footprints (w, d in metres) for layout, using the default sizes for parameterised pieces. */
export const FURNITURE_FOOTPRINTS: Record<string, { w: number; d: number }> = {
  platformBed: { w: 1.7, d: 2.1 },
  nightstand: { w: 0.48, d: 0.4 },
  tableLamp: { w: 0.32, d: 0.32 },
  floorLamp: { w: 0.3, d: 0.3 },
  diningTable: { w: 1.8, d: 0.913 },
  diningChair: { w: 0.526, d: 0.506 },
  barStool: { w: 0.384, d: 0.384 },
  sideboard: { w: 1.8, d: 0.6 },
  mediaConsole: { w: 1.8, d: 0.42 },
  tv: { w: 1.22, d: 0.03 },
  wardrobe: { w: 2.0, d: 0.6 },
  modernSofa: { w: 2.2, d: 0.95 },
  areaRug: { w: 2.4, d: 1.6 },
}
