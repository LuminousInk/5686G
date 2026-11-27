import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { MeshBatch, V3 } from '../geo'
import type { HouseModel } from '../house/build'
import { blockAt, ceilingAt, sideIntervals, WALL_T } from '../house/massing'
import type { HomePlan, Opening, Rect, RoomDef, Side } from '../house/types'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import { placeModel } from '../models'
import type { QualitySettings } from '../quality'
import type { Segment2 } from '../house/walls'
import { baseCabinets, COUNTER_TOP, inductionHob, ISLAND_TOP, kitchenIsland, openShelf, ovenTower, rangeHood, TALL_D, TALL_W } from './kitchenParts'
import {
  FURNITURE_FOOTPRINTS, areaRug, floorLamp, mediaConsole, nightstand, tv, wardrobe,
} from './modern'

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

interface Footprint {
  x: number
  z: number
  w: number
  d: number
  yaw: number
}

interface RoomOpening {
  side: Dir
  at: number
  width: number
  kind: Opening['kind']
  exterior: boolean
}

interface RoomLayout {
  keepOuts: Rect[]
  pieces: Footprint[]
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
  private layouts = new Map<string, RoomLayout>()

  constructor(
    private lib: MaterialLibrary,
    private quality: QualitySettings,
  ) {
    this.group.name = 'interior'
  }

