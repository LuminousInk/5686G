import * as THREE from 'three'
import { V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import { bookStack, decor, Piece } from './modern'

/** Open eucalyptus branches for tabletop arrangements, independent of the vessel mesh. */
export function eucalyptus(lib: MaterialLibrary, size: number) {
  const p = new Piece()
  const leaf = new THREE.Shape().moveTo(0, 0).quadraticCurveTo(0.028, 0.022, 0.019, 0.047)
    .quadraticCurveTo(0.007, 0.061, 0, 0.062).quadraticCurveTo(-0.023, 0.054, -0.019, 0.035)
    .quadraticCurveTo(-0.015, 0.014, 0, 0)
  const random = rng(384)
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.4
    const h = size * (0.67 + random() * 0.33)
    const spread = size * (0.28 + random() * 0.31)
    const end = V3(Math.sin(angle) * spread, h, Math.cos(angle) * spread)
    const stem = new THREE.QuadraticBezierCurve3(V3(0, -0.055, 0), V3(end.x * 0.22, h * 0.46, end.z * 0.22), end)
    p.add(lib.foliageStem, new THREE.TubeGeometry(stem, 9, 0.0026, 5, false))
    for (let j = 0; j < 8; j++) {
      const point = stem.getPoint(0.37 + j * 0.085)
      const geo = new THREE.ShapeGeometry(leaf, 3)
      const scale = (0.56 + random() * 0.65) * (0.78 + size * 0.45)
      geo.scale(scale, scale, scale)
      geo.rotateZ((j % 2 ? -1 : 1) * (0.8 + random() * 0.69)).rotateY(angle + random()).translate(point.x, point.y, point.z)
      p.add(lib.foliage, geo)
    }
  }
  const g = decor(p.build('eucalyptus-branches'))
  for (const mesh of g.children as THREE.Mesh[]) mesh.castShadow = false
  return g
}

export function sofaTextiles(lib: MaterialLibrary, width: number, depth: number, lounge: boolean, seat: number,
  back: { height: number; crest: number }) {
  const p = new Piece()
  const z = lounge ? depth * 0.045 : -depth * 0.18
  p.tiltBack(lib.oliveLinen, 0.37, 0.36, 0.15, V3(-width * 0.34, seat, z), 0.32, 0.07)
  p.tiltBack(lib.linen, 0.36, 0.30, 0.16, V3(-width * 0.19, seat, z + 0.063), 0.34, 0.077)
  p.tiltBack(lib.rustLinen, 0.33, 0.31, 0.16, V3(width * (lounge ? 0.14 : 0.29), seat, z + 0.044), 0.41, 0.074)

  // A throw hangs over a seat back along its measured ridge. Folds follow the cloth over the edge.
  const edge = -depth / 2 - 0.018
  const { height, crest } = back
  const spine = new THREE.CatmullRomCurve3([
    V3(0, height - 0.345, edge + 0.002), V3(-0.015, height - 0.07, edge),
    V3(-0.01, height + 0.013, crest - 0.026), V3(0.006, height + 0.015, crest + 0.052),
    V3(0.024, height - 0.16, Math.max(crest + 0.12, z - 0.025)),
  ], false, 'centripetal')
  const strip = (a: number, b: number) => {
    const cloth = new THREE.PlaneGeometry(1, 1, 18, Math.max(1, Math.round((b - a) * 20)))
    const positions = cloth.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      const u = positions.getX(i)
      const v = THREE.MathUtils.lerp(a, b, 0.5 - positions.getY(i))
      const q = spine.getPoint(v)
      const wave = Math.sin(u * 26 + v * 2) * 0.009 + Math.sin(u * 49 - v * 3) * 0.004
      positions.setXYZ(i, q.x + width * 0.27 + u * 0.43, q.y + wave * 0.55, q.z + wave)
    }
    cloth.computeVertexNormals()
    return cloth
  }
  p.add(lib.fabric2, strip(0, 0.04))
  p.add(lib.throwLinen, strip(0.04, 1))
  return decor(p.build('sofa-throw-and-pillows'))
}

export function kitchenCounterDecor(lib: MaterialLibrary, width: number) {
  const p = new Piece()
  const boardW = Math.min(0.34, width * 0.72)
  p.box(lib.cabinet, boardW, 0.022, 0.31, 0, 0.011, 0, 0.011, 1)
  p.box(lib.darkWood, 0.087, 0.019, 0.067, -0.032, 0.010, -0.171, 0.009, 1)
  p.cylinder(lib.decorAmber, 0.038, 0.040, 0.125, -boardW * 0.25, 0.084, -0.028, false, 14)
  p.cylinder(lib.fixtureMetal, 0.027, 0.027, 0.023, -boardW * 0.25, 0.156, -0.028, false, 12)
  p.cylinder(lib.decorCeramic, 0.052, 0.047, 0.096, boardW * 0.23, 0.070, 0.035, false, 16)
  p.cylinder(lib.darkWood, 0.053, 0.053, 0.011, boardW * 0.23, 0.123, 0.035, false, 16)
  return decor(p.build('board-and-pantry-jars'))
}

export function coffeeTray(lib: MaterialLibrary) {
  const p = new Piece()
  p.box(lib.decorTray, 0.33, 0.015, 0.205, 0, 0.0075, 0, 0.007, 1)
  p.cylinder(lib.decorAmber, 0.031, 0.027, 0.055, 0.103, 0.043, 0.016, false, 16)
  p.cylinder(lib.linen, 0.028, 0.028, 0.004, 0.103, 0.070, 0.016, false, 16)
  const g = decor(p.build('coffee-tray-and-candle'))
  const books = bookStack(lib)
  books.scale.setScalar(0.78)
  books.position.set(-0.054, 0.015, -0.014)
  books.rotation.y = 0.13
  g.add(books)
  return g
}

export function bathCounterDecor(lib: MaterialLibrary, wide: boolean) {
  const p = new Piece()
  const w = wide ? 0.205 : 0.10
  p.box(lib.decorTray, w, 0.012, 0.107, 0, 0.006, 0, 0.006, 1)
  const x = wide ? -0.052 : 0
  p.cylinder(lib.decorAmber, 0.027, 0.030, 0.079, x, 0.051, 0.005, false, 16)
  p.cylinder(lib.fixtureMetal, 0.011, 0.011, 0.016, x, 0.097, 0.005, false, 10)
  p.box(lib.fixtureMetal, 0.034, 0.009, 0.012, x + 0.008, 0.107, 0.005, 0.003, 1)
  if (wide) {
    p.box(lib.linen, 0.075, 0.022, 0.082, 0.043, 0.023, 0, 0.009, 1)
    p.box(lib.fabric2, 0.066, 0.016, 0.070, 0.049, 0.041, -0.003, 0.007, 1)
  }
  return decor(p.build('bath-tray-and-soap'))
}
