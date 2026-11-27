import * as THREE from 'three'
import { V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import { bookStack, decor, Piece } from './modern'
import { rolledTowel, supportHeight } from './softGoods'

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

type Profile = readonly [number, number][]

function turned(profile: Profile, segments = 20) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments)
}

const lemonRind = new THREE.MeshStandardMaterial({ color: '#E4BB53', roughness: 0.66, name: 'lemon rind' })
const pearSkin = new THREE.MeshStandardMaterial({ color: '#9DA451', roughness: 0.63, name: 'pear skin' })
const citrusSkin = new THREE.MeshStandardMaterial({ color: '#CC7B49', roughness: 0.64, name: 'citrus rind' })
const bottleGreen = new THREE.MeshStandardMaterial({ color: '#4A5137', roughness: 0.28, name: 'olive glass' })
const bookCover = new THREE.MeshStandardMaterial({ color: '#B68264', roughness: 0.88, name: 'terracotta bookcloth' })
const candleWax = new THREE.MeshStandardMaterial({ color: '#F5E4C7', roughness: 0.92, name: 'candle wax' })

export type CounterProp = 'boards' | 'kettle' | 'cookbooks' | 'herbs'

/** Fit decor along the wall run, leaving a clear buffer on each side of the hob. */
export function counterProps(left: number, right: number, hob: number, hobWidth: number) {
  const clearance = hobWidth / 2 + 0.104
  const spans = [{ lo: left + 0.045, hi: hob - clearance }, { lo: hob + clearance, hi: right - 0.045 }]
  const props: { kind: CounterProp; x: number }[] = []
  for (const [kind, width] of [['boards', 0.42], ['kettle', 0.33], ['cookbooks', 0.23], ['herbs', 0.18]] as const) {
    const available = spans.filter(s => s.hi - s.lo >= width)
    const span = kind === 'kettle' ? available.at(-1) : available.sort((a, b) => b.hi - b.lo - (a.hi - a.lo))[0]
    if (!span) continue
    const onLeft = span.hi <= hob
    props.push({ kind, x: onLeft ? span.lo + width / 2 : span.hi - width / 2 })
    if (onLeft) span.lo += width + 0.08
    else span.hi -= width + 0.08
  }
  return props
}

function tube(points: THREE.Vector3[], radius: number, segments = 16) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), segments, radius, 6, false)
}

function bottle(p: Piece, lib: MaterialLibrary, x: number, z: number, height: number, material: THREE.Material) {
  const shape: Profile = [[0, 0], [0.027, 0], [0.031, 0.008], [0.031, height * 0.66],
    [0.021, height * 0.76], [0.0115, height * 0.80], [0.0115, height * 0.94], [0, height * 0.94]]
  p.add(material, turned(shape, 16).translate(x, 0, z))
  p.cylinder(lib.bronze, 0.013, 0.013, height * 0.09, x, height * 0.94, z, false, 12)
  p.cylinder(lib.artMat, 0.0315, 0.0315, height * 0.28, x, height * 0.38, z, true, 16)
}

export function kitchenBoards(lib: MaterialLibrary) {
  const p = new Piece()
  p.box(lib.cabinet, 0.31, 0.022, 0.25, -0.042, 0.011, 0.026, 0.011, 1)
  p.box(lib.darkWood, 0.27, 0.014, 0.20, -0.042, 0.029, 0.012, 0.007, 1)
  p.add(lib.cabinet, turned([[0, 0], [0.127, 0], [0.134, 0.005], [0.134, 0.013], [0, 0.016]], 30)
    .rotateX(Math.PI / 2 - 0.13).translate(-0.055, 0.135, -0.117))
  bottle(p, lib, 0.162, 0.077, 0.186, bottleGreen)
  bottle(p, lib, 0.151, -0.030, 0.148, lib.decorAmber)
  return decor(p.build('cutting-boards-and-oil'))
}

export function kettle(lib: MaterialLibrary, body: THREE.Material = lib.decorCeramic) {
  const p = new Piece()
  p.add(lib.blackMetal, turned([[0, 0], [0.085, 0], [0.092, 0.006], [0.092, 0.014], [0, 0.016]]))
  p.add(body, turned([[0, 0.015], [0.073, 0.015], [0.088, 0.027], [0.093, 0.07],
    [0.087, 0.112], [0.062, 0.151], [0.044, 0.164], [0, 0.166]]))
  p.add(lib.blackMetal, turned([[0, 0.161], [0.047, 0.161], [0.048, 0.168],
    [0.025, 0.175], [0.020, 0.185], [0, 0.189]]))
  p.add(lib.blackMetal, tube([
    V3(-0.07, 0.132, 0), V3(-0.109, 0.128, 0), V3(-0.134, 0.098, 0),
    V3(-0.13, 0.057, 0), V3(-0.082, 0.040, 0),
  ], 0.010))
  const spout = turned([[0, 0], [0.029, 0], [0.026, 0.029], [0.020, 0.064],
    [0.020, 0.067], [0.016, 0.067], [0.015, 0.037], [0, 0.034]], 16)
  p.add(body, spout.rotateZ(-0.60).translate(0.067, 0.086, 0))
  return decor(p.build('electric-kettle'))
}