  async build(plan: HomePlan, house: HouseModel) {
    this.plan = plan
    this.fy = plan.floorY
    this.layouts.clear()
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
        case 'bath': jobs.push(this.bath(r, false)); break
        case 'powder': jobs.push(this.bath(r, true)); break
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

  /** Openings on the four room boundaries, with positions in world metres. */
  private roomOpenings(r: RoomDef): RoomOpening[] {
    const [x0, z0, x1, z1] = r.rect
    const out: RoomOpening[] = []
    const sideAt = (axis: 'x' | 'z', line: number): Dir | null => {
      if (axis === 'x') {
        if (Math.abs(line - z0) < 0.08) return 'n'
        if (Math.abs(line - z1) < 0.08) return 's'
      } else {
        if (Math.abs(line - x0) < 0.08) return 'w'
        if (Math.abs(line - x1) < 0.08) return 'e'
      }
      return null
    }
    const add = (side: Dir | null, at: number, o: Opening, exterior: boolean) => {
      if (!side) return
      const lo = side === 'n' || side === 's' ? x0 : z0
      const hi = side === 'n' || side === 's' ? x1 : z1
      if (at + o.width / 2 < lo || at - o.width / 2 > hi) return
      out.push({ side, at, width: o.width, kind: o.kind, exterior })
    }
    for (const b of this.plan.blocks) {
      const [bx0, bz0, bx1, bz1] = b.rect
      const sides: [Dir, 'x' | 'z', number, number][] = [
        ['n', 'x', bz0, bx0], ['s', 'x', bz1, bx0], ['w', 'z', bx0, bz0], ['e', 'z', bx1, bz0],
      ]
      for (const [side, axis, line, start] of sides) {
        if (sideAt(axis, line) !== side) continue
        for (const o of this.plan.openings.filter(o2 => o2.block === b.id && o2.side === side)) add(side, start + o.at, o, true)
      }
    }
    for (const w of this.plan.walls) {
      const horiz = Math.abs(w.a[1] - w.b[1]) < 0.01
      const axis = horiz ? 'x' : 'z'
      const line = horiz ? w.a[1] : w.a[0]
      const side = sideAt(axis, line)
      const start = horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1])
      const rev = horiz ? w.a[0] > w.b[0] : w.a[1] > w.b[1]
      const wl = horiz ? Math.abs(w.b[0] - w.a[0]) : Math.abs(w.b[1] - w.a[1])
      for (const o of this.plan.openings.filter(o2 => o2.wall === w.id)) add(side, start + (rev ? wl - o.at : o.at), o, false)
    }
    return out
  }

  /** One-metre landing squares immediately inside every door and interior opening. */
  private keepOuts(r: RoomDef): Rect[] {
    const out: Rect[] = []
    for (const o of this.roomOpenings(r)) {
      if (o.exterior && o.kind !== 'door' && o.kind !== 'entry' && o.kind !== 'slider') continue
      const [x0, z0, x1, z1] = r.rect
      if (o.side === 'n') out.push([o.at - 0.5, z0, o.at + 0.5, z0 + 1])
      if (o.side === 's') out.push([o.at - 0.5, z1 - 1, o.at + 0.5, z1])
      if (o.side === 'w') out.push([x0, o.at - 0.5, x0 + 1, o.at + 0.5])
      if (o.side === 'e') out.push([x1 - 1, o.at - 0.5, x1, o.at + 0.5])
    }
    return out
  }

  private layout(r: RoomDef): RoomLayout {
    let l = this.layouts.get(r.id)
    if (!l) {
      l = { keepOuts: this.keepOuts(r), pieces: [] }
      this.layouts.set(r.id, l)
    }
    return l
  }

  private bounds(f: Footprint): Rect {
    const c = Math.abs(Math.cos(f.yaw))
    const s = Math.abs(Math.sin(f.yaw))
    const hw = (f.w * c + f.d * s) / 2
    const hd = (f.w * s + f.d * c) / 2
    return [f.x - hw, f.z - hd, f.x + hw, f.z + hd]
  }

  /** Distance between footprint bounds; negative values mean they overlap. */
  private clearance(a: Footprint, b: Footprint): number {
    const aa = this.bounds(a)
    const bb = this.bounds(b)
    const dx = Math.max(aa[0] - bb[2], bb[0] - aa[2], 0)
    const dz = Math.max(aa[1] - bb[3], bb[1] - aa[3], 0)
    if (dx > 0 || dz > 0) return Math.hypot(dx, dz)
    return -Math.min(Math.min(aa[2], bb[2]) - Math.max(aa[0], bb[0]), Math.min(aa[3], bb[3]) - Math.max(aa[1], bb[1]))
  }

  private canPlace(r: RoomDef, x: number, z: number, w: number, d: number, yaw = 0, gap = 0, ignorePlaced = false) {
    if (w <= 0 || d <= 0) return false
    const f = { x, z, w, d, yaw }
    const [ax0, az0, ax1, az1] = this.bounds(f)
    const [x0, z0, x1, z1] = this.inner(r)
    const e = 1e-4
    if (ax0 < x0 - e || az0 < z0 - e || ax1 > x1 + e || az1 > z1 + e) return false
    for (const k of this.layout(r).keepOuts) {
      if (ax0 < k[2] - e && ax1 > k[0] + e && az0 < k[3] - e && az1 > k[1] + e) return false
    }
    if (!ignorePlaced) {
      for (const p of this.layout(r).pieces) {
        const c = this.clearance(f, p)
        if ((gap === 0 && c < -e) || (gap > 0 && c < gap - e)) return false
      }
    }
    return true
  }

  private occupy(r: RoomDef, f: Footprint, collide = false) {
    this.layout(r).pieces.push(f)
    if (collide) this.obstacle(f.x, f.z, f.w, f.d, f.yaw)
    return f
  }

  private fitWidth(r: RoomDef, p: { x: number; z: number; yaw: number }, w: number, d: number, minW: number, gap = 0) {
    for (let width = w; width >= minW - 1e-4; width -= 0.1) {
      const f = { ...p, w: width, d }
      if (this.canPlace(r, f.x, f.z, f.w, f.d, f.yaw, gap)) return f
    }
    return null
  }

  /** Fit a sofa at its real aspect ratio. The plan id selects one repeatable look for the whole home. */
  private fitSofa(r: RoomDef, spots: { x: number; z: number; yaw: number }[], maxW: number, minW: number, greatRoom: boolean) {
    const glam = this.plan.id === 'coastal-modern'
    let hash = 0
    for (const ch of this.plan.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
    const ids = glam
      ? ['GlamVelvetSofa']
      : greatRoom && hash % 2 === 0
        ? ['sectional_grey', 'sofa_beige']
        : ['sofa_beige']
    for (const id of ids) {
      for (const p of spots) {
        for (let w = maxW; w >= minW - 1e-4; w -= 0.1) {
          const d = id === 'GlamVelvetSofa' ? 1 : w * (id === 'sectional_grey' ? 1.81 / 3.12 : 1.10 / 3.39)
          if (this.canPlace(r, p.x, p.z, w, d, p.yaw)) return { id, footprint: { ...p, w, d } }
        }
      }
    }
    return null
  }

  private fitSideboard(r: RoomDef, a: Anchor, maxW: number, minW: number) {
    for (let w = maxW; w >= minW - 1e-4; w -= 0.1) {
      const d = w * (0.4 / 1.2)
      const f = { ...this.wallPoint(a, d), w, d }
      if (this.canPlace(r, f.x, f.z, f.w, f.d, f.yaw)) return f
    }
    return null
  }

  /** The vase uses the loaded cabinet's measured top, not a guessed height. */
  private async modelSideboard(sb: Footprint, vaseAlong: number) {
    const cabinet = await this.model('sideboard_midcentury', sb.x, sb.z, sb.yaw, { width: sb.w })
    if (!cabinet) return
    const box = new THREE.Box3().setFromObject(cabinet)
    if (box.isEmpty()) return
    const [vx, vz] = this.localPoint(sb.x, sb.z, sb.yaw, vaseAlong, 0)
    await this.model('ceramic_vase_02', vx, vz, sb.yaw, { height: 0.3, y: box.max.y - this.fy })
  }

  private wallPoint(a: Anchor, depth: number, along = 0) {
    const rx = a.inZ
    const rz = -a.inX
    return {
      x: a.x + rx * along + a.inX * (depth / 2 + 0.03),
      z: a.z + rz * along + a.inZ * (depth / 2 + 0.03),
      yaw: this.yaw(a.inX, a.inZ),
    }
  }

  private localPoint(cx: number, cz: number, yaw: number, u: number, v: number) {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    return [cx + u * c + v * s, cz - u * s + v * c] as const
  }

  private kit(g: THREE.Group, x: number, z: number, yaw: number, y = 0) {
    g.position.set(x, this.fy + y, z)
    g.rotation.y = yaw
    this.group.add(g)
    return g
  }

  /** yaw so that a model facing +z faces along (dx, dz) */
  private yaw(dx: number, dz: number) {
    return Math.atan2(dx, dz)
  }

  private async model(id: string, x: number, z: number, yaw: number, opts: { size?: number; width?: number; depth?: number; height?: number; y?: number } = {}) {
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
    const solid = this.anchors(r, false)
    // the TV wall needs room for a console; glass-walled great rooms get a seating group facing the view instead
    const a = solid.find(s => s.len >= 1.4)
    if (!a) return this.livingView(r)
    const jobs: Promise<unknown>[] = []
    const rx = a.inZ
    const rz = -a.inX
    const depth = a.inX > 0 ? x1 - a.x : a.inX < 0 ? a.x - x0 : a.inZ > 0 ? z1 - a.z : a.z - z0
    const wallWidth = a.inX === 0 ? x1 - x0 : z1 - z0
    const along = (x: number, z: number) => (x - a.x) * rx + (z - a.z) * rz
    const into = (x: number, z: number) => (x - a.x) * a.inX + (z - a.z) * a.inZ

    // The TV is the focal point; all seating is laid out from this solid wall.
    const mediaD = a.len < 1.6 ? 0.5 : FURNITURE_FOOTPRINTS.mediaConsole.d
    const mediaW = Math.min(a.len < 1.6 ? 1.4 : 2.0, a.len - 0.4, wallWidth - 0.3)
    const media = this.fitWidth(r, this.wallPoint(a, mediaD), mediaW, mediaD, 0.7)
    if (media) {
      this.occupy(r, media, true)
      if (a.len >= 1.6) {
        this.kit(mediaConsole(this.lib, media.w), media.x, media.z, media.yaw)
      } else {
        jobs.push((async () => {
          const cabinet = await this.model('modern_wooden_cabinet', media.x, media.z, media.yaw, { size: media.w })
          let top = 0.62
          if (cabinet) {
            const b = new THREE.Box3().setFromObject(cabinet)
            if (!b.isEmpty()) top = b.max.y - this.fy
          }
          this.kit(tv(this.lib, Math.min(1.25, media.w)), media.x, media.z, media.yaw, top)
        })())
      }
    }

    const opposite: Record<Dir, Dir> = { n: 's', s: 'n', w: 'e', e: 'w' }
    const oppSolid = solid.find(s => s.side === opposite[a.side])
    const oppLow = this.anchors(r, true).find(s => s.side === opposite[a.side])
    const against = depth < 3.85
    const sofaWall = against ? oppSolid ?? oppLow : undefined
    const sofaYaw = this.yaw(-a.inX, -a.inZ)
    const sofaSpan = (sofaWall ?? a).len
    const sofaW = Math.min(2.4, sofaSpan - 0.3, wallWidth - 0.3)
    const sofaSpots = against
      ? [sofaWall
        ? { ...this.wallPoint(sofaWall, 1), yaw: sofaYaw }
        : { x: a.x + a.inX * (depth - 0.53), z: a.z + a.inZ * (depth - 0.53), yaw: sofaYaw }]
      : [3.2, 3.0, 3.4].map(v => ({ x: a.x + a.inX * v, z: a.z + a.inZ * v, yaw: sofaYaw }))
    const sofaFit = this.fitSofa(r, sofaSpots, sofaW, 1.4, !against)
    if (!sofaFit) {
      await Promise.all(jobs)
      return
    }
    const sofa = sofaFit.footprint
    this.occupy(r, sofa, true)
    jobs.push(this.model(sofaFit.id, sofa.x, sofa.z, sofa.yaw, sofaFit.id === 'GlamVelvetSofa' ? { size: sofa.w } : { width: sofa.w }))

    const sofaU = along(sofa.x, sofa.z)
    const sofaV = into(sofa.x, sofa.z)
    const rugW = Math.min(2.8, wallWidth - 0.3)
    const rugD = Math.min(2.0, depth - 0.3)
    const rugV = (sofaV + into(media?.x ?? a.x, media?.z ?? a.z)) / 2
    const rugX = a.x + rx * sofaU + a.inX * rugV
    const rugZ = a.z + rz * sofaU + a.inZ * rugV
    const rugYaw = this.yaw(a.inX, a.inZ)
    if (this.canPlace(r, rugX, rugZ, rugW, rugD, rugYaw, 0, true)) this.rug(rugX, rugZ, rugW, rugD, rugYaw)

    // A 45 cm sofa-to-table gap leaves the rest of the seating group open.
    const coffeeV = sofaV - 0.5 - 0.45 - 0.45
    const coffeeX = a.x + rx * sofaU + a.inX * coffeeV
    const coffeeZ = a.z + rz * sofaU + a.inZ * coffeeV
    if (this.canPlace(r, coffeeX, coffeeZ, 0.9, 0.9, rugYaw)) {
      const f = this.occupy(r, { x: coffeeX, z: coffeeZ, w: 0.9, d: 0.9, yaw: rugYaw }, true)
      jobs.push(this.model('coffee_table_round_01', f.x, f.z, f.yaw, { size: 0.9 }))
    }

    // Flank the rug rather than turning the seating into a second row facing the TV.
    for (const k of [-1, 1]) {
      const u = sofaU + k * (rugW / 2 + 0.48)
      const v = rugV + 0.35
      const x = a.x + rx * u + a.inX * v
      const z = a.z + rz * u + a.inZ * v
      const yaw = this.yaw(-k * rx, -k * rz) - k * (25 * Math.PI) / 180
      if (!this.canPlace(r, x, z, 0.8, 0.8, yaw)) continue
      this.occupy(r, { x, z, w: 0.8, d: 0.8, yaw })
      jobs.push(this.model(k < 0 ? 'SheenChair' : 'mid_century_lounge_chair', x, z, yaw, { size: 0.8 }))
    }

    const lampD = FURNITURE_FOOTPRINTS.floorLamp.d
    for (const k of [-1, 1]) {
      const u = sofaU + k * (sofa.w / 2 + 0.28)
      const v = sofaV - (against ? 0.35 : 0)
      const x = a.x + rx * u + a.inX * v
      const z = a.z + rz * u + a.inZ * v
      if (!this.canPlace(r, x, z, lampD, lampD, rugYaw)) continue
      this.occupy(r, { x, z, w: lampD, d: lampD, yaw: rugYaw })
      this.kit(floorLamp(this.lib), x, z, rugYaw)
      break
    }

    // Solid-wall endpoints are safe corners for a tall plant.
    let plant: Footprint | null = null
    for (const s of solid) {
      for (const k of [-1, 1]) {
        const p = this.wallPoint(s, 0.45, k * Math.max(0, s.len / 2 - 0.4))
        if (!this.canPlace(r, p.x, p.z, 0.45, 0.45, p.yaw, 0.8)) continue
        plant = { ...p, w: 0.45, d: 0.45 }
        break
      }
      if (plant) break
    }
    if (plant) {
      this.occupy(r, plant)
      jobs.push(this.model('potted_plant_01', plant.x, plant.z, plant.yaw, { height: 1.3 }))
    }

    if (against && oppSolid && sofaWall === oppSolid) {
      this.art(oppSolid.x, this.fy + 1.55, oppSolid.z, 1.4, 0.9, oppSolid.inX, oppSolid.inZ, 3)
    }
    await Promise.all(jobs)
  }

  /** A living room without a TV wall (glass all round): a floating seating group facing the main view. */
  private async livingView(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const glass: Record<Dir, number> = { n: 0, s: 0, e: 0, w: 0 }
    for (const o of this.roomOpenings(r)) if (o.exterior && o.kind !== 'entry' && o.kind !== 'garage') glass[o.side] += o.width
    const view = (['n', 's', 'e', 'w'] as Dir[]).sort((p, q) => glass[q] - glass[p])[0]
    // unit vector from the view wall into the room, and the axis along that wall
    const inX = view === 'w' ? 1 : view === 'e' ? -1 : 0
    const inZ = view === 'n' ? 1 : view === 's' ? -1 : 0
    const rx = inZ
    const rz = -inX
    const depth = inX !== 0 ? x1 - x0 : z1 - z0
    const width = inX !== 0 ? z1 - z0 : x1 - x0
    const wx = view === 'w' ? x0 : view === 'e' ? x1 : (x0 + x1) / 2
    const wz = view === 'n' ? z0 : view === 's' ? z1 : (z0 + z1) / 2
    const faceYaw = this.yaw(-inX, -inZ)
    const sofaDist = THREE.MathUtils.clamp(depth * 0.66, 2.4, depth - 0.75)
    const sofaSpots = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2].map(sh => ({
      x: wx + inX * sofaDist + rx * sh,
      z: wz + inZ * sofaDist + rz * sh,
      yaw: faceYaw,
    }))
    const sofaFit = this.fitSofa(r, sofaSpots, Math.min(2.4, width - 0.8), 1.6, true)
    if (!sofaFit) return
    const sofa = sofaFit.footprint
    this.occupy(r, sofa, true)
    const jobs: Promise<unknown>[] = [
      this.model(sofaFit.id, sofa.x, sofa.z, sofa.yaw, sofaFit.id === 'GlamVelvetSofa' ? { size: sofa.w } : { width: sofa.w }),
    ]
    const rugD = Math.min(2.0, sofaDist - 0.4)
    const rugW = Math.min(2.8, width - 0.6)
    const rugX = sofa.x - inX * (rugD / 2 - 0.25)
    const rugZ = sofa.z - inZ * (rugD / 2 - 0.25)
    if (rugD > 1.2 && this.canPlace(r, rugX, rugZ, rugW, rugD, faceYaw, 0, true)) this.rug(rugX, rugZ, rugW, rugD, faceYaw)
    const tx = sofa.x - inX * 0.95
    const tz = sofa.z - inZ * 0.95
    if (this.canPlace(r, tx, tz, 0.9, 0.9, faceYaw)) {
      this.occupy(r, { x: tx, z: tz, w: 0.9, d: 0.9, yaw: faceYaw })
      jobs.push(this.model('coffee_table_round_01', tx, tz, faceYaw, { size: 0.9 }))
    }
    // accent chairs at the open ends of the group, turned toward the coffee table
    for (const k of [-1, 1]) {
      const x = sofa.x - inX * 1.5 + rx * k * (sofa.w / 2 + 0.25)
      const z = sofa.z - inZ * 1.5 + rz * k * (sofa.w / 2 + 0.25)
      const yaw = this.yaw(tx - x, tz - z)
      if (!this.canPlace(r, x, z, 0.8, 0.8, yaw)) continue
      this.occupy(r, { x, z, w: 0.8, d: 0.8, yaw })
      jobs.push(this.model(k < 0 ? 'SheenChair' : 'mid_century_lounge_chair', x, z, yaw, { size: 0.8 }))
    }
    for (const k of [1, -1]) {
      const x = sofa.x + rx * k * (sofa.w / 2 + 0.3)
      const z = sofa.z + rz * k * (sofa.w / 2 + 0.3)
      if (!this.canPlace(r, x, z, 0.35, 0.35, faceYaw)) continue
      this.occupy(r, { x, z, w: 0.35, d: 0.35, yaw: faceYaw })
      this.kit(floorLamp(this.lib), x, z, faceYaw)
      break
    }
    await Promise.all(jobs)
  }

  private async dining(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    const along = x1 - x0 > z1 - z0
    const yaw = along ? 0 : Math.PI / 2
    const roomLength = along ? x1 - x0 : z1 - z0
    const jobs: Promise<unknown>[] = []
    const offsets = [[0, 0], [0, 0.3], [0, -0.3], [0.3, 0], [-0.3, 0], [0, 0.6], [0, -0.6]] as const
    let table: Footprint | null = null
    for (let length = Math.min(2.2, roomLength - 1.9); length >= 1.2 && !table; length -= 0.1) {
      const d = length * (4.47 / 8.81)
      for (const [u, v] of offsets) {
        const [x, z] = this.localPoint(cx, cz, yaw, u, v)
        if (!this.canPlace(r, x, z, length, d, yaw)) continue
        table = { x, z, w: length, d, yaw }
        break
      }
    }
    if (!table) return
    this.occupy(r, table, true)
    jobs.push(this.model('dining_table_oak', table.x, table.z, table.yaw, { width: table.w }))

    const chairs: Footprint[] = []
    const chairSize = FURNITURE_FOOTPRINTS.diningChair
    const count = Math.max(2, Math.floor(table.w / 0.62))
    const spacing = table.w / count
    for (let i = 0; i < count; i++) {
      const u = (i - (count - 1) / 2) * spacing
      for (const s of [-1, 1]) {
        const v = s * (table.d / 2 + 0.27)
        const [x, z] = this.localPoint(table.x, table.z, yaw, u, v)
        const cyaw = yaw + (s < 0 ? 0 : Math.PI)
        if (!this.canPlace(r, x, z, chairSize.w, chairSize.d, cyaw)) continue
        const chair = this.occupy(r, { x, z, w: chairSize.w, d: chairSize.d, yaw: cyaw })
        chairs.push(chair)
        jobs.push(this.model('dining_chair_bentwood', x, z, cyaw, { height: 0.84 }))
      }
    }
    for (const s of [-1, 1]) {
      if ((roomLength - table.w) / 2 < 1.0) continue
      const [x, z] = this.localPoint(table.x, table.z, yaw, s * (table.w / 2 + 0.55), 0)
      const cyaw = yaw - s * Math.PI / 2
      if (!this.canPlace(r, x, z, chairSize.w, chairSize.d, cyaw)) continue
      const chair = this.occupy(r, { x, z, w: chairSize.w, d: chairSize.d, yaw: cyaw })
      chairs.push(chair)
      jobs.push(this.model('dining_chair_bentwood', x, z, cyaw, { height: 0.84 }))
    }

    const b = blockAt(this.plan.blocks, table.x, table.z)
    const h = b ? ceilingAt(b, table.x, table.z) : 2.7
    const pendantOffset = Math.min(0.45, table.w / 4)
    for (const k of [-pendantOffset, pendantOffset]) {
      const [x, z] = this.localPoint(table.x, table.z, yaw, k, 0)
      this.pendant(x, this.fy + h, z, 0.16, h - 1.65)
    }

    const a = this.anchors(r, false)[0]
    if (a) {
      const sb = this.fitSideboard(r, a, Math.min(1.8, a.len - 0.4), 0.8)
      if (sb && this.clearance(sb, table) >= 0.8 && chairs.every(c => this.clearance(sb, c) >= 1.0)) {
        this.occupy(r, sb, true)
        jobs.push(this.modelSideboard(sb, Math.min(0.4, sb.w * 0.25)))
        this.art(a.x, this.fy + 1.5, a.z, Math.min(1.3, sb.w * 0.8), 0.8, a.inX, a.inZ, 23)
      }
    }
    await Promise.all(jobs)
  }

  private async kitchen(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const an = this.anchors(r, true)
    const lib = this.lib
    const run = an[0]
    const jobs: Promise<unknown>[] = []
    if (run) {
      // base run along the anchor wall: fridge, (oven tower), cabinets with hob, hood and open shelves
      const len = Math.min(run.len - 0.1, 5.2)
      const px = -run.inZ
      const pz = run.inX
      const D = 0.62
      const runYaw = this.yaw(run.inX, run.inZ)
      const ax = run.x - px * (len / 2)
      const az = run.z - pz * (len / 2)
      const P = (u: number, d: number) => [ax + px * u + run.inX * d, az + pz * u + run.inZ * d] as const
      const fy = this.fy
      // parts are built facing +z with their origin at the floor (mounted parts: their underside)
      const place = (g: THREE.Group, u: number, d: number, y = 0) => {
        const [x, z] = P(u, d)
        g.position.set(x, fy + y, z)
        g.rotation.y = runYaw
        this.group.add(g)
        return g
      }
      // A steel fridge fills the 0.92 m slot; its doors project beyond the base cabinets.
      const fridgeW = 2.72 * (1.8 / 5.84)
      const fridgeD = 2.85 * (1.8 / 5.84)
      const [fridgeX, fridgeZ] = P(0.46, fridgeD / 2 + 0.03)
      this.occupy(r, { x: fridgeX, z: fridgeZ, w: fridgeW, d: fridgeD, yaw: runYaw }, true)
      jobs.push(this.model('fridge_steel', fridgeX, fridgeZ, runYaw, { height: 1.8 }))
      let u0 = 0.92
      if (len >= 3.6) {
        place(ovenTower(lib), u0 + TALL_W / 2, TALL_D / 2)
        u0 += TALL_W
      }
      const bw = len - u0
      place(baseCabinets(lib, bw, D), u0 + bw / 2, D / 2)
      const mid = u0 + bw / 2
      place(inductionHob(), mid, D / 2 + 0.02, COUNTER_TOP)
      const rb = blockAt(this.plan.blocks, ...P(mid, 0.3))
      const ceil = rb ? ceilingAt(rb, ...P(mid, 0.3)) : 2.7
      place(rangeHood(lib, 0.9, Math.max(0.3, ceil - 1.62), 0.54), mid, 0.27, 1.62)
      // open shelves either side of the hood, where they fit
      for (const [s0, s1] of [[u0 + 0.05, mid - 0.55], [mid + 0.55, len - 0.05]]) {
        const w = Math.min(1.2, s1 - s0)
        if (w < 0.6) continue
        place(openShelf(lib, w), s0 < mid ? s1 - w / 2 : s0 + w / 2, 0.14, 1.62)
      }
      // island in the room middle, parallel to the run, its drawers facing the run and stools on the far side
      const [icx, icz] = P(len / 2 + 0.35, D + 1.25)
      const iw = Math.min(2.6, len - 0.6)
      const idp = 1.0
      const yaw = runYaw
      const isl = kitchenIsland(lib, iw, idp)
      // undermount sink + faucet on the island
      const basin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.02, 0.4), new THREE.MeshStandardMaterial({ color: '#2a2a2b', roughness: 0.3, metalness: 0.4 }))
      basin.position.set(-0.4, ISLAND_TOP - 0.009, -0.05)
      isl.add(basin)
      const [faucetX, faucetZ] = this.localPoint(icx, icz, yaw, -0.4, -0.33)
      jobs.push(this.model('kitchen_faucet', faucetX, faucetZ, yaw, { height: 0.38, y: ISLAND_TOP }))
      isl.position.set(icx, fy, icz)
      isl.rotation.y = yaw
      this.group.add(isl)
      this.occupy(r, { x: icx, z: icz, w: iw, d: idp, yaw }, true)
      // stools on the far side
      for (const k of [-0.6, 0, 0.6]) {
        const sx = icx + px * k + run.inX * 0.72
        const sz = icz + pz * k + run.inZ * 0.72
        const syaw = this.yaw(-run.inX, -run.inZ)
        const stool = FURNITURE_FOOTPRINTS.barStool
        if (!this.canPlace(r, sx, sz, stool.w, stool.d, syaw)) continue
        this.occupy(r, { x: sx, z: sz, w: stool.w, d: stool.d, yaw: syaw })
        jobs.push(this.model('bar_stool_wood', sx, sz, syaw, { height: 0.68 }))
      }
      const b = blockAt(this.plan.blocks, icx, icz)
      const h = b ? ceilingAt(b, icx, icz) : 2.7
      for (const k of [-0.7, 0, 0.7]) this.pendant(icx + px * k, fy + h, icz + pz * k, 0.12, h - 1.75)
      jobs.push(this.model('wooden_bowl_01', icx + px * 0.5, icz + pz * 0.5, 0, { size: 0.32, y: ISLAND_TOP }))
    }
    void [x0, z0, x1, z1]
    await Promise.all(jobs)
  }

  private async bedroom(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const solid = this.anchors(r, false)
    const primary = r.type === 'primary'
    // Headboard wall: every windowless wall (longest first), then walls with a window. On each wall the bed may slide
    // along the span, so a door keep-out near one corner no longer rules the whole wall out.
    const sameSpan = (p: Anchor, q: Anchor) => p.side === q.side && Math.abs(p.x - q.x) < 0.05 && Math.abs(p.z - q.z) < 0.05
    const windowWalls = this.anchors(r, true).filter(w => !solid.some(s => sameSpan(s, w)))
    const depthOf = (c: Anchor) => (c.inX > 0 ? x1 - c.x : c.inX < 0 ? c.x - x0 : c.inZ > 0 ? z1 - c.z : c.z - z0)
    const widthOf = (c: Anchor) => (c.inX === 0 ? x1 - x0 : z1 - z0)
    let a: Anchor | undefined
    let bed: Footprint | null = null
    let bw = 0
    let bl = 0
    let shift = 0
    search: for (const cand of [...solid, ...windowWalls]) {
      const maxW = Math.min(primary ? 1.8 : 1.5, cand.len - 0.1, widthOf(cand) - 0.3)
      const maxL = Math.min(primary ? 2.1 : 2.0, depthOf(cand) - 0.28)
      for (let l = maxL; l >= 1.75; l -= 0.1) {
        for (let w = maxW; w >= 1.2; w -= 0.1) {
          const slack = Math.max(0, (cand.len - (w + 0.1)) / 2)
          const slides = [0]
          for (let k = 0.1; k <= slack + 1e-6; k += 0.1) slides.push(k, -k)
          for (const sh of slides) {
            const p = this.wallPoint(cand, l + 0.2, sh)
            if (!this.canPlace(r, p.x, p.z, w + 0.1, l + 0.2, p.yaw)) continue
            a = cand
            bed = { ...p, w: w + 0.1, d: l + 0.2 }
            bw = w
            bl = l
            shift = sh
            break search
          }
        }
      }
    }
    if (!bed || !a) return
    const yaw = this.yaw(a.inX, a.inZ)
    const depth = depthOf(a)
    const wallWidth = widthOf(a)
    // along-wall axis of the headboard wall (matches wallPoint)
    const rx = a.inZ
    const rz = -a.inX
    const jobs: Promise<unknown>[] = []
    this.occupy(r, bed, true)
    jobs.push(this.model(
      primary ? 'bed_dark_headboard' : 'bed_upholstered_white',
      bed.x,
      bed.z,
      yaw,
      primary ? { width: bw + 0.15 } : { width: bw + 0.15, depth: bl + 0.2 },
    ))

    const ns = FURNITURE_FOOTPRINTS.nightstand
    const free = Math.min(a.len / 2 - shift, a.len / 2 + shift) - bed.w / 2
    const both = free >= 0.55
    let stands = 0
    for (const k of [-1, 1]) {
      if (stands >= (both ? 2 : 1)) break
      const p = this.wallPoint(a, ns.d, shift + k * (bed.w / 2 + 0.04 + ns.w / 2))
      if (!this.canPlace(r, p.x, p.z, ns.w, ns.d, yaw)) continue
      this.occupy(r, { ...p, w: ns.w, d: ns.d })
      this.kit(nightstand(this.lib), p.x, p.z, yaw)
      stands++
    }

    // The rug starts below the pillows and runs past the foot and both sides.
    const rugStart = bl / 3
    const rugEnd = Math.min(depth - 0.08, bl + 0.45)
    const rugW = Math.min(bw + 1.2, wallWidth - 0.2)
    const rugD = rugEnd - rugStart
    const rugX = a.x + rx * shift + a.inX * ((rugStart + rugEnd) / 2)
    const rugZ = a.z + rz * shift + a.inZ * ((rugStart + rugEnd) / 2)
    if (rugD > 0.7 && this.canPlace(r, rugX, rugZ, rugW, rugD, yaw, 0, true)) {
      this.kit(areaRug(this.lib, rugW, rugD), rugX, rugZ, yaw)
    }

    const b = solid.find(c => c !== a && c.len >= 1.1)
    if (b) {
      const d = FURNITURE_FOOTPRINTS.wardrobe.d
      const w = Math.min(2.0, b.len - 0.3)
      const ward = this.fitWidth(r, this.wallPoint(b, d), w, d, 0.9, 0.8)
      if (ward && this.clearance(ward, bed) >= 0.9) {
        this.occupy(r, ward, true)
        this.kit(wardrobe(this.lib, ward.w), ward.x, ward.z, ward.yaw)
      }
    }

    if (primary) {
      const dresserW = 0.6 * (1.15 / 0.72)
      const dresserD = 0.4 * (1.15 / 0.72)
      for (const wall of solid) {
        if (sameSpan(wall, a)) continue
        const p = this.wallPoint(wall, dresserD)
        if (!this.canPlace(r, p.x, p.z, dresserW, dresserD, p.yaw, 0.4)) continue
        this.occupy(r, { ...p, w: dresserW, d: dresserD }, true)
        jobs.push(this.model('dresser_tall', p.x, p.z, p.yaw, { height: 1.15 }))
        break
      }

      const corners = [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]
      const spots: { x: number; z: number; score: number }[] = []
      for (const o of this.roomOpenings(r)) {
        if (!o.exterior || (o.kind !== 'window' && o.kind !== 'fixed')) continue
        const inX = o.side === 'w' ? 1 : o.side === 'e' ? -1 : 0
        const inZ = o.side === 'n' ? 1 : o.side === 's' ? -1 : 0
        const rx = inZ
        const rz = -inX
        const wx = inX === 0 ? o.at : o.side === 'w' ? x0 : x1
        const wz = inZ === 0 ? o.at : o.side === 'n' ? z0 : z1
        for (const k of [-1, 1]) {
          const x = wx + rx * k * (o.width / 2 + 0.55) + inX * 0.55
          const z = wz + rz * k * (o.width / 2 + 0.55) + inZ * 0.55
          const score = Math.min(...corners.map(([cx, cz]) => Math.hypot(x - cx, z - cz)))
          spots.push({ x, z, score })
        }
      }
      spots.sort((p, q) => p.score - q.score)
      for (const p of spots) {
        const cyaw = this.yaw((x0 + x1) / 2 - p.x, (z0 + z1) / 2 - p.z)
        if (!this.canPlace(r, p.x, p.z, 0.8, 0.8, cyaw, 0.8)) continue
        this.occupy(r, { x: p.x, z: p.z, w: 0.8, d: 0.8, yaw: cyaw })
        jobs.push(this.model('SheenChair', p.x, p.z, cyaw, { size: 0.8 }))
        break
      }
    }
    // art above the headboard, only on solid wall (never across a window)
    if (solid.includes(a)) this.art(a.x + rx * shift, this.fy + 1.5, a.z + rz * shift, primary ? 1.3 : 1.0, 0.75, a.inX, a.inZ, primary ? 11 : 17)
    await Promise.all(jobs)
  }

  private async bath(r: RoomDef, powder: boolean) {
    const an = this.anchors(r, false)
    const lib = this.lib
    const fy = this.fy
    const a = an[0]
    if (!a) return
    const jobs: Promise<unknown>[] = []
    const yaw = this.yaw(a.inX, a.inZ)
    const px = -a.inZ
    const pz = a.inX
    const vw = powder ? 0.9 : Math.min(1.6, a.len - 1.2)
    const vd = vw * (0.5 / 1.26)
    // vanity offset toward one end of the anchor wall; its vessel sink and faucet are part of the model
    const off = powder ? 0 : -(a.len / 2 - vw / 2 - 0.1)
    const vp = this.wallPoint(a, vd, -off)
    this.occupy(r, { ...vp, w: vw, d: vd }, true)
    jobs.push(this.model('vanity_floating', vp.x, vp.z, yaw, { width: vw }))
    // mirror
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(vw * 0.8, 0.9), lib.mirror)
    mirror.position.set(a.x + px * off + a.inX * 0.012, fy + 1.45, a.z + pz * off + a.inZ * 0.012)
    mirror.rotation.y = yaw
    this.group.add(mirror)
    // toilet at the other end, facing into the room
    const tOff = powder ? -(a.len / 2) + 0.45 : a.len / 2 - 0.45
    const tx = a.x + px * (powder ? Math.max(tOff, vw / 2 + 0.4) : tOff) + a.inX * 0.36
    const tz = a.z + pz * (powder ? Math.max(tOff, vw / 2 + 0.4) : tOff) + a.inZ * 0.36
    const toiletW = 0.18 * (0.8 / 0.33)
    const toiletD = 0.26 * (0.8 / 0.33)
    this.occupy(r, { x: tx, z: tz, w: toiletW, d: toiletD, yaw }, true)
    jobs.push(this.model('toilet_modern', tx, tz, yaw, { height: 0.8 }))
    if (!powder) {
      // shower: keep the tiled corner and glass, replacing only the procedural head
      const b2 = an.find(x => x.side !== a.side) ?? a
      const sx = b2.x + b2.inX * 0.55
      const sz = b2.z + b2.inZ * 0.55
      const syaw = this.yaw(b2.inX, b2.inZ)
      this.box(lib.tileWall, b2.x + b2.inX * 0.01, fy, b2.z + b2.inZ * 0.01, Math.min(1.8, b2.len), 2.25, 0.02, syaw)
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.01, 2.0, 1.0), lib.glass)
      glass.position.set(sx + -b2.inZ * 0.7, fy + 1.0, sz + b2.inX * 0.7)
      glass.rotation.y = syaw
      this.group.add(glass)
      const showerW = 0.44 * (2.1 / 1.21)
      const showerD = 0.5 * (2.1 / 1.21)
      const sp = this.wallPoint(b2, showerD)
      this.occupy(r, { ...sp, w: showerW, d: showerD }, true)
      jobs.push(this.model('shower_black', sp.x, sp.z, syaw, { height: 2.1 }))

      const towelW = 0.6
      const towelD = 0.11 * (towelW / 2.83)
      towel: for (const wall of an) {
        for (const along of [0, -wall.len / 2 + 0.4, wall.len / 2 - 0.4]) {
          const p = this.wallPoint(wall, towelD, along)
          if (!this.canPlace(r, p.x, p.z, towelW, towelD, p.yaw)) continue
          this.occupy(r, { ...p, w: towelW, d: towelD })
          jobs.push(this.model('towel_bar', p.x, p.z, p.yaw, { width: towelW, y: 0.95 }))
          break towel
        }
      }
    }
    void [this.quality]
    await Promise.all(jobs)
  }

  private async office(r: RoomDef) {
    const solid = this.anchors(r, false)
    const a = solid[0]
    if (!a) return
    const fy = this.fy
    const yaw = this.yaw(a.inX, a.inZ)
    const desk = this.fitWidth(r, this.wallPoint(a, 0.7), Math.min(1.4, a.len - 0.3), 0.7, 1.0)
    if (!desk) return
    this.occupy(r, desk, true)
    this.box(this.lib.darkWood, desk.x, fy + 0.72, desk.z, desk.w, 0.04, 0.7, yaw)
    for (const k of [-1, 1]) {
      const [x, z] = this.localPoint(desk.x, desk.z, yaw, k * (desk.w / 2 - 0.06), 0)
      this.box(this.lib.blackMetal, x, fy, z, 0.04, 0.72, 0.62, yaw)
    }

    const jobs: Promise<unknown>[] = []
    const chair = FURNITURE_FOOTPRINTS.diningChair
    const cx = desk.x + a.inX * 0.72
    const cz = desk.z + a.inZ * 0.72
    const cyaw = yaw + Math.PI
    if (this.canPlace(r, cx, cz, chair.w, chair.d, cyaw)) {
      this.occupy(r, { x: cx, z: cz, w: chair.w, d: chair.d, yaw: cyaw })
      jobs.push(this.model('dining_chair_bentwood', cx, cz, cyaw, { height: 0.84 }))
    }
    const accessoryOffset = Math.min(0.45, desk.w * 0.3)
    const [lx, lz] = this.localPoint(desk.x, desk.z, yaw, -accessoryOffset, 0)
    const [px, pz] = this.localPoint(desk.x, desk.z, yaw, accessoryOffset, 0)
    jobs.push(this.model('desk_lamp_black', lx, lz, yaw, { height: 0.5, y: 0.76 }))
    jobs.push(this.model('potted_plant_04', px, pz, yaw, { height: 0.24, y: 0.76 }))

    const b = solid[1]
    if (b) {
      const w = Math.min(1.2, b.len - 0.3)
      const p = this.wallPoint(b, 0.38)
      if (this.canPlace(r, p.x, p.z, w, 0.38, p.yaw, 0.8)) {
        const shelf = await this.model('wooden_display_shelves_01', p.x, p.z, p.yaw, { height: 1.5 })
        if (shelf) {
          shelf.rotation.y = 0
          shelf.updateMatrixWorld(true)
          const box = new THREE.Box3().setFromObject(shelf)
          const size = box.getSize(new THREE.Vector3())
          const scale = box.isEmpty() || size.x <= 0 ? 1 : Math.min(1, w / size.x)
          shelf.scale.multiplyScalar(scale)
          const sw = size.x * scale
          const sd = size.z * scale
          shelf.rotation.y = p.yaw
          if (this.canPlace(r, p.x, p.z, sw, sd, p.yaw, 0.8)) {
            this.occupy(r, { ...p, w: sw, d: sd }, true)
          } else {
            this.group.remove(shelf)
          }
        }
      }
    }
    await Promise.all(jobs)
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
    const [x0, z0, x1, z1] = this.inner(r)
    if (Math.min(x1 - x0, z1 - z0) < 1.4) return
    const a = this.anchors(r, false)[0]
    if (!a || a.len < 1.2) return
    const sb = this.fitSideboard(r, a, Math.min(1.2, a.len - 0.3), 0.7)
    if (!sb) return
    this.occupy(r, sb, true)
    this.art(a.x, this.fy + 1.5, a.z, Math.min(0.9, sb.w * 0.8), 0.9, a.inX, a.inZ, 29)
    await this.modelSideboard(sb, Math.min(0.32, sb.w * 0.25))
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.geometry.dispose()
    })
  }
}
