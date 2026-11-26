import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { GeoBuilder, MeshBatch, V3 } from '../geo'
import type { HouseModel } from '../house/build'
import { blockAt, ceilingAt, sideIntervals, WALL_T } from '../house/massing'
import type { HomePlan, RoomDef, Side } from '../house/types'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import { placeModel } from '../models'
import type { QualitySettings } from '../quality'
import type { Segment2 } from '../house/walls'

type Dir = Side

interface Anchor {
  side: Dir
  /** centre of the free span, along the side (world) */
  x: number
  z: number
  len: number
  /** unit vector pointing into the room */
  inX: number
  inZ: number
}

/**
 * Furnishes rooms by type. Each room picks an anchor wall (the longest stretch of solid wall, not a door or a
 * floor-to-ceiling window) and lays out pieces relative to it.
 */
export class Interior {
  readonly group = new THREE.Group()
  readonly lightSpots: THREE.Vector3[] = []
  readonly colliders: Segment2[] = []
  private batch = new MeshBatch()
  private plan!: HomePlan
  private fy = 0

  constructor(
    private lib: MaterialLibrary,
    private quality: QualitySettings,
  ) {
    this.group.name = 'interior'
  }

  async build(plan: HomePlan, house: HouseModel) {
    this.plan = plan
    this.fy = plan.floorY
    void house
    const jobs: Promise<void>[] = []
    for (const r of plan.rooms) {
      const b = blockAt(plan.blocks, (r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2)
      if (b?.utility) continue
      switch (r.type) {
        case 'living': jobs.push(this.living(r)); break
        case 'kitchen': jobs.push(this.kitchen(r)); break
        case 'dining': jobs.push(this.dining(r)); break
        case 'bedroom':
        case 'primary': jobs.push(this.bedroom(r)); break
        case 'bath': this.bath(r, false); break
        case 'powder': this.bath(r, true); break
        case 'office': jobs.push(this.office(r)); break
        case 'laundry': this.laundry(r); break
        case 'closet': this.closet(r); break
        case 'entry':
        case 'hall': jobs.push(this.entry(r)); break
      }
      if (['living', 'kitchen', 'dining', 'bedroom', 'primary', 'office'].includes(r.type)) {
        const cx = (r.rect[0] + r.rect[2]) / 2
        const cz = (r.rect[1] + r.rect[3]) / 2
        const cb = blockAt(plan.blocks, cx, cz)
        const h = cb ? ceilingAt(cb, cx, cz) : 2.7
        this.lightSpots.push(V3(cx, this.fy + Math.min(h - 0.4, 2.5), cz))
      }
    }
    await Promise.all(jobs)
    this.group.add(this.batch.toGroup('built-ins'))
  }

  // ------------------------------------------------------------------ helpers

  private inner(r: RoomDef): [number, number, number, number] {
    // room rect minus wall thickness where it borders a wall
    const [x0, z0, x1, z1] = r.rect
    const t = WALL_T * 0.5 + 0.02
    return [x0 + t, z0 + t, x1 - t, z1 - t]
  }

  /** Free spans of solid wall along each side of a room. */
  private anchors(r: RoomDef, allowWindows = true): Anchor[] {
    const [x0, z0, x1, z1] = this.inner(r)
    const out: Anchor[] = []
    const sides: { s: Dir; a: [number, number]; b: [number, number]; inX: number; inZ: number; line: number; axis: 'x' | 'z' }[] = [
      { s: 'n', a: [x0, z0], b: [x1, z0], inX: 0, inZ: 1, line: r.rect[1], axis: 'x' },
      { s: 's', a: [x0, z1], b: [x1, z1], inX: 0, inZ: -1, line: r.rect[3], axis: 'x' },
      { s: 'w', a: [x0, z0], b: [x0, z1], inX: 1, inZ: 0, line: r.rect[0], axis: 'z' },
      { s: 'e', a: [x1, z0], b: [x1, z1], inX: -1, inZ: 0, line: r.rect[2], axis: 'z' },
    ]
    for (const sd of sides) {
      const lo = sd.axis === 'x' ? x0 : z0
      const hi = sd.axis === 'x' ? x1 : z1
      // what covers this line: exterior walls of blocks, interior walls
      const covered: [number, number][] = []
      const blocks: [number, number][] = []
      for (const b of this.plan.blocks) {
        const [bx0, bz0, bx1, bz1] = b.rect
        const sides2: [Side, number, number, number][] =
          sd.axis === 'x'
            ? [['n', bz0, bx0, bx1], ['s', bz1, bx0, bx1]]
            : [['w', bx0, bz0, bz1], ['e', bx1, bz0, bz1]]
        for (const [bs, pos, a0] of sides2) {
          if (Math.abs(pos - sd.line) > 0.05) continue
          const { intervals } = sideIntervals(b, bs, this.plan.blocks)
          for (const iv of intervals) if (!iv.neighbour) covered.push([a0 + iv.u0, a0 + iv.u1])
          for (const o of this.plan.openings.filter(o2 => o2.block === b.id && o2.side === bs)) {
            const c = a0 + o.at
            if ((o.sill ?? 0) < 0.55 || !allowWindows) blocks.push([c - o.width / 2 - 0.15, c + o.width / 2 + 0.15])
          }
        }
      }
      for (const w of this.plan.walls) {
        const horiz = Math.abs(w.a[1] - w.b[1]) < 0.01
        if (sd.axis === 'x' && horiz && Math.abs(w.a[1] - sd.line) < 0.08) covered.push([Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])])
        if (sd.axis === 'z' && !horiz && Math.abs(w.a[0] - sd.line) < 0.08) covered.push([Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])])
        const start = horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1])
        const rev = horiz ? w.a[0] > w.b[0] : w.a[1] > w.b[1]
        const wl = horiz ? Math.abs(w.b[0] - w.a[0]) : Math.abs(w.b[1] - w.a[1])
        if ((sd.axis === 'x' && horiz && Math.abs(w.a[1] - sd.line) < 0.08) || (sd.axis === 'z' && !horiz && Math.abs(w.a[0] - sd.line) < 0.08))
          for (const o of this.plan.openings.filter(o2 => o2.wall === w.id)) {
            const c = start + (rev ? wl - o.at : o.at)
            blocks.push([c - o.width / 2 - 0.35, c + o.width / 2 + 0.35])
          }
      }
      // free = (covered ∩ [lo,hi]) minus blocks
      const segs: [number, number][] = []
      for (const [c0, c1] of covered) {
        const a = Math.max(lo, c0)
        const b = Math.min(hi, c1)
        if (b - a > 0.3) segs.push([a, b])
      }
      for (const [a, b] of segs) {
        let parts: [number, number][] = [[a, b]]
        for (const [k0, k1] of blocks) {
          const next: [number, number][] = []
          for (const [p0, p1] of parts) {
            if (k1 <= p0 || k0 >= p1) next.push([p0, p1])
            else {
              if (k0 > p0) next.push([p0, k0])
              if (k1 < p1) next.push([k1, p1])
            }
          }
          parts = next
        }
        for (const [p0, p1] of parts) {
          if (p1 - p0 < 0.6) continue
          const m = (p0 + p1) / 2
          const pt = sd.axis === 'x' ? [m, sd.s === 'n' ? z0 : z1] : [sd.s === 'w' ? x0 : x1, m]
          out.push({ side: sd.s, x: pt[0], z: pt[1], len: p1 - p0, inX: sd.inX, inZ: sd.inZ })
        }
      }
    }
    return out.sort((a, b) => b.len - a.len)
  }

  /** yaw so that a model facing +z faces along (dx, dz) */
  private yaw(dx: number, dz: number) {
    return Math.atan2(dx, dz)
  }

  private async model(id: string, x: number, z: number, yaw: number, opts: { size?: number; height?: number; y?: number } = {}) {
    try {
      const g = await placeModel(id, opts)
      g.traverse(o => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          const mat = m.material as THREE.MeshStandardMaterial
          mat.envMapIntensity = 0.3
          this.lib.interiorExtra.add(mat)
        }
      })
      g.position.set(x, this.fy + (opts.y ?? 0), z)
      g.rotation.y = yaw
      this.group.add(g)
      return g
    } catch {
      return null
    }
  }

  private rug(cx: number, cz: number, w: number, d: number, yaw: number) {
    const geo = new RoundedBoxGeometry(w, 0.014, d, 2, 0.006)
    const m = new THREE.Mesh(geo, this.lib.rug)
    m.position.set(cx, this.fy + 0.007, cz)
    m.rotation.y = yaw
    m.receiveShadow = true
    this.group.add(m)
  }

  private box(mat: THREE.Material, cx: number, y0: number, cz: number, w: number, h: number, d: number, yaw = 0, rounded = 0) {
    const geo = rounded > 0 ? new RoundedBoxGeometry(w, h, d, 3, rounded) : new THREE.BoxGeometry(w, h, d)
    const m = new THREE.Mesh(geo, mat)
    m.position.set(cx, y0 + h / 2, cz)
    m.rotation.y = yaw
    m.castShadow = m.receiveShadow = true
    this.group.add(m)
    return m
  }

  private obstacle(cx: number, cz: number, w: number, d: number, yaw: number) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const pts = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c])
    for (let i = 0; i < 4; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[(i + 1) % 4]
      this.colliders.push({ ax, az, bx, bz })
    }
  }

  private pendant(x: number, y: number, z: number, r = 0.18, drop = 0.9) {
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r, r * 0.9, 32, 1, true), this.lib.blackMetal)
    shade.position.set(x, y - drop, z)
    shade.castShadow = true
    this.group.add(shade)
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 24), this.lib.lamp('pendant', '#ffd9a8', 14))
    bulb.rotation.x = Math.PI / 2
    bulb.position.set(x, y - drop - r * 0.44, z)
    this.group.add(bulb)
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, drop - r * 0.45, 6), this.lib.blackMetal)
    cord.position.set(x, y - (drop - r * 0.45) / 2, z)
    this.group.add(cord)
  }

  private art(x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, seed: number) {
    const cv = document.createElement('canvas')
    cv.width = 256
    cv.height = Math.round((256 * h) / w)
    const ctx = cv.getContext('2d')!
    const r = rng(seed)
    const hue = Math.floor(r() * 60) + 20
    ctx.fillStyle = `hsl(${hue}, 18%, ${80 + r() * 10}%)`
    ctx.fillRect(0, 0, cv.width, cv.height)
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `hsla(${hue + r() * 40 - 20}, ${20 + r() * 25}%, ${35 + r() * 35}%, 0.85)`
      ctx.beginPath()
      ctx.ellipse(r() * cv.width, r() * cv.height, 30 + r() * 90, 20 + r() * 70, r() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.03), this.lib.blackMetal)
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
    const g = new THREE.Group()
    g.add(frame, canvas)
    canvas.position.z = 0.016
    g.position.set(x + nx * 0.02, y, z + nz * 0.02)
    g.rotation.y = this.yaw(nx, nz)
    this.group.add(g)
  }

  // ------------------------------------------------------------------ rooms

  private async living(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const an = this.anchors(r)
    // sofa against the longest solid wall, facing in
    const a = an[0]
    const jobs: Promise<unknown>[] = []
    if (a) {
      const sx = a.x + a.inX * 0.5
      const sz = a.z + a.inZ * 0.5
      const yaw = this.yaw(a.inX, a.inZ)
      jobs.push(this.model('sofa_03', sx, sz, yaw, { size: Math.min(2.6, a.len - 0.4) }))
      this.obstacle(sx, sz, 2.6, 1.0, yaw)
      // coffee table + rug
      const tx = a.x + a.inX * 1.75
      const tz = a.z + a.inZ * 1.75
      this.rug(a.x + a.inX * 1.6, a.z + a.inZ * 1.6, 3.2, 2.4, yaw)
      jobs.push(this.model('coffee_table_round_01', tx, tz, yaw, { size: 1.0 }))
      // two lounge chairs across the rug
      const px = -a.inZ
      const pz = a.inX
      for (const k of [-1, 1]) {
        const cx = a.x + a.inX * 2.95 + px * k * 0.85
        const cz = a.z + a.inZ * 2.95 + pz * k * 0.85
        jobs.push(this.model(k < 0 ? 'mid_century_lounge_chair' : 'modern_arm_chair_01', cx, cz, this.yaw(-a.inX, -a.inZ) + k * 0.35, { size: 0.85 }))
      }
      // side table + plant at the sofa end
      jobs.push(this.model('side_table_01', a.x + a.inX * 0.45 + px * 1.6, a.z + a.inZ * 0.45 + pz * 1.6, yaw, { size: 0.5 }))
      jobs.push(this.model('potted_plant_01', a.x + a.inX * 0.45 - px * 1.65, a.z + a.inZ * 0.45 - pz * 1.65, yaw, { height: 1.35 }))
      // art above the sofa
      const by = blockAt(this.plan.blocks, a.x, a.z)
      const ch = by ? ceilingAt(by, a.x, a.z) : 2.7
      if (ch > 2.6) this.art(a.x, this.fy + 1.55, a.z, 1.4, 0.9, a.inX, a.inZ, 3)
    }
    void [x0, z0, x1, z1]
    await Promise.all(jobs)
  }

  private async dining(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    const along = x1 - x0 > z1 - z0
    const yaw = along ? 0 : Math.PI / 2
    const jobs: Promise<unknown>[] = []
    jobs.push(this.model('dining_table', cx, cz, yaw, { size: 2.1 }))
    this.obstacle(cx, cz, 2.2, 1.1, yaw)
    for (const k of [-0.62, 0, 0.62])
      for (const s of [-1, 1]) {
        const ox = along ? k : s * 0.78
        const oz = along ? s * 0.78 : k
        jobs.push(this.model('dining_chair_02', cx + ox, cz + oz, along ? (s < 0 ? 0 : Math.PI) : s < 0 ? Math.PI / 2 : -Math.PI / 2, { height: 0.88 }))
      }
    const b = blockAt(this.plan.blocks, cx, cz)
    const h = b ? ceilingAt(b, cx, cz) : 2.7
    for (const k of [-0.45, 0.45]) this.pendant(cx + (along ? k : 0), this.fy + h, cz + (along ? 0 : k), 0.16, h - 1.65)
    await Promise.all(jobs)
  }

  private async kitchen(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const an = this.anchors(r, true)
    const lib = this.lib
    const run = an[0]
    const jobs: Promise<unknown>[] = []
    const cab = new GeoBuilder()
    const ctr = new GeoBuilder()
    const dark = new GeoBuilder()
    const steel = new GeoBuilder()
    if (run) {
      // base run along the anchor wall
      const len = Math.min(run.len - 0.1, 5.2)
      const px = -run.inZ
      const pz = run.inX
      const D = 0.62
      const ax = run.x - px * (len / 2)
      const az = run.z - pz * (len / 2)
      const P = (u: number, d: number) => [ax + px * u + run.inX * d, az + pz * u + run.inZ * d] as const
      const boxAlong = (g: GeoBuilder, u0: number, u1: number, d0: number, d1: number, y0: number, y1: number) => {
        const [ax0, az0] = P(u0, d0)
        const [ax1, az1] = P(u1, d1)
        g.box(Math.min(ax0, ax1), y0, Math.min(az0, az1), Math.max(ax0, ax1), y1, Math.max(az0, az1))
      }
      const fy = this.fy
      // fridge column at one end
      boxAlong(cab, 0, 0.92, 0, 0.66, fy, fy + 2.3)
      // base cabinets with toe kick
      boxAlong(dark, 0.92, len, 0.05, D - 0.08, fy, fy + 0.1)
      for (let u = 0.92; u < len - 0.05; u += 0.6) boxAlong(cab, u + 0.003, Math.min(u + 0.6, len) - 0.003, 0, D, fy + 0.1, fy + 0.88)
      boxAlong(ctr, 0.92, len, 0, D + 0.02, fy + 0.88, fy + 0.92)
      // backsplash + open shelves + hood
      boxAlong(ctr, 0.92, len, 0, 0.015, fy + 0.92, fy + 1.5)
      const mid = (0.92 + len) / 2
      boxAlong(steel, mid - 0.45, mid + 0.45, 0.02, 0.5, fy + 1.62, fy + 1.72)
      boxAlong(steel, mid - 0.18, mid + 0.18, 0.02, 0.3, fy + 1.72, fy + 2.4)
      boxAlong(dark, mid - 0.38, mid + 0.38, 0.06, 0.56, fy + 0.92, fy + 0.926)
      for (const u0 of [1.0, len - 1.25]) boxAlong(cab, u0, u0 + 1.15, 0, 0.28, fy + 1.62, fy + 1.66)
      // island in the room middle, parallel to the run
      const [icx, icz] = P(len / 2 + 0.35, D + 1.25)
      const iw = Math.min(2.6, len - 0.6)
      const idp = 1.0
      const yaw = this.yaw(run.inX, run.inZ)
      const isl = new THREE.Group()
      const ib = new GeoBuilder()
      ib.box(-iw / 2 + 0.03, fy, -idp / 2 + 0.03, iw / 2 - 0.03, fy + 0.9, idp / 2 - 0.03)
      const it = new GeoBuilder()
      it.box(-iw / 2, fy + 0.9, -idp / 2, iw / 2, fy + 0.94, idp / 2)
      // waterfall ends
      it.box(-iw / 2, fy, -idp / 2, -iw / 2 + 0.04, fy + 0.9, idp / 2)
      it.box(iw / 2 - 0.04, fy, -idp / 2, iw / 2, fy + 0.9, idp / 2)
      const cabMesh = new THREE.Mesh(ib.build(), lib.cabinet)
      const topMesh = new THREE.Mesh(it.build(), lib.counter)
      for (const m of [cabMesh, topMesh]) {
        m.castShadow = m.receiveShadow = true
        isl.add(m)
      }
      // undermount sink + faucet on the island
      const basin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.02, 0.4), new THREE.MeshStandardMaterial({ color: '#2a2a2b', roughness: 0.3, metalness: 0.4 }))
      basin.position.set(-0.4, fy + 0.931, -0.05)
      isl.add(basin)
      const curve = new THREE.CatmullRomCurve3([V3(-0.4, fy + 0.94, -0.33), V3(-0.4, fy + 1.32, -0.33), V3(-0.4, fy + 1.4, -0.22), V3(-0.4, fy + 1.3, -0.1)])
      const faucet = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.013, 12, false), lib.fixtureMetal)
      faucet.castShadow = true
      isl.add(faucet)
      isl.position.set(icx, 0, icz)
      isl.rotation.y = yaw
      this.group.add(isl)
      this.obstacle(icx, icz, iw, idp, yaw)
      // stools on the far side
      for (const k of [-0.6, 0, 0.6]) {
        const sx = icx + px * k + run.inX * 0.72
        const sz = icz + pz * k + run.inZ * 0.72
        jobs.push(this.model('bar_chair_round_01', sx, sz, this.yaw(-run.inX, -run.inZ), { height: 0.75 }))
      }
      const b = blockAt(this.plan.blocks, icx, icz)
      const h = b ? ceilingAt(b, icx, icz) : 2.7
      for (const k of [-0.7, 0, 0.7]) this.pendant(icx + px * k, fy + h, icz + pz * k, 0.12, h - 1.75)
      jobs.push(this.model('wooden_bowl_01', icx + px * 0.5, icz + pz * 0.5, 0, { size: 0.32, y: 0.94 }))
    }
    this.batch.add(lib.cabinet, cab.build())
    this.batch.add(lib.counter, ctr.build())
    this.batch.add(new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.25, name: 'black-glass' }), dark.build())
    this.batch.add(lib.appliance, steel.build())
    void [x0, z0, x1, z1]
    await Promise.all(jobs)
  }

  private async bedroom(r: RoomDef) {
    const an = this.anchors(r, true)
    const a = an[0]
    if (!a) return
    const lib = this.lib
    const primary = r.type === 'primary'
    const W = primary ? 1.95 : 1.6
    const L = 2.15
    const yaw = this.yaw(a.inX, a.inZ)
    const bx = a.x + a.inX * (L / 2 + 0.08)
    const bz = a.z + a.inZ * (L / 2 + 0.08)
    const bed = new THREE.Group()
    const fy = this.fy
    // platform frame, upholstered headboard, mattress, duvet, pillows
    const frame = new THREE.Mesh(new RoundedBoxGeometry(W + 0.12, 0.28, L + 0.08, 2, 0.02), lib.darkWood)
    frame.position.set(0, fy + 0.14, 0)
    const head = new THREE.Mesh(new RoundedBoxGeometry(W + 0.2, 1.05, 0.1, 3, 0.04), lib.fabric2)
    head.position.set(0, fy + 0.62, -L / 2 - 0.02)
    const mat = new THREE.Mesh(new RoundedBoxGeometry(W, 0.24, L - 0.02, 3, 0.06), lib.linen)
    mat.position.set(0, fy + 0.4, 0.01)
    const duvet = new THREE.Mesh(new RoundedBoxGeometry(W + 0.08, 0.1, L * 0.68, 4, 0.045), lib.fabric)
    duvet.position.set(0, fy + 0.54, L * 0.16)
    const fold = new THREE.Mesh(new RoundedBoxGeometry(W + 0.09, 0.06, 0.22, 3, 0.028), lib.linen)
    fold.position.set(0, fy + 0.6, -L * 0.17)
    const throwBlanket = new THREE.Mesh(new RoundedBoxGeometry(W + 0.12, 0.04, 0.5, 3, 0.018), lib.fabric2)
    throwBlanket.position.set(0, fy + 0.6, L * 0.36)
    bed.add(frame, head, mat, duvet, fold, throwBlanket)
    const pw = W / (primary ? 2 : 2) - 0.08
    for (const k of [-1, 1]) {
      const p = new THREE.Mesh(new RoundedBoxGeometry(pw, 0.16, 0.42, 4, 0.07), lib.linen)
      p.position.set(k * (W / 4), fy + 0.6, -L / 2 + 0.3)
      p.rotation.x = -0.35
      const p2 = new THREE.Mesh(new RoundedBoxGeometry(pw * 0.8, 0.14, 0.36, 4, 0.06), lib.fabric)
      p2.position.set(k * (W / 4), fy + 0.66, -L / 2 + 0.48)
      p2.rotation.x = -0.25
      bed.add(p, p2)
    }
    bed.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.castShadow = m.receiveShadow = true
    })
    bed.position.set(bx, 0, bz)
    bed.rotation.y = yaw
    this.group.add(bed)
    this.obstacle(bx, bz, W + 0.15, L + 0.1, yaw)
    // nightstands + lamps
    const px = -a.inZ
    const pz = a.inX
    const jobs: Promise<unknown>[] = []
    for (const k of [-1, 1]) {
      const nx = a.x + a.inX * 0.3 + px * k * (W / 2 + 0.38)
      const nz = a.z + a.inZ * 0.3 + pz * k * (W / 2 + 0.38)
      this.box(lib.cabinet, nx, fy, nz, 0.5, 0.52, 0.42, yaw, 0.01)
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.22, 24, 1, true), lib.lamp('shade', '#ffe2b8', 4))
      lamp.position.set(nx, fy + 0.84, nz)
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, 0.2, 16), lib.ceramic)
      base.position.set(nx, fy + 0.62, nz)
      this.group.add(lamp, base)
    }
    this.rug(bx + a.inX * 0.35, bz + a.inZ * 0.35, W + 1.4, L + 0.6, yaw)
    // bench at the foot, plant in a corner, art over the bed
    this.box(lib.fabric2, bx + a.inX * (L / 2 + 0.42), fy, bz + a.inZ * (L / 2 + 0.42), W * 0.75, 0.45, 0.42, yaw, 0.04)
    if (an[1]) jobs.push(this.model('potted_plant_02', an[1].x + an[1].inX * 0.45, an[1].z + an[1].inZ * 0.45, 0, { height: 1.0 }))
    this.art(a.x, fy + 1.5, a.z, primary ? 1.3 : 1.0, 0.75, a.inX, a.inZ, primary ? 11 : 17)
    await Promise.all(jobs)
  }

  private bath(r: RoomDef, powder: boolean) {
    const an = this.anchors(r, false)
    const lib = this.lib
    const fy = this.fy
    const a = an[0]
    if (!a) return
    const yaw = this.yaw(a.inX, a.inZ)
    const px = -a.inZ
    const pz = a.inX
    const vw = powder ? 0.9 : Math.min(1.6, a.len - 1.2)
    // vanity offset toward one end of the anchor wall
    const off = powder ? 0 : -(a.len / 2 - vw / 2 - 0.1)
    const vx = a.x + px * off + a.inX * 0.27
    const vz = a.z + pz * off + a.inZ * 0.27
    this.box(lib.cabinet, vx, fy + 0.25, vz, vw, 0.5, 0.52, yaw, 0.01)
    this.box(lib.counter, vx, fy + 0.75, vz, vw + 0.02, 0.04, 0.54, yaw)
    // vessel sink + faucet
    const sink = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.17, 0.005), new THREE.Vector2(0.2, 0.06), new THREE.Vector2(0.205, 0.13), new THREE.Vector2(0.19, 0.13), new THREE.Vector2(0.17, 0.03), new THREE.Vector2(0, 0.025)], 40), lib.porcelain)
    sink.position.set(vx, fy + 0.79, vz)
    sink.castShadow = true
    this.group.add(sink)
    const curve = new THREE.CatmullRomCurve3([V3(0, 0, -0.22), V3(0, 0.3, -0.22), V3(0, 0.34, -0.14), V3(0, 0.3, -0.08)])
    const faucet = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.01, 10, false), lib.fixtureMetal)
    faucet.position.set(vx, fy + 0.79, vz)
    faucet.rotation.y = yaw
    this.group.add(faucet)
    // mirror
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(vw * 0.8, 0.9), lib.mirror)
    mirror.position.set(a.x + px * off + a.inX * 0.012, fy + 1.45, a.z + pz * off + a.inZ * 0.012)
    mirror.rotation.y = yaw
    this.group.add(mirror)
    // toilet at the other end
    const tOff = powder ? -(a.len / 2) + 0.45 : a.len / 2 - 0.45
    const tx = a.x + px * (powder ? Math.max(tOff, vw / 2 + 0.4) : tOff) + a.inX * 0.36
    const tz = a.z + pz * (powder ? Math.max(tOff, vw / 2 + 0.4) : tOff) + a.inZ * 0.36
    const bowl = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.12, 0), new THREE.Vector2(0.18, 0.2), new THREE.Vector2(0.21, 0.38), new THREE.Vector2(0.19, 0.4), new THREE.Vector2(0, 0.4)], 32), lib.porcelain)
    bowl.scale.set(1, 1, 1.25)
    bowl.position.set(tx, fy, tz)
    bowl.rotation.y = yaw
    bowl.castShadow = true
    this.group.add(bowl)
    this.box(lib.porcelain, tx - a.inX * 0.27, fy + 0.4, tz - a.inZ * 0.27, 0.42, 0.38, 0.16, yaw, 0.03)
    if (!powder) {
      // shower: tiled corner + glass panel opposite the vanity end
      const b2 = an.find(x => x.side !== a.side) ?? a
      const sx = b2.x + b2.inX * 0.55
      const sz = b2.z + b2.inZ * 0.55
      const syaw = this.yaw(b2.inX, b2.inZ)
      this.box(lib.tileWall, b2.x + b2.inX * 0.01, fy, b2.z + b2.inZ * 0.01, Math.min(1.8, b2.len), 2.25, 0.02, syaw)
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.01, 2.0, 1.0), lib.glass)
      glass.position.set(sx + -b2.inZ * 0.7, fy + 1.0, sz + b2.inX * 0.7)
      glass.rotation.y = syaw
      this.group.add(glass)
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 24), lib.fixtureMetal)
      head.position.set(b2.x + b2.inX * 0.3, fy + 2.1, b2.z + b2.inZ * 0.3)
      this.group.add(head)
    }
    void [this.quality]
  }

  private async office(r: RoomDef) {
    const an = this.anchors(r, true)
    const a = an[0]
    if (!a) return
    const fy = this.fy
    const yaw = this.yaw(a.inX, a.inZ)
    const dx = a.x + a.inX * 0.38
    const dz = a.z + a.inZ * 0.38
    this.box(this.lib.darkWood, dx, fy + 0.72, dz, Math.min(1.6, a.len - 0.3), 0.04, 0.7, yaw)
    for (const k of [-1, 1]) this.box(this.lib.blackMetal, dx + -a.inZ * k * 0.72, fy, dz + a.inX * k * 0.72, 0.04, 0.72, 0.62, yaw)
    await this.model('modern_arm_chair_01', a.x + a.inX * 1.05, a.z + a.inZ * 1.05, this.yaw(-a.inX, -a.inZ), { size: 0.75 })
    await this.model('potted_plant_04', dx + -a.inZ * 0.55, dz + a.inX * 0.55, 0, { height: 0.28, y: 0.74 })
    if (an[1]) {
      // bookshelf on the second wall
      const b = an[1]
      const s = new GeoBuilder()
      const byaw = this.yaw(b.inX, b.inZ)
      const w = Math.min(1.8, b.len - 0.2)
      const shelf = new THREE.Group()
      s.box(-w / 2, 0, 0, w / 2, 0.02, 0.32)
      for (let k = 1; k <= 5; k++) s.box(-w / 2, k * 0.4, 0, w / 2, k * 0.4 + 0.025, 0.32)
      s.box(-w / 2, 0, 0, -w / 2 + 0.025, 2.05, 0.32)
      s.box(w / 2 - 0.025, 0, 0, w / 2, 2.05, 0.32)
      const m = new THREE.Mesh(s.build(), this.lib.cabinet)
      m.castShadow = m.receiveShadow = true
      shelf.add(m)
      shelf.position.set(b.x, fy, b.z)
      shelf.rotation.y = byaw
      this.group.add(shelf)
    }
  }

  private laundry(r: RoomDef) {
    const an = this.anchors(r, true)
    const a = an[0]
    if (!a) return
    const fy = this.fy
    const yaw = this.yaw(a.inX, a.inZ)
    for (const k of [-0.35, 0.35]) {
      const x = a.x + -a.inZ * k + a.inX * 0.35
      const z = a.z + a.inX * k + a.inZ * 0.35
      this.box(this.lib.porcelain, x, fy, z, 0.66, 0.9, 0.62, yaw, 0.02)
      const door = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), new THREE.MeshStandardMaterial({ color: '#202225', roughness: 0.15, metalness: 0.3 }))
      door.position.set(x + a.inX * 0.315, fy + 0.45, z + a.inZ * 0.315)
      door.rotation.y = yaw
      this.group.add(door)
    }
    this.box(this.lib.counter, a.x + a.inX * 0.35, fy + 0.92, a.z + a.inZ * 0.35, Math.min(a.len, 1.6), 0.04, 0.66, yaw)
    this.box(this.lib.cabinet, a.x + a.inX * 0.2, fy + 1.55, a.z + a.inZ * 0.2, Math.min(a.len, 1.6), 0.7, 0.36, yaw)
  }

  private closet(r: RoomDef) {
    const an = this.anchors(r, true)
    const fy = this.fy
    for (const a of an.slice(0, 2)) {
      const yaw = this.yaw(a.inX, a.inZ)
      this.box(this.lib.cabinet, a.x + a.inX * 0.3, fy, a.z + a.inZ * 0.3, Math.min(a.len - 0.1, 2.6), 2.2, 0.58, yaw)
    }
  }

  private async entry(r: RoomDef) {
    const an = this.anchors(r, true)
    const a = an[0]
    if (!a) return
    const yaw = this.yaw(a.inX, a.inZ)
    const fy = this.fy
    if (r.type === 'entry') {
      this.box(this.lib.darkWood, a.x + a.inX * 0.2, fy + 0.78, a.z + a.inZ * 0.2, Math.min(1.4, a.len - 0.2), 0.04, 0.36, yaw)
      for (const k of [-1, 1]) this.box(this.lib.blackMetal, a.x + -a.inZ * k * 0.62 + a.inX * 0.2, fy, a.z + a.inX * k * 0.62 + a.inZ * 0.2, 0.03, 0.78, 0.3, yaw)
      await this.model('ceramic_vase_02', a.x + a.inX * 0.2 + -a.inZ * 0.35, a.z + a.inZ * 0.2 + a.inX * 0.35, 0, { height: 0.32, y: 0.82 })
      this.art(a.x, fy + 1.55, a.z, 0.9, 1.1, a.inX, a.inZ, 29)
    }
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.geometry.dispose()
    })
  }
}