export function fruitForBowl(lib: MaterialLibrary, bowl: THREE.Object3D, size: number, lemons: boolean) {
  const p = new Piece()
  const top = supportHeight(bowl)
  const scale = size / 0.30
  const random = rng(77)
  const placed: { x: number; y: number; z: number; radius: number }[] = []
  for (const [i, [u, v, r]] of [
    [-0.059, -0.023, 0.037], [0.048, -0.047, 0.041], [-0.029, 0.056, 0.035], [0.057, 0.034, 0.033],
    [-0.009, -0.018, 0.033],
  ].entries()) {
    const x = u * scale
    const z = v * scale
    const radius = r * scale
    const pear = !lemons && i % 2 === 1
    const geometry = pear
      ? turned([[0, -1], [0.63, -0.83], [0.98, -0.43], [1, 0.04], [0.81, 0.48],
        [0.54, 0.75], [0.36, 1.11], [0.22, 1.28], [0, 1.34]], 14)
      : new THREE.SphereGeometry(1, 14, 8)
    const squash = lemons ? 0.85 : 1
    let y = (top(x, z) ?? top(0, 0) ?? 0.012) + radius * squash
    if (i === 4) {
      for (const piece of placed) {
        const rise = (piece.radius + radius) ** 2 - (piece.x - x) ** 2 - (piece.z - z) ** 2
        if (rise > 0) y = Math.max(y, piece.y + squash * Math.sqrt(rise) - 0.003)
      }
    }
    placed.push({ x, y, z, radius })
    geometry.scale(radius * (lemons ? 1.06 : 1), radius * squash, radius)
      .rotateZ((random() - 0.5) * 0.54).rotateY(random() * Math.PI).translate(x, y, z)
    p.add(pear ? pearSkin : lemons ? lemonRind : citrusSkin, geometry)
    if (pear) p.cylinder(lib.foliageStem, 0.0024, 0.0028, 0.012, x, y + radius * 1.34, z, false, 6)
  }
  return decor(p.build('seasonal-fruit'))
}

function tray(p: Piece, lib: MaterialLibrary, width: number, depth: number) {
  p.box(lib.decorTray, width, 0.014, depth, 0, 0.007, 0, 0.006, 1)
}

function candle(p: Piece, lib: MaterialLibrary, x: number, z: number, y: number, radius: number, height: number) {
  p.add(lib.decorAmber, turned([[0, 0], [radius * 0.91, 0], [radius, 0.004], [radius, height],
    [radius * 0.86, height], [radius * 0.85, height * 0.78], [0, height * 0.78]], 16).translate(x, y, z))
  p.cylinder(candleWax, radius * 0.86, radius * 0.86, 0.008, x, y + height * 0.78, z, false, 16)
  p.cylinder(lib.darkWood, 0.0018, 0.0018, 0.006, x, y + height * 0.78 + 0.006, z, false, 6)
}

export function coffeeTableDecor(lib: MaterialLibrary, size: number, earthy: boolean) {
  const p = new Piece()
  tray(p, lib, 0.22, 0.17)
  candle(p, lib, -0.060, -0.014, 0.014, 0.034, 0.073)
  candle(p, lib, 0.056, 0.037, 0.014, 0.030, 0.038)
  const g = decor(p.build('coffee-table-candles'))
  const books = bookStack(lib, earthy ? bookCover : lib.oliveLinen)
  books.scale.setScalar(size / 0.76 * 1.28)
  books.position.set(-0.17, 0, 0.125)
  books.rotation.y = -0.21
  g.add(books)
  const sculpture = new Piece()
  const knot = new THREE.TorusKnotGeometry(0.036, 0.010, 32, 7, 2, 3)
  knot.rotateX(1.0).scale(1.05, 0.84, 1).computeBoundingBox()
  knot.translate(0.018, -knot.boundingBox!.min.y, -0.18)
  sculpture.add(lib.decorCeramic, knot)
  g.add(decor(sculpture.build('ceramic-knot')))
  return g
}

export function candleGrouping(lib: MaterialLibrary) {
  const p = new Piece()
  tray(p, lib, 0.20, 0.12)
  candle(p, lib, -0.045, -0.002, 0.014, 0.037, 0.069)
  candle(p, lib, 0.045, 0.012, 0.014, 0.026, 0.039)
  return decor(p.build('table-candle-group'))
}

