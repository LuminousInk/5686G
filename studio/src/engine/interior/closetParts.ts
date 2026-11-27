import * as THREE from 'three'
import { V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { Piece } from './modern'
export const WARDROBE_DEPTH = 0.54

export function openWardrobe(lib: MaterialLibrary, width: number, height: number) {
  const p = new Piece()
  const clothes = new Piece()
  const deep = WARDROBE_DEPTH
  const divisions = Math.max(1, Math.round(width / 0.81))
  const bay = width / divisions
  const palette = [lib.fabric2, lib.linen, lib.oliveLinen, lib.rustLinen, lib.fabric]
  p.slabFromBase(lib.cabinet, 0, 0.075, -0.257, width, height - 0.075, 0.026)
  p.slabFromBase(lib.darkWood, 0, 0, -0.05, width, 0.075, deep - 0.10)
  for (let i = 0; i <= divisions; i++) {
    const x = THREE.MathUtils.clamp(i * bay - width / 2, -width / 2 + 0.0135, width / 2 - 0.0135)
    p.slabFromBase(lib.cabinet, x, 0.075, 0, 0.027, height - 0.075, deep)
    if (i < divisions) p.slabFromBase(lib.diffuser, x + 0.016, 0.36, 0.225, 0.009, height - 0.49, 0.009)
  }
  for (let i = 0; i < divisions; i++) {
    const x = (i + 0.5) * bay - width / 2
    const shelves = i % 2 === 1 || divisions === 1
    for (const y of shelves ? [0.12, 0.55, 0.89, 1.24, 1.62, height - 0.03] : [0.12, 0.49, height - 0.42, height - 0.03]) {
      p.slabFromBase(lib.cabinet, x, y, 0, bay, 0.029, deep)
      if (y > 0.13) p.slabFromBase(lib.diffuser, x, y - 0.005, 0.21, bay - 0.05, 0.006, 0.014)
    }
    if (shelves) {
      for (const [n, y] of [0.579, 0.919, 1.269].entries()) {
        for (let j = 0; j < 3; j++) {
          clothes.box(palette[(i + n + j) % palette.length], Math.min(0.34, bay - 0.09), 0.044, 0.29, x - 0.028 + 0.012 * j, y + 0.02 + 0.041 * j, 0.032 + j * 0.012, 0.02, 1)
        }
      }
      p.slabFromBase(lib.cabinet, x, 0.15, 0.08, bay - 0.045, 0.36, 0.34)
      p.slabFromBase(lib.blackMetal, x, 0.423, 0.257, bay * 0.35, 0.014, 0.018)
    } else {
      const rail = height - 0.49
      const pole = new THREE.CylinderGeometry(0.0105, 0.0105, bay - 0.026, 12)
      pole.rotateZ(Math.PI / 2).translate(x, rail, 0.025)
      clothes.add(lib.fixtureMetal, pole)
      const garments = Math.max(3, Math.floor(bay / 0.12))
      for (let j = 0; j < garments; j++) {
        const u = x + ((j + 0.5) / garments - 0.5) * bay * 0.87
        const h = 0.48 + (j % 3) * 0.10
        const shape = new THREE.Shape().moveTo(-0.185, -h).lineTo(0.168, -h).lineTo(0.17, -0.23)
          .lineTo(0.204, -0.225).lineTo(0.202, -0.13).lineTo(0.073, -0.045).lineTo(-0.07, -0.053)
          .lineTo(-0.20, -0.12).lineTo(-0.212, -0.25).lineTo(-0.17, -0.245).closePath()
        const garment = new THREE.ExtrudeGeometry(shape, { depth: 0.029, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 })
        garment.rotateY(Math.PI / 2 + (j % 3 - 1) * 0.09).translate(u, rail - 0.022, 0.019)
        clothes.add(palette[(i + j) % palette.length], garment)
        clothes.leg(lib.cabinet, V3(u, rail - 0.021, 0.019), V3(u, rail - 0.09, 0.18), 0.018)
        clothes.leg(lib.cabinet, V3(u, rail - 0.021, 0.019), V3(u, rail - 0.09, -0.14), 0.018)
      }
    }
  }
  const g = p.build('open-oak-wardrobe')
  g.add(clothes.build('hung-and-folded-linen'))
  return g
}
