import * as THREE from 'three'
import type { HomePlan } from '../house/types'
import { Hillside } from './hillside'

export interface Berm {
  x: number
  z: number
  rx: number
  rz: number
  h: number
  rot: number
  seed: number
}

/** Smooth rounded bump, flat-topped (a mound you could plant). */
function bermHeight(b: Berm, x: number, z: number) {
  const c = Math.cos(b.rot)
  const s = Math.sin(b.rot)
  const dx = x - b.x
  const dz = z - b.z
  const lx = (dx * c + dz * s) / b.rx
  const lz = (-dx * s + dz * c) / b.rz
  // superellipse distance with a little organic wobble
  const ang = Math.atan2(lz, lx)
  const wob = 1 + 0.07 * Math.sin(ang * 3 + b.seed) + 0.04 * Math.sin(ang * 5 + b.seed * 2.3)
  const d = Math.pow(Math.pow(Math.abs(lx), 2.6) + Math.pow(Math.abs(lz), 2.6), 1 / 2.6) / wob
  if (d >= 1) return 0
  const t = 1 - d
  // ease: flat top, soft toe
  const e = t < 0.45 ? THREE.MathUtils.smoothstep(t / 0.45, 0, 1) : 1
  return b.h * e
}

export class Terrain {
  readonly berms: Berm[]
  readonly hillside?: Hillside
  /** house pad: no hills here */
  private padR: number
  private cx: number
  private cz: number

  constructor(plan: HomePlan, houseBox: THREE.Box3, origin?: Hillside) {
    if (plan.landscape.site) this.hillside = new Hillside(plan, plan.landscape.site, origin)
    this.berms = (plan.landscape.berms ?? []).map(b => ({ ...b, rot: b.rot ?? 0, seed: b.seed ?? 1 }))
    const c = houseBox.getCenter(new THREE.Vector3())
    this.cx = c.x
    this.cz = c.z
    this.padR = Math.max(houseBox.max.x - houseBox.min.x, houseBox.max.z - houseBox.min.z) * 0.5 + 12
  }

  /** Ground height (no house, no terraces). */
  heightAt(x: number, z: number): number {
    if (this.hillside) return this.hillside.heightAt(x, z)
    let h = 0
    for (const b of this.berms) h = Math.max(h, bermHeight(b, x, z))
    // far rolling ground
    const r = Math.hypot(x - this.cx, z - this.cz)
    if (r > this.padR) {
      const k = THREE.MathUtils.smoothstep(r, this.padR, this.padR + 30)
      h += k * (1.2 * Math.sin(x * 0.035 + 1.3) * Math.cos(z * 0.028 - 0.4) + 0.8 * Math.sin(x * 0.011 - z * 0.017))
      h -= k * 0.4
    }
    return h
  }

  /** 0..1: how much of point x,z is berm (planting bed) rather than lawn. */
  bermMask(x: number, z: number): number {
    let m = 0
    for (const b of this.berms) {
      const c = Math.cos(b.rot)
      const s = Math.sin(b.rot)
      const dx = x - b.x
      const dz = z - b.z
      const lx = (dx * c + dz * s) / b.rx
      const lz = (-dx * s + dz * c) / b.rz
      const ang = Math.atan2(lz, lx)
      const wob = 1 + 0.07 * Math.sin(ang * 3 + b.seed) + 0.04 * Math.sin(ang * 5 + b.seed * 2.3)
      const d = Math.pow(Math.pow(Math.abs(lx), 2.6) + Math.pow(Math.abs(lz), 2.6), 1 / 2.6) / wob
      m = Math.max(m, d < 1.0 ? 1 : d < 1.12 ? (1.12 - d) / 0.12 : 0)
    }
    return m
  }

  /** Large ground mesh: dense near the house, coarse far away (radial grid). */
  buildMesh(material: THREE.Material, radius = 420): THREE.Mesh {
    const rings: number[] = []
    let r = 0
    while (r < radius) {
      rings.push(r)
      r += r < 30 ? 0.35 : r < 70 ? 1.2 : r < 160 ? 5 : 20
    }
    rings.push(radius)
    const seg = 220
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    // centre vertex
    pos.push(this.cx, this.heightAt(this.cx, this.cz), this.cz)
    uv.push(this.cx, this.cz)
    for (let i = 1; i < rings.length; i++) {
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2
        const x = this.cx + Math.cos(a) * rings[i]
        const z = this.cz + Math.sin(a) * rings[i]
        pos.push(x, this.heightAt(x, z) - 0.002, z)
        uv.push(x, z)
      }
    }
    const ring = (i: number, j: number) => 1 + (i - 1) * seg + (j % seg)
    for (let j = 0; j < seg; j++) idx.push(0, ring(1, j + 1), ring(1, j))
    for (let i = 1; i < rings.length - 1; i++)
      for (let j = 0; j < seg; j++) {
        const a = ring(i, j)
        const b = ring(i, j + 1)
        const c = ring(i + 1, j + 1)
        const d = ring(i + 1, j)
        idx.push(a, b, c, a, c, d)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(new THREE.Uint32BufferAttribute(idx, 1))
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, material)
    m.receiveShadow = true
    m.name = 'terrain'
    return m
  }
}