export function bedsideTray(lib: MaterialLibrary, width: number) {
  const p = new Piece()
  tray(p, lib, width, 0.108)
  p.add(lib.decorCeramic, turned([[0, 0], [0.029, 0], [0.045, 0.019], [0.044, 0.024],
    [0.039, 0.022], [0.027, 0.008], [0, 0.008]], 20).translate(-width * 0.20, 0.014, 0))
  p.add(lib.bronze, new THREE.TorusGeometry(0.011, 0.0022, 6, 16).rotateX(-Math.PI / 2)
    .translate(-width * 0.16, 0.025, 0))
  return decor(p.build('bedside-catchall'))
}

export function basket(lib: MaterialLibrary, radius: number) {
  const p = new Piece()
  const h = radius * 1.34
  p.add(lib.rattan, turned([[0, 0], [radius * 0.76, 0], [radius * 0.86, 0.028],
    [radius, h], [radius - 0.016, h], [radius - 0.035, 0.039], [0, 0.027]], 28))
  for (let i = 0; i < 10; i++) {
    const t = i / 9
    const r = radius * (0.85 + 0.15 * t)
    const ring = new THREE.TorusGeometry(r, i === 9 ? 0.009 : 0.004, 5, 28)
    ring.rotateX(-Math.PI / 2).translate(0, 0.024 + t * (h - 0.024), 0)
    p.add(i % 3 === 0 ? lib.darkWood : lib.rattan, ring)
  }
  for (const x of [-1, 1]) {
    p.add(lib.rattan, tube([
      V3(x * radius * 0.99, h - 0.041, -radius * 0.37), V3(x * radius, h + 0.024, -radius * 0.28),
      V3(x * radius, h + 0.032, 0), V3(x * radius, h + 0.020, radius * 0.28),
      V3(x * radius * 0.99, h - 0.041, radius * 0.37),
    ], 0.009, 12))
  }
  const g = decor(p.build('woven-throw-basket'))
  const base = rolledTowel(lib, radius * 1.48, radius * 0.41, 0, 0.029, 0)
  const cloth = rolledTowel(lib, radius * 1.30, radius * 0.27, 0, 0.029 + radius * 0.80, 0)
  cloth.rotation.y = -0.22
  g.add(base, cloth)
  return g
}

export function bathCounterDecor(lib: MaterialLibrary, wide: boolean, spa = false) {
  const p = new Piece()
  const w = wide ? 0.205 : 0.096
  const d = spa ? 0.174 : 0.107
  tray(p, lib, w, d)
  const x = wide ? -0.056 : 0
  const z = spa ? -0.033 : 0.005
  p.cylinder(lib.decorAmber, 0.027, 0.030, 0.079, x, 0.054, z, false, 16)
  p.cylinder(lib.fixtureMetal, 0.011, 0.011, 0.016, x, 0.100, z, false, 10)
  p.box(lib.fixtureMetal, 0.034, 0.009, 0.012, x + 0.008, 0.110, z, 0.003, 1)
  if (spa) candle(p, lib, x, 0.051, 0.014, 0.028, 0.043)
  const g = decor(p.build('bath-tray-and-soap'))
  if (wide) {
    const towel = rolledTowel(lib, 0.087, 0.030, 0, 0.014, 0)
    towel.rotation.y = -Math.PI / 2 + 0.10
    towel.position.set(0.050, 0, 0.010)
    g.add(towel)
  }
  return g
}

/** Fit a bridge tray to both sides of the loaded tub rim. */
export function bathCaddy(lib: MaterialLibrary, tub: THREE.Group, width: number, depth: number) {
  const top = supportHeight(tub)
  const x = width * 0.15
  const rim = (side: number) => [0.485, 0.462, 0.439, 0.416, 0.393]
    .map(fraction => fraction * depth * side)
    .map(z => ({ z, y: top(x, z) ?? 0 }))
    .find(sample => sample.y > 0.51)
  const near = rim(-1)
  const far = rim(1)
  if (!near || !far || Math.abs(near.y - far.y) > 0.018) return

  const p = new Piece()
  const length = far.z - near.z + 0.065
  p.box(lib.cabinet, 0.233, 0.026, length, 0, 0.013, 0, 0.011, 1)
  candle(p, lib, 0.008, length * 0.26, 0.026, 0.038, 0.068)
  const g = decor(p.build('oak-bath-caddy'))
  g.position.set(x, Math.min(near.y, far.y) - 0.004, (near.z + far.z) / 2)
  g.add(rolledTowel(lib, 0.171, 0.041, 0, 0.026, -length * 0.19))
  return g
}
