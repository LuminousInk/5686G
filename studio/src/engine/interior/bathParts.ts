import * as THREE from 'three'
import { V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { plumbingArc } from './catalogFixtures'
import { Piece } from './modern'

export function stoneWall(lib: MaterialLibrary, width: number, height: number, bottom = 0) {
  const p = new Piece()
  const columns = Math.ceil(width / 0.75)
  const rows = Math.ceil(height / 0.59)
  const w = width / columns
  const h = height / rows
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      p.slabFromBase(lib.bathStone, (i + 0.5) * w - width / 2, bottom + j * h, 0.006, w - 0.003, h - 0.003, 0.014)
    }
  }
  return p.build('large-format-limestone')
}

export function oakSlats(lib: MaterialLibrary, width: number, height: number) {
  const p = new Piece()
  p.slabFromBase(lib.darkWood, 0, 0, 0.009, width, height, 0.016)
  const count = Math.ceil(width / 0.059)
  const pitch = width / count
  for (let i = 0; i < count; i++) {
    p.slabFromBase(i % 5 === 0 ? lib.darkWood : lib.cabinet, (i + 0.5) * pitch - width / 2, 0, 0.025, pitch * 0.74, height, 0.027)
  }
  return p.build('vertical-oak-slats')
}

function roundPanel(w: number, h: number, r: number) {
  const x = w / 2
  const y = h / 2
  return new THREE.Shape()
    .moveTo(-x + r, -y).lineTo(x - r, -y).quadraticCurveTo(x, -y, x, -y + r)
    .lineTo(x, y - r).quadraticCurveTo(x, y, x - r, y)
    .lineTo(-x + r, y).quadraticCurveTo(-x, y, -x, y - r)
    .lineTo(-x, -y + r).quadraticCurveTo(-x, -y, -x + r, -y)
}

export function vanity(lib: MaterialLibrary, w: number, d: number, green: boolean, metal: THREE.Material) {
  const p = new Piece()
  const centers = w >= 1.43 ? [-w * 0.25, w * 0.25] : [0]
  const depth = d / 0.508
  const front = green ? lib.sageVanity : lib.cabinet
  // A rear wall rail holds the cabinet above the floor.
  p.slabFromBase(lib.darkWood, 0, 0.39, 0.026, w - 0.05, 0.22, 0.049)
  p.slabFromBase(lib.cabinet, 0, 0.29, 0.223 * depth, w - 0.024, 0.53, 0.44 * depth)
  p.slabFromBase(lib.diffuser, 0, 0.282, 0.282 * depth, w - 0.11, 0.008, 0.02)
  const bay = w / centers.length
  for (const x of centers) {
    for (const [y, h] of [[0.292, 0.23], [0.529, 0.275]]) {
      p.slabFromBase(front, x, y, 0.461 * depth, bay - 0.005, h, 0.032 * depth)
      p.slabFromBase(metal, x, y + h - 0.031, 0.483 * depth, Math.min(bay * 0.38, 0.24), 0.008, 0.011)
    }
  }
  p.slabFromBase(lib.counter, 0, 0.818, d / 2, w, 0.045, d)
  p.slabFromBase(lib.counter, 0, 0.863, 0.034, w, 0.085, 0.048)
  const g = p.build('floating-vanity')
  for (const x of centers) {
    const sinkWidth = Math.min(bay * 0.71, 0.52)
    const vesselProfile = [[0, 0], [0.76, 0], [0.95, 0.041], [1, 0.078], [0.96, 0.082], [0.85, 0.053], [0.68, 0.021], [0, 0.013]]
    const vessel = new THREE.Mesh(new THREE.LatheGeometry(vesselProfile.map(([r, y]) => new THREE.Vector2(r, y)), 32).scale(sinkWidth / 2, 1, 0.151 * depth), lib.porcelain)
    vessel.position.set(x, 0.864, 0.293 * depth)
    vessel.castShadow = vessel.receiveShadow = true
    g.add(vessel)
    const tap = plumbingArc(lib, 0.167, 0.155 * depth, metal)
    tap.position.set(x, 0.862, 0.11 * depth)
    g.add(tap)
    const mirrorW = Math.min(bay * 0.80, 0.76)
    for (const [inset, mat] of [[0, metal], [0.026, lib.mirror]] as const) {
      const mirror = new THREE.Mesh(new THREE.ShapeGeometry(roundPanel(mirrorW - inset, 0.80 - inset, 0.09), 8), mat)
      mirror.name = inset ? 'vanity-mirror' : 'vanity-mirror-frame'
      mirror.position.set(x, 1.51, inset ? 0.043 : 0.04)
      g.add(mirror)
    }
  }
  const sconces = new Piece()
  const offsets = centers.length === 2 ? [-w * 0.47, 0, w * 0.47] : [-w * 0.44, w * 0.44]
  for (const x of offsets) {
    sconces.box(metal, 0.045, 0.44, 0.035, x, 1.53, 0.055, 0.009)
    sconces.box(lib.diffuser, 0.024, 0.365, 0.029, x, 1.54, 0.079, 0.012)
  }
  g.add(sconces.build('vanity-sconces'))
  return g
}

