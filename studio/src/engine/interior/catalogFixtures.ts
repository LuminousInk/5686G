import * as THREE from 'three'
import { V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import type { InteriorStyle } from './catalogStyle'
import { decor, Piece } from './modern'

function tube(points: THREE.Vector3[], radius: number, segments = 20) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 8, false)
}

export function domeShade(lib: MaterialLibrary, style: InteriorStyle) {
  const p = new Piece()
  const metal = style.pendant === 'ivory' ? lib.ivoryShade : lib[style.metal]
  const r = 0.205
  const profile = [[r - 0.015, 0.024], [r - 0.009, 0], [r, 0], [r, 0.014], [0.193, 0.083], [0.158, 0.153], [0.11, 0.201], [0.056, 0.229], [0.013, 0.235]]
  const shade = new THREE.LatheGeometry(profile.map(([x, h]) => new THREE.Vector2(x, h)), 32)
  p.add(metal, shade)
  p.cylinder(lib.diffuser, r * 0.91, r * 0.91, 0.01, 0, 0.013, 0, false, 24)
  return p.build('dome-shade')
}

export function kitchenPendant(lib: MaterialLibrary, style: InteriorStyle, drop: number) {
  const p = new Piece()
  const metal = style.pendant === 'ivory' ? lib.ivoryShade : lib[style.metal]
  p.cylinder(lib.blackMetal, 0.003, 0.003, drop - 0.21, 0, -(drop - 0.21) / 2, 0, false, 8)
  p.cylinder(metal, 0.075, 0.075, 0.025, 0, -0.0125, 0)
  const g = p.build('dome-pendant')
  const shade = domeShade(lib, style)
  shade.position.y = -drop
  g.add(shade)
  return decor(g)
}

/** Hang the sculpted shade at its designed size under ceilings of different heights. */
export function suspendedDome(lib: MaterialLibrary, drop: number, shade: THREE.Group, shadeHeight: number) {
  const p = new Piece()
  const cord = drop - shadeHeight
  p.cylinder(lib.blackMetal, 0.003, 0.003, cord, 0, -cord / 2, 0, false, 8)
  p.cylinder(lib.bronze, 0.065, 0.065, 0.025, 0, -0.0125, 0, false, 20)
  const g = p.build('dome-pendant')
  shade.position.y = -drop
  g.add(shade)
  return decor(g)
}

export function diningLight(lib: MaterialLibrary, style: InteriorStyle, width: number, drop: number, low = false) {
  const p = new Piece()
  const brass = lib[style.metal]
  p.cylinder(brass, 0.095, 0.095, 0.023, 0, -0.0115, 0, false, 24)
  if (style.pendant === 'brass') {
    // Woven bell shade. Its open weave stays readable up close without a texture or extra files.
    const wicker = lib.rattan
    const radius = Math.min(width * 0.36, 0.43)
    const levels = [[0, 0.26], [0.06, 0.52], [0.15, 0.78], [0.26, 0.94], [0.32, 1]] as const
    const ribs = low ? 24 : 32
    for (let i = 0; i < ribs; i++) {
      const a = i * Math.PI * 2 / ribs
      p.add(wicker, tube(levels.map(([h, r]) => V3(radius * r * Math.cos(a + h), -drop + 0.32 - h, radius * r * Math.sin(a + h))), 0.0035, 8))
    }
    const bands = low ? 10 : 13
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1)
      const ring = new THREE.TorusGeometry(radius * (0.26 + 0.74 * Math.sin(t * 1.55)), 0.0035, 5, 36)
      ring.rotateX(Math.PI / 2).translate(0, -drop + 0.32 * (1 - t), 0)
      p.add(wicker, ring)
    }
    p.cylinder(lib.diffuser, 0.07, 0.07, 0.11, 0, -drop + 0.12, 0)
    p.cylinder(brass, 0.004, 0.004, drop - 0.29, 0, -(drop - 0.29) / 2, 0, false, 8)
  } else {
    for (const [radius, offset] of [[Math.min(width * 0.36, 0.68), 0], [Math.min(width * 0.26, 0.48), 0.13]]) {
      const ring = new THREE.TorusGeometry(radius, 0.016, 9, 56)
      ring.rotateX(Math.PI / 2).translate(0, -drop + offset, 0)
      p.add(brass, ring)
      const glow = new THREE.TorusGeometry(radius, 0.007, 6, 56)
      glow.rotateX(Math.PI / 2).translate(0, -drop + offset - 0.014, 0)
      p.add(lib.diffuser, glow)
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3
        p.add(lib.blackMetal, tube([V3(0, -0.022, 0), V3(Math.cos(a) * radius, -drop + offset, Math.sin(a) * radius)], 0.0015, 1))
      }
    }
  }
  const g = p.build('pendant')
  // Thin cords and wicker do not need their own shadow silhouettes on phone shadow maps.
  for (const mesh of g.children as THREE.Mesh[]) mesh.castShadow = false
  return decor(g)
}

