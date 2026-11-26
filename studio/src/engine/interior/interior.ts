import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { GeoBuilder, MeshBatch, V3 } from '../geo'
import type { HouseModel } from '../house/build'
import { blockAt, ceilingAt, sideIntervals, WALL_T } from '../house/massing'
import type { HomePlan, Opening, Rect, RoomDef, Side } from '../house/types'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import { placeModel } from '../models'
import type { QualitySettings } from '../quality'
import type { Segment2 } from '../house/walls'
import {
  FURNITURE_FOOTPRINTS, areaRug, barStool, diningChair, diningTable, floorLamp, mediaConsole,
  nightstand, platformBed, sideboard, tv, wardrobe,
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
    const solid = this.anchors(r, false)
    const a = solid[0]
    if (!a) return
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
    let sofa: Footprint | null = null
    const sofaSpots = against
      ? [sofaWall
        ? { ...this.wallPoint(sofaWall, 1), yaw: sofaYaw }
        : { x: a.x + a.inX * (depth - 0.53), z: a.z + a.inZ * (depth - 0.53), yaw: sofaYaw }]
      : [3.2, 3.0, 3.4].map(v => ({ x: a.x + a.inX * v, z: a.z + a.inZ * v, yaw: sofaYaw }))
    for (const p of sofaSpots) {
      sofa = this.fitWidth(r, p, sofaW, 1, 1.4)
      if (sofa) break
    }
    if (!sofa) {
      await Promise.all(jobs)
      return
    }
    this.occupy(r, sofa, true)
    jobs.push(this.model('GlamVelvetSofa', sofa.x, sofa.z, sofa.yaw, { size: sofa.w }))

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
      for (const [u, v] of offsets) {
        const [x, z] = this.localPoint(cx, cz, yaw, u, v)
        if (!this.canPlace(r, x, z, length, 0.95, yaw)) continue
        table = { x, z, w: length, d: 0.95, yaw }
        break
      }
    }
    if (!table) return
    this.occupy(r, table, true)
    this.kit(diningTable(this.lib, table.w, table.d), table.x, table.z, table.yaw)

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
        this.kit(diningChair(this.lib), x, z, cyaw)
      }
    }
    for (const s of [-1, 1]) {
      if ((roomLength - table.w) / 2 < 1.0) continue
      const [x, z] = this.localPoint(table.x, table.z, yaw, s * (table.w / 2 + 0.55), 0)
      const cyaw = yaw - s * Math.PI / 2
      if (!this.canPlace(r, x, z, chairSize.w, chairSize.d, cyaw)) continue
      const chair = this.occupy(r, { x, z, w: chairSize.w, d: chairSize.d, yaw: cyaw })
      chairs.push(chair)
      this.kit(diningChair(this.lib), x, z, cyaw)
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
      const d = FURNITURE_FOOTPRINTS.sideboard.d
      const w = Math.min(1.8, a.len - 0.4)
      const sb = this.fitWidth(r, this.wallPoint(a, d), w, d, 0.8)
      if (sb && this.clearance(sb, table) >= 0.8 && chairs.every(c => this.clearance(sb, c) >= 1.0)) {
        this.occupy(r, sb, true)
        this.kit(sideboard(this.lib, sb.w), sb.x, sb.z, sb.yaw)
        this.art(a.x, this.fy + 1.5, a.z, Math.min(1.3, sb.w * 0.8), 0.8, a.inX, a.inZ, 23)
        const [vx, vz] = this.localPoint(sb.x, sb.z, sb.yaw, Math.min(0.4, sb.w * 0.25), 0)
        jobs.push(this.model('ceramic_vase_02', vx, vz, sb.yaw, { height: 0.3, y: 0.84 }))
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
      this.occupy(r, { x: icx, z: icz, w: iw, d: idp, yaw }, true)
      // stools on the far side
      for (const k of [-0.6, 0, 0.6]) {
        const sx = icx + px * k + run.inX * 0.72
        const sz = icz + pz * k + run.inZ * 0.72
        const syaw = this.yaw(-run.inX, -run.inZ)
        const stool = FURNITURE_FOOTPRINTS.barStool
        if (!this.canPlace(r, sx, sz, stool.w, stool.d, syaw)) continue
        this.occupy(r, { x: sx, z: sz, w: stool.w, d: stool.d, yaw: syaw })
        this.kit(barStool(this.lib), sx, sz, syaw)
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
    const [x0, z0, x1, z1] = this.inner(r)
    const solid = this.anchors(r, false)
    const a = solid[0]
    if (!a) return
    const primary = r.type === 'primary'
    const yaw = this.yaw(a.inX, a.inZ)
    const depth = a.inX > 0 ? x1 - a.x : a.inX < 0 ? a.x - x0 : a.inZ > 0 ? z1 - a.z : a.z - z0
    const wallWidth = a.inX === 0 ? x1 - x0 : z1 - z0
    const maxW = Math.min(primary ? 1.8 : 1.5, a.len - 0.3, wallWidth - 0.3)
    const maxL = Math.min(primary ? 2.1 : 2.0, depth - 0.28)
    let bed: Footprint | null = null
    let bw = 0
    let bl = 0
    for (let l = maxL; l >= 1.75 && !bed; l -= 0.1) {
      for (let w = maxW; w >= 1.2; w -= 0.1) {
        const p = this.wallPoint(a, l + 0.2)
        if (!this.canPlace(r, p.x, p.z, w + 0.1, l + 0.2, yaw)) continue
        bed = { ...p, w: w + 0.1, d: l + 0.2 }
        bw = w
        bl = l
        break
      }
    }
    if (!bed) return
    this.occupy(r, bed, true)
    this.kit(platformBed(this.lib, bw, bl), bed.x, bed.z, yaw)

    const ns = FURNITURE_FOOTPRINTS.nightstand
    const free = (a.len - bed.w) / 2
    const both = free >= 0.55
    let stands = 0
    for (const k of [-1, 1]) {
      if (stands >= (both ? 2 : 1)) break
      const p = this.wallPoint(a, ns.d, k * (bed.w / 2 + 0.04 + ns.w / 2))
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
    const rugX = a.x + a.inX * ((rugStart + rugEnd) / 2)
    const rugZ = a.z + a.inZ * ((rugStart + rugEnd) / 2)
    if (rugD > 0.7 && this.canPlace(r, rugX, rugZ, rugW, rugD, yaw, 0, true)) {
      this.kit(areaRug(this.lib, rugW, rugD), rugX, rugZ, yaw)
    }

    const b = solid[1]
    if (b && b.len >= 1.1) {
      const d = FURNITURE_FOOTPRINTS.wardrobe.d
      const w = Math.min(2.0, b.len - 0.3)
      const ward = this.fitWidth(r, this.wallPoint(b, d), w, d, 0.9, 0.8)
      if (ward && this.clearance(ward, bed) >= 0.9) {
        this.occupy(r, ward, true)
        this.kit(wardrobe(this.lib, ward.w), ward.x, ward.z, ward.yaw)
      }
    }

    const jobs: Promise<unknown>[] = []
    if (primary) {
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
    this.art(a.x, this.fy + 1.5, a.z, primary ? 1.3 : 1.0, 0.75, a.inX, a.inZ, primary ? 11 : 17)
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

    const chair = FURNITURE_FOOTPRINTS.diningChair
    const cx = desk.x + a.inX * 0.72
    const cz = desk.z + a.inZ * 0.72
    const cyaw = yaw + Math.PI
    if (this.canPlace(r, cx, cz, chair.w, chair.d, cyaw)) {
      this.occupy(r, { x: cx, z: cz, w: chair.w, d: chair.d, yaw: cyaw })
      this.kit(diningChair(this.lib), cx, cz, cyaw)
    }
    const jobs: Promise<unknown>[] = []
    const accessoryOffset = Math.min(0.45, desk.w * 0.3)
    const [lx, lz] = this.localPoint(desk.x, desk.z, yaw, -accessoryOffset, 0)
    const [px, pz] = this.localPoint(desk.x, desk.z, yaw, accessoryOffset, 0)
    jobs.push(this.model('desk_lamp_arm_01', lx, lz, yaw, { height: 0.42, y: 0.76 }))
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
    const d = FURNITURE_FOOTPRINTS.sideboard.d
    const sb = this.fitWidth(r, this.wallPoint(a, d), Math.min(1.2, a.len - 0.3), d, 0.7)
    if (!sb) return
    this.occupy(r, sb, true)
    this.kit(sideboard(this.lib, sb.w), sb.x, sb.z, sb.yaw)
    this.art(a.x, this.fy + 1.5, a.z, Math.min(0.9, sb.w * 0.8), 0.9, a.inX, a.inZ, 29)
    const [vx, vz] = this.localPoint(sb.x, sb.z, sb.yaw, Math.min(0.32, sb.w * 0.25), 0)
    await this.model('ceramic_vase_02', vx, vz, sb.yaw, { height: 0.3, y: 0.84 })
  }

  dispose() {
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.geometry.dispose()
    })
  }
}