export function showerOpening(width: number) {
  return Math.min(width - 0.24, 0.60)
}

/** The origin sits at the rear wall, with the entrance opposite it. */
export function shower(lib: MaterialLibrary, width: number, depth: number, metal: THREE.Material, screenSide: number, wallHeight: number) {
  const p = new Piece()
  const opening = showerOpening(width)
  const glassW = width - opening
  const glassX = screenSide * opening / 2
  const x = screenSide * (width / 2 - 0.013)
  const glassHeight = Math.min(1.99, wallHeight - 0.075)
  const headY = Math.min(2.10, wallHeight - 0.04)
  const frontZ = depth - 0.013
  p.slabFromBase(lib.bathStone, 0, 0, depth / 2, width, 0.032, depth)
  p.slabFromBase(metal, 0, 0.042, depth * 0.33, 0.23, 0.005, 0.038)
  p.slabFromBase(metal, glassX, 0.033, frontZ, glassW, 0.024, 0.023)
  p.slabFromBase(metal, x, 0.033, 0.026, 0.019, glassHeight, 0.025)
  p.slabFromBase(metal, x, 0.033, frontZ, 0.019, glassHeight, 0.023)
  p.slabFromBase(metal, 0, headY, 0.30, 0.024, 0.020, 0.58)
  p.slabFromBase(metal, 0, headY - 0.014, 0.54, 0.21, 0.017, 0.16)
  p.slabFromBase(metal, 0, 1.06, 0.025, 0.12, 0.11, 0.04)
  p.slabFromBase(lib.bathStone, -width * 0.27, 1.25, 0.086, 0.25, 0.027, 0.16)
  const g = p.build('walk-in-shower')
  const panels = [
    new THREE.Mesh(new THREE.PlaneGeometry(glassW, glassHeight), lib.showerGlass),
    new THREE.Mesh(new THREE.PlaneGeometry(frontZ - 0.025, glassHeight), lib.showerGlass),
  ]
  panels[0].name = 'shower-screen'
  panels[0].position.set(glassX, glassHeight / 2 + 0.033, frontZ)
  panels[1].position.set(x, glassHeight / 2 + 0.033, (frontZ + 0.025) / 2)
  panels[1].rotation.y = Math.PI / 2
  g.add(...panels)
  const wall = stoneWall(lib, width, wallHeight - 0.02, 0.02)
  g.add(wall)
  const handShower = new Piece()
  const hose = new THREE.CatmullRomCurve3([V3(0.04, 1.10, 0.08), V3(0.06, 0.82, 0.08), V3(0.17, 0.77, 0.09), V3(0.24, 1.30, 0.08)])
  handShower.add(metal, new THREE.TubeGeometry(hose, 20, 0.005, 6, false))
  handShower.cylinder(metal, 0.016, 0.01, 0.13, 0.24, 1.364, 0.08, false, 12)
  g.add(handShower.build('hand-shower'))
  return g
}