export function ceilingFan(lib: MaterialLibrary, oak: boolean) {
  const p = new Piece()
  p.cylinder(lib.blackMetal, 0.085, 0.085, 0.035, 0, -0.0175, 0)
  p.cylinder(lib.blackMetal, 0.014, 0.014, 0.16, 0, -0.10, 0)
  p.cylinder(lib.blackMetal, 0.085, 0.10, 0.075, 0, -0.212, 0)
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Shape().moveTo(0.05, -0.044).lineTo(0.56, -0.075).quadraticCurveTo(0.64, -0.07, 0.63, 0.022).lineTo(0.1, 0.065).closePath()
    const geo = new THREE.ExtrudeGeometry(blade, { depth: 0.013, bevelEnabled: false, curveSegments: 5 })
    geo.rotateX(Math.PI / 2).rotateY(i * Math.PI * 2 / 3).translate(0, -0.211, 0)
    p.add(oak ? lib.cabinet : lib.darkWood, geo)
  }
  return p.build('three-blade-fan')
}

export function tallCurtain(lib: MaterialLibrary, width: number, height: number) {
  const p = new Piece()
  const fabric = new THREE.PlaneGeometry(width, height, 36, 8)
  const positions = fabric.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const pleat = Math.cos(x / width * Math.PI * 12 + y * 0.24)
    positions.setXYZ(i, x * (1.01 - 0.12 * y / height), y + height / 2, 0.025 * pleat)
  }
  fabric.computeVertexNormals()
  p.add(lib.drapery, fabric)
  return decor(p.build('linen-curtain'))
}

export function curtainRail(lib: MaterialLibrary, width: number) {
  const p = new Piece()
  const rod = new THREE.CylinderGeometry(0.009, 0.009, width, 10)
  rod.rotateZ(Math.PI / 2)
  p.add(lib.blackMetal, rod)
  for (const x of [-width / 2 + 0.014, width / 2 - 0.014]) {
    p.slab(lib.blackMetal, 0.022, 0.031, 0.009, x, 0, -0.051)
    p.slab(lib.blackMetal, 0.009, 0.009, 0.051, x, 0, -0.025)
  }
  return decor(p.build('curtain-rail'))
}

export function plumbingArc(lib: MaterialLibrary, height: number, reach: number, metal: THREE.Material = lib.fixtureMetal) {
  const p = new Piece()
  p.cylinder(metal, 0.024, 0.024, 0.013, 0, 0.0065, 0, false, 16)
  p.add(metal, tube([V3(0, 0, 0), V3(0, height * 0.78, 0), V3(0, height, reach * 0.35), V3(0, height * 0.93, reach * 0.86), V3(0, height * 0.72, reach)], 0.01))
  p.cylinder(metal, 0.009, 0.009, 0.053, 0.039, 0.035, 0, false, 12)
  return p.build('arc-faucet')
}

export function ovalTub(lib: MaterialLibrary) {
  const profile = [
    [0, 0], [0.69, 0], [0.75, 0.044], [0.83, 0.18], [0.94, 0.43], [0.986, 0.55],
    [0.995, 0.583], [0.982, 0.605], [0.947, 0.607], [0.918, 0.585], [0.885, 0.53],
    [0.816, 0.36], [0.698, 0.18], [0.62, 0.125], [0.54, 0.11], [0, 0.108],
  ]
  const p = new Piece()
  p.add(lib.porcelain, new THREE.LatheGeometry(profile.map(([rad, height]) => new THREE.Vector2(rad, height)), 48).scale(0.83, 1, 0.425))
  p.cylinder(lib.fixtureMetal, 0.026, 0.026, 0.006, -0.38, 0.112, 0, false, 16)
  return p.build('freestanding-oval-tub')
}
