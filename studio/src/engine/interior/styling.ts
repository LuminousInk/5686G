import * as THREE from 'three'
import { V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import { Piece } from './modern'

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
  const g = p.build('eucalyptus-branches')
  for (const mesh of g.children as THREE.Mesh[]) mesh.castShadow = false
  return g
}

export function sofaCushions(lib: MaterialLibrary, width: number, depth: number, lounge: boolean) {
  const p = new Piece()
  const z = lounge ? depth * 0.09 : -depth * 0.22
  p.tiltBack(lib.oliveLinen, 0.36, 0.31, 0.15, V3(-width * 0.33, 0.42, z), 0.29, 0.07)
  p.tiltBack(lib.fabric, 0.38, 0.33, 0.16, V3(-width * 0.20, 0.42, z + 0.045), 0.27, 0.077)
  p.tiltBack(lib.rustLinen, 0.38, 0.30, 0.16, V3(width * (lounge ? 0.14 : 0.34), 0.42, z + 0.013), 0.34, 0.073)
  return p.build('linen-and-olive-cushions')
}
