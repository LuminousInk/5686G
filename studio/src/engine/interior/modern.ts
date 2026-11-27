import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { MaterialLibrary } from '../materials/library'
import { V3 } from '../geo'

/** Glossy TV screen, shared by every tv() so it is created once. */
const screenMaterial = new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.12, metalness: 0 })

/**
 * Accumulates geometry per material in a piece's local space, then merges each material into a single mesh. Every
 * geometry is de-indexed first so RoundedBoxGeometry, BoxGeometry and CylinderGeometry can share one merge.
 */
class Piece {
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

/** Low oak platform bed: floating plinth, mattress, folded duvet, pillows and an upholstered headboard. */
export function platformBed(lib: MaterialLibrary, w: number, l: number): THREE.Group {
  const p = new Piece()
  const pw = w + 0.1 // platform slightly overhangs the mattress
  const pl = l + 0.1
  const bedTop = 0.38 // top of the oak platform, mattress starts here
  // recessed dark plinth so the platform reads as floating
  p.box(lib.darkWood, pw - 0.16, 0.1, pl - 0.16, 0, 0.05, 0, 0.02)
  p.box(lib.cabinet, pw, 0.28, pl, 0, bedTop - 0.14, 0, 0.02)
  p.box(lib.fabric, w, 0.22, l, 0, bedTop + 0.11, 0, 0.03)
  // duvet folded back at the foot third (+z), covering the head two-thirds
  p.box(lib.fabric2, w + 0.08, 0.06, (l * 2) / 3, 0, bedTop + 0.25, -l / 6, 0.02)
  // two pillows per 0.9 m of width, leaning against the headboard
  const n = Math.max(2, Math.round((2 * w) / 0.9))
  const gap = 0.04
  const pillW = (w - 0.1 - gap * (n - 1)) / n
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.05 + pillW / 2 + i * (pillW + gap)
    p.tiltBack(lib.fabric, pillW, 0.16, 0.42, V3(x, bedTop + 0.22, -l / 2 + 0.4), 0.3, 0.04)
  }
  // upholstered headboard spans the bed width + 0.1, flush with the platform back
  p.box(lib.fabric2, pw, 1.05, 0.08, 0, 0.525, -pl / 2 - 0.04, 0.03)
  return p.build('platformBed')
}

export function nightstand(lib: MaterialLibrary): THREE.Group {
  const p = new Piece()
  const w = 0.48
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
  const lamp = tableLamp(lib)
  lamp.position.y = legH + h
  g.add(lamp)
  return g
}

export function tableLamp(lib: MaterialLibrary): THREE.Group {
  const p = new Piece()
  // tapered ceramic base
  p.cylinder(lib.porcelain, 0.07, 0.12, 0.28, 0, 0.14, 0)
  // open drum shade
  p.cylinder(lib.lamp('shade', '#ffe2b8', 4), 0.16, 0.16, 0.2, 0, 0.38, 0, true)
  return p.build('tableLamp')
}

export function floorLamp(lib: MaterialLibrary): THREE.Group {
  const p = new Piece()
  p.cylinder(lib.blackMetal, 0.15, 0.16, 0.02, 0, 0.01, 0)
  p.cylinder(lib.blackMetal, 0.01, 0.01, 1.55, 0, 0.02 + 1.55 / 2, 0, false, 16)
  p.cylinder(lib.lamp('shade', '#ffe2b8', 4), 0.22, 0.22, 0.2, 0, 0.02 + 1.55 + 0.1, 0, true)
  return p.build('floorLamp')
}

export function diningTable(lib: MaterialLibrary, w: number, d: number): THREE.Group {
  const p = new Piece()
  const topY = 0.75
  p.box(lib.cabinet, w, 0.04, d, 0, topY - 0.02, 0, 0.006)
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
  const t = tv(lib)
  t.position.y = legH + h
  g.add(t)
  return g
}

export function tv(lib: MaterialLibrary, diag = 1.4): THREE.Group {
  const p = new Piece()
  const w = diag * (16 / Math.hypot(16, 9))
  const h = diag * (9 / Math.hypot(16, 9))
  // thin black body with an 8 mm bezel; the screen sits just proud of its front face
  p.box(lib.blackMetal, w, h, 0.03, 0, h / 2, 0, 0.006)
  p.slab(screenMaterial, w - 0.016, h - 0.016, 0.004, 0, h / 2, 0.016)
  return p.build('tv')
}

export function wardrobe(lib: MaterialLibrary, w: number): THREE.Group {
  const p = new Piece()
  const d = 0.6
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
