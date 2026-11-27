import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { V3 } from '../geo'
import type { HouseModel } from '../house/build'
import { buildInteriorLevels } from '../house/interiorLevels'
import { blockAt, ceilingAt, INT_WALL_T, sideIntervals, WALL_T } from '../house/massing'
import type { HomePlan, Opening, Rect, RoomDef, Side } from '../house/types'
import type { MaterialLibrary } from '../materials/library'
import { placeModel, type ModelSize } from '../models'
import type { QualitySettings } from '../quality'
import type { Segment2 } from '../house/walls'
import { RoomArt } from './art'
import {
  oakSlats, shower as showerParts, showerOpening, SHOWER_HARDWARE_DEPTH, SHOWER_HARDWARE_HEIGHT, stoneWall, vanity as vanityParts,
} from './bathParts'
import { ceilingFan, curtainRail, diningLight, kitchenPendant, ovalTub, plumbingArc, suspendedDome, tallCurtain } from './catalogFixtures'
import { interiorStyle } from './catalogStyle'
import { openWardrobe, WARDROBE_DEPTH } from './closetParts'
import {
  baseCabinets, COUNTER_TOP, fridgeSurround, HOB, inductionHob, ISLAND_TOP, kitchenIsland, openShelf, ovenTower,
  OVEN_H, OVEN_MODEL_DEPTH, rangeHood, TALL_D, TALL_W,
} from './kitchenParts'
import {
  bench, bookStack, decor, linenBench, nightstand, platformBed, towelRail, tv,
} from './modern'
import { bedThrow, cushion, hungTowel, linenRunner, sofaThrow, supportHeight } from './softGoods'
import {
  basket, bathCaddy, bathCounterDecor, bedsideTray, candleGrouping, coffeeTableDecor, counterProps, eucalyptus, fruitForBowl,
  kettle, kitchenBoards,
} from './styling'

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
  sill: number
  height: number
  inset: number
  swingsIn: boolean
}

interface RoomSide {
  side: Dir
  line: number
  lo: number
  hi: number
  inX: number
  inZ: number
  spans: { start: number; end: number; inset: number }[]
}

const CHAIR = { w: 0.524, d: 0.51 }
const STOOL = { w: 0.384, d: 0.385 }
const WALKWAY = 0.9
const FIT_EPSILON = 1e-4
const RUG_HEIGHT = 0.008
const SLIDES = [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45, -0.6, 0.6, -0.9, 0.9]
const SOFA_DEPTH: Record<string, number> = { sectional_grey: 1.807 / 3.12, sofa_beige: 1.104 / 3.385, sofa_linen: 0.783 / 2 }
const DECOR_MODELS = new Set([
  'potted_plant_01', 'potted_plant_02', 'potted_plant_04', 'ceramic_vase_02', 'wooden_bowl_01',
  'book_encyclopedia_set_01', 'desk_lamp_black', 'table_lamp_ceramic', 'table_lamp_white', 'floor_lamp_tripod',
  'modern_ceiling_lamp_01', 'pendant_dome', 'dining_linear_pendant', 'throw_pillows_01',
])

/** Clip a shell collider to a furniture footprint, including walls inside edited room rectangles. */
function segmentCrossesBox({ ax, az, bx, bz }: Segment2, x0: number, z0: number, x1: number, z1: number) {
  if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) return false
  const dx = bx - ax
  const dz = bz - az
  if (Math.abs(dx) < FIT_EPSILON || Math.abs(dz) < FIT_EPSILON) return true
  const xa = (x0 - ax) / dx
  const xb = (x1 - ax) / dx
  const za = (z0 - az) / dz
  const zb = (z1 - az) / dz
  return Math.max(0, Math.min(xa, xb), Math.min(za, zb)) <= Math.min(1, Math.max(xa, xb), Math.max(za, zb))
}

interface RoomLayout {
  keepOuts: Rect[]
  glazing: Rect[]
  pieces: Footprint[]
}

/**
 * Furnishes rooms by type, fitting groups to the finished wall faces and reserving access to the openings.
 */
export class Interior {
  readonly group = new THREE.Group()
  readonly lightSpots: THREE.Vector3[] = []
  readonly colliders: Segment2[] = []
  private plan!: HomePlan
  private fy = 0
  private layouts = new Map<string, RoomLayout>()
  private boundaries = new Map<string, RoomSide[]>()
  private openings = new Map<string, RoomOpening[]>()
  private barriers: readonly Segment2[] = []

  constructor(
    private lib: MaterialLibrary,
    private quality?: QualitySettings,
    private artwork = new RoomArt(),
  ) {
    this.group.name = 'interior'
  }

  async build(plan: HomePlan, house: HouseModel) {
    if (plan.levels || plan.blocks.some(b => b.yaw)) {
      await buildInteriorLevels(plan, this, house.colliders, async (local, barriers) => {
        const child = new Interior(this.lib, this.quality, this.artwork)
        await child.buildRooms(local, barriers)
        return child
      })
    } else {
      await this.buildRooms(plan, house.colliders)
    }
    await this.artwork.ready()
  }

  private async buildRooms(plan: HomePlan, barriers: readonly Segment2[]) {
    this.plan = plan
    this.fy = plan.floorY
    this.layouts.clear()
    this.boundaries.clear()
    this.openings.clear()
    this.barriers = barriers
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
        case 'gym': jobs.push(this.gym(r)); break
        case 'laundry': jobs.push(this.laundry(r)); break
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
  }

  // ------------------------------------------------------------------ helpers

  private roomSides(r: RoomDef): RoomSide[] {
    const cached = this.boundaries.get(r.id)
    if (cached) return cached
    const [x0, z0, x1, z1] = r.rect
    const sides: RoomSide[] = [
      { side: 'n', line: z0, lo: x0, hi: x1, inX: 0, inZ: 1, spans: [] },
      { side: 's', line: z1, lo: x0, hi: x1, inX: 0, inZ: -1, spans: [] },
      { side: 'w', line: x0, lo: z0, hi: z1, inX: 1, inZ: 0, spans: [] },
      { side: 'e', line: x1, lo: z0, hi: z1, inX: -1, inZ: 0, spans: [] },
    ]
    for (const side of sides) {
      const horizontal = side.inX === 0
      const add = (lo: number, hi: number, inset: number) => {
        const start = Math.max(side.lo, lo)
        const end = Math.min(side.hi, hi)
        if (end - start > 0.05) side.spans.push({ start, end, inset })
      }
      for (const b of this.plan.blocks) {
        const [bx0, bz0, bx1, bz1] = b.rect
        const line = { n: bz0, s: bz1, w: bx0, e: bx1 }[side.side]
        if (Math.abs(line - side.line) > 0.05) continue
        const { intervals } = sideIntervals(b, side.side, this.plan.blocks)
        const start = horizontal ? bx0 : bz0
        for (const segment of intervals) {
          if (!segment.neighbour) {
            add(start + segment.u0, start + segment.u1, WALL_T + 0.012)
          } else if (this.plan.openings.some(o => o.block === b.id && o.side === side.side &&
            this.isPassage(o.kind) && o.at - o.width / 2 >= segment.u0 - FIT_EPSILON &&
            o.at + o.width / 2 <= segment.u1 + FIT_EPSILON)) {
            add(start + segment.u0, start + segment.u1, INT_WALL_T / 2)
          }
        }
      }
      for (const wall of this.plan.walls) {
        const normal = horizontal ? 1 : 0
        const axis = 1 - normal
        if (Math.abs(wall.a[normal] - side.line) > 0.05 || Math.abs(wall.a[normal] - wall.b[normal]) > 0.01) continue
        const offset = (wall.a[normal] - side.line) * (side.inX + side.inZ)
        add(Math.min(wall.a[axis], wall.b[axis]), Math.max(wall.a[axis], wall.b[axis]),
          offset + (wall.thickness ?? INT_WALL_T) / 2)
      }
    }
    this.boundaries.set(r.id, sides)
    return sides
  }

  private inner(r: RoomDef): Rect {
    const [x0, z0, x1, z1] = r.rect
    const [n, s, w, e] = this.roomSides(r).map(side => Math.max(0.025, ...side.spans.map(span => span.inset)) + 0.008)
    return [x0 + w, z0 + n, x1 - e, z1 - s]
  }

  /** Free spans of wall, at the finished face. The sill limits which windows can sit over a piece. */
  private anchors(r: RoomDef, minSill = Infinity): Anchor[] {
    const [x0, z0, x1, z1] = this.inner(r)
    const openings = this.roomOpenings(r)
    const out: Anchor[] = []
    for (const side of this.roomSides(r)) {
      const { inX, inZ } = side
      const horizontal = inX === 0
      const face = side.side === 'n' ? z0 : side.side === 's' ? z1 : side.side === 'w' ? x0 : x1
      const cuts = openings.filter(o => o.side === side.side && (this.isPassage(o.kind) || o.sill < minSill))
      for (const span of side.spans) {
        const lo = Math.max(span.start, horizontal ? x0 : z0)
        const hi = Math.min(span.end, horizontal ? x1 : z1)
        let parts = [[lo, hi]]
        for (const cut of cuts) {
          const trim = this.isPassage(cut.kind) ? 0.11 : 0.06
          const left = cut.at - cut.width / 2 - trim
          const right = cut.at + cut.width / 2 + trim
          parts = parts.flatMap(([a, b]) => right <= a || left >= b ? [[a, b]] : [[a, left], [right, b]])
        }
        for (const [a, b] of parts) {
          if (b - a < 0.45) continue
          const mid = (a + b) / 2
          out.push({ side: side.side, x: horizontal ? mid : face, z: horizontal ? face : mid, len: b - a, inX, inZ })
        }
      }
    }
    return out.sort((a, b) => b.len - a.len)
  }

  private isPassage(kind: Opening['kind']) {
    return kind === 'door' || kind === 'entry' || kind === 'slider' || kind === 'garage'
  }

  private roomOpenings(r: RoomDef): RoomOpening[] {
    const cached = this.openings.get(r.id)
    if (cached) return cached
    const out: RoomOpening[] = []
    for (const side of this.roomSides(r)) {
      const horizontal = side.inX === 0
      const add = (at: number, o: Opening, inset: number, exterior: boolean, swingsIn = true) => {
        if (at + o.width / 2 <= side.lo || at - o.width / 2 >= side.hi) return
        out.push({ side: side.side, at, width: o.width, kind: o.kind, sill: o.sill ?? 0, height: o.height, inset, exterior, swingsIn })
      }
      for (const b of this.plan.blocks) {
        const [x0, z0, x1, z1] = b.rect
        const line = { n: z0, s: z1, w: x0, e: x1 }[side.side]
        if (Math.abs(line - side.line) > 0.05) continue
        const { intervals } = sideIntervals(b, side.side, this.plan.blocks)
        for (const o of this.plan.openings) {
          if (o.block !== b.id || o.side !== side.side) continue
          const iv = intervals.find(iv => o.at - o.width / 2 >= iv.u0 - 0.001 && o.at + o.width / 2 <= iv.u1 + 0.001)
          if (iv && (!iv.neighbour || this.isPassage(o.kind))) {
            add((horizontal ? x0 : z0) + o.at, o, iv.neighbour ? INT_WALL_T / 2 : WALL_T, !iv.neighbour)
          }
        }
      }
      for (const w of this.plan.walls) {
        const normal = horizontal ? 1 : 0
        const axis = 1 - normal
        if (Math.abs(w.a[normal] - side.line) > 0.05 || Math.abs(w.a[normal] - w.b[normal]) > 0.01) continue
        const sign = Math.sign(w.b[axis] - w.a[axis])
        for (const o of this.plan.openings) {
          if (o.wall !== w.id) continue
          const at = w.a[axis] + sign * o.at
          const inside = side.inX + side.inZ
          const plus = horizontal ? sign : -sign
          const adjacent = (dx: number) => this.plan.rooms.find(room => {
            const [x0, z0, x1, z1] = room.rect
            const x = horizontal ? at : w.a[normal] + dx * 0.6
            const z = horizontal ? w.a[normal] + dx * 0.6 : at
            return x >= x0 && x <= x1 && z >= z0 && z <= z1
          })
          const p = adjacent(plus)
          const m = adjacent(-plus)
          const area = (room: RoomDef) => (room.rect[2] - room.rect[0]) * (room.rect[3] - room.rect[1])
          const swing = p && m && area(m) > area(p) ? -plus : plus
          add(at, o, (w.thickness ?? INT_WALL_T) / 2, false, swing === inside)
        }
      }
    }
    this.openings.set(r.id, out)
    return out
  }

  private openingStrip(r: RoomDef, o: RoomOpening, depth: number, margin = 0): Rect {
    const [x0, z0, x1, z1] = r.rect
    const lo = o.at - o.width / 2 - margin
    const hi = o.at + o.width / 2 + margin
    if (o.side === 'n') return [lo, z0, hi, z0 + depth]
    if (o.side === 's') return [lo, z1 - depth, hi, z1]
    if (o.side === 'w') return [x0, lo, x0 + depth, hi]
    return [x1 - depth, lo, x1, hi]
  }

  /** Preserve the full opening width and the reach of its leaf, including wide sliders and paired entries. */
  private keepOuts(r: RoomDef): Rect[] {
    return this.roomOpenings(r).filter(o => !o.exterior || this.isPassage(o.kind)).map(o => {
      const reach = o.kind === 'door' && o.swingsIn ? o.width : o.kind === 'entry' ? o.width / 2 : 0
      const landing = r.type === 'powder' && !o.swingsIn ? 0.58 : WALKWAY
      return this.openingStrip(r, o, Math.max(landing, reach + 0.06) + o.inset, 0.08)
    })
  }

  private layout(r: RoomDef): RoomLayout {
    let l = this.layouts.get(r.id)
    if (!l) {
      const glazing = this.roomOpenings(r)
        .filter(o => o.exterior && !this.isPassage(o.kind) && o.sill < 0.4)
        .map(o => this.openingStrip(r, o, o.inset + 0.27))
      l = { keepOuts: this.keepOuts(r), glazing, pieces: [] }
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

  private canPlace(
    r: RoomDef, x: number, z: number, w: number, d: number, yaw = 0, gap = 0,
    { ignoreFurniture = false, allowDoorLanding = false } = {},
  ) {
    if (w <= 0 || d <= 0) return false
    const f = { x, z, w, d, yaw }
    const [ax0, az0, ax1, az1] = this.bounds(f)
    const [x0, z0, x1, z1] = this.inner(r)
    const e = FIT_EPSILON
    if (ax0 < x0 - e || az0 < z0 - e || ax1 > x1 + e || az1 > z1 + e) return false
    const layout = this.layout(r)
    const overlaps = (k: Rect) => ax0 < k[2] - e && ax1 > k[0] + e && az0 < k[3] - e && az1 > k[1] + e
    if (!allowDoorLanding && layout.keepOuts.some(overlaps)) return false
    if (!allowDoorLanding && this.barriers.some(seg => segmentCrossesBox(seg, ax0 + e, az0 + e, ax1 - e, az1 - e))) return false
    if (!ignoreFurniture) {
      if (layout.glazing.some(overlaps)) return false
      for (const p of layout.pieces) {
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
    const straight = ['sofa_linen', 'sofa_beige']
    const ids = greatRoom && this.plan.id !== 'modern-farmhouse' ? ['sectional_grey', ...straight] : straight
    for (const id of ids) {
      for (const p of spots) {
        for (let w = maxW; w >= minW - 1e-4; w -= 0.1) {
          const d = w * SOFA_DEPTH[id]
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
    const cabinet = await this.model('sideboard_midcentury', sb.x, sb.z, sb.yaw, { width: sb.w, depth: sb.d })
    if (!cabinet) return
    const box = new THREE.Box3().setFromObject(cabinet)
    if (box.isEmpty()) return
    const [vx, vz] = this.localPoint(sb.x, sb.z, sb.yaw, vaseAlong, 0)
    const [bx, bz] = this.localPoint(sb.x, sb.z, sb.yaw, -vaseAlong, 0.02)
    const y = box.max.y - this.fy
    await Promise.all([
      this.model('book_encyclopedia_set_01', bx, bz, sb.yaw + 0.08, { size: 0.20, y }),
      sb.w >= 1.03
        ? this.model('table_lamp_white', vx, vz, sb.yaw, { height: 0.37, y })
        : this.botanical(vx, vz, sb.yaw, y, 0.23),
    ])
  }

  private wallPoint(a: Anchor, depth: number, along = 0) {
    const rx = a.inZ
    const rz = -a.inX
    return {
      x: a.x + rx * along + a.inX * (depth / 2 + 0.008),
      z: a.z + rz * along + a.inZ * (depth / 2 + 0.008),
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

  private async fittedModel(id: string, opts: ModelSize) {
    const g = await placeModel(id, opts)
    if (!g.children.length) return null
    g.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      const mat = o.material as THREE.MeshStandardMaterial
      mat.envMapIntensity = mat.metalness > 0.65 ? 0.56 : 0.3
      this.lib.interiorExtra.add(mat)
    })
    return DECOR_MODELS.has(id) ? decor(g) : g
  }

  private async model(id: string, x: number, z: number, yaw: number, opts: ModelSize & { y?: number } = {}) {
    const g = await this.fittedModel(id, opts)
    return g && this.kit(g, x, z, yaw, opts.y)
  }

  private rug(cx: number, cz: number, w: number, d: number, yaw: number, floor = 0, material = this.lib.rug) {
    const geo = new RoundedBoxGeometry(w, RUG_HEIGHT, d, 1, 0.003)
    const m = new THREE.Mesh(geo, material)
    m.name = 'areaRug'
    m.position.set(cx, this.fy + floor + RUG_HEIGHT / 2, cz)
    m.rotation.y = yaw
    m.receiveShadow = true
    this.group.add(m)
    return { x: cx, z: cz, w, d, yaw }
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

  private ceiling(x: number, z: number) {
    const block = blockAt(this.plan.blocks, x, z)
    return block ? ceilingAt(block, x, z) : 2.7
  }

  private curtains(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const openings = this.roomOpenings(r)
    const glazing = openings.filter(o =>
      o.exterior && ['window', 'fixed', 'slider'].includes(o.kind) && o.width >= 1.05)
    for (const side of this.roomSides(r)) {
      const windows = glazing.filter(o => o.side === side.side).sort((a, b) => a.at - b.at)
      const groups: { lo: number; hi: number; head: number }[] = []
      for (const o of windows) {
        const lo = o.at - o.width / 2
        const hi = o.at + o.width / 2
        const head = o.sill + o.height
        const previous = groups.at(-1)
        const interrupted = previous && openings.some(other => other.side === side.side &&
          ['entry', 'door', 'garage'].includes(other.kind) && other.at > previous.hi && other.at < lo)
        if (previous && !interrupted && lo - previous.hi < 1.10) {
          previous.hi = Math.max(previous.hi, hi)
          previous.head = Math.max(previous.head, head)
        } else {
          groups.push({ lo, hi, head })
        }
      }
      const horizontal = side.inX === 0
      const [lo, hi] = horizontal ? [x0, x1] : [z0, z1]
      const face = { n: z0, s: z1, w: x0, e: x1 }[side.side]
      const yaw = this.yaw(side.inX, side.inZ)
      const point = (u: number): [number, number] => [
        (horizontal ? u : face) + side.inX * 0.058,
        (horizontal ? face : u) + side.inZ * 0.058,
      ]
      for (const window of groups) {
        const stacks = [-1, 1].flatMap(sign => {
          const edge = sign < 0 ? window.lo - 0.10 : window.hi + 0.10
          const maxW = Math.min(0.44, sign < 0 ? edge - lo - 0.025 : hi - edge - 0.025)
          for (const w of [maxW, 0.32, 0.27, 0.22, 0.18, 0.14]) {
            if (w < 0.14 || w > maxW) continue
            const u = edge + sign * w / 2
            const [x, z] = point(u)
            if (this.canPlace(r, x, z, w + 0.02, 0.067, yaw)) return [{ u, w, x, z }]
          }
          return []
        })
        if (!stacks.length) continue
        const start = Math.max(lo + 0.018, Math.min(window.lo - 0.05, ...stacks.map(p => p.u - p.w / 2 - 0.015)))
        const end = Math.min(hi - 0.018, Math.max(window.hi + 0.05, ...stacks.map(p => p.u + p.w / 2 + 0.015)))
        const [x, z] = point((start + end) / 2)
        const ceiling = Math.min(this.ceiling(...point(start)), this.ceiling(...point(end)))
        const highGlass = openings.filter(o => o.side === side.side && o.kind === 'clerestory' &&
          o.at + o.width / 2 > start && o.at - o.width / 2 < end)
        const rod = Math.min(ceiling - 0.045, window.head + 0.36, ...highGlass.map(o => o.sill - 0.05))
        if (rod <= 0.25 || rod < window.head - 0.03) continue
        for (const p of stacks) {
          this.occupy(r, { x: p.x, z: p.z, w: p.w + 0.02, d: 0.067, yaw })
          this.kit(tallCurtain(this.lib, p.w, rod - 0.02), p.x, p.z, yaw, 0.015)
        }
        this.kit(curtainRail(this.lib, end - start), x, z, yaw, rod)
      }
    }
  }

  private artAt(a: Anchor, w: number, h: number, seed: number, y = 1.58, mount = 0, small = false) {
    const g = this.artwork.frame(this.lib, this.plan.id, seed, w, h, small)
    return this.kit(g, a.x + a.inX * (0.014 + mount), a.z + a.inZ * (0.014 + mount), this.yaw(a.inX, a.inZ), y)
  }

  private wallArt(r: RoomDef, seed: number, maxW: number, small = false, omit?: Dir, near?: { x: number; z: number }) {
    const anchors = this.anchors(r)
    if (near) {
      const artSpan = maxW + 0.18
      const distance = (a: Anchor) => Math.hypot(a.x - near.x, a.z - near.z)
      anchors.sort((a, b) => Number(a.len < artSpan) - Number(b.len < artSpan) || distance(a) - distance(b))
    }
    for (const a of anchors) {
      const w = Math.min(maxW, a.len - 0.18)
      if (a.side === omit || w < 0.41) continue
      for (const u of [0, -0.5, 0.5]) {
        if (Math.abs(u) + w / 2 > a.len / 2 - 0.055) continue
        const p = this.wallPoint(a, 0.048, u)
        if (!this.canPlace(r, p.x, p.z, w, 0.048, p.yaw)) continue
        const [x, z] = this.localPoint(a.x, a.z, p.yaw, u, 0)
        return this.artAt({ ...a, x, z }, w, small ? Math.min(0.66, maxW * 0.75) : 0.76, seed, 1.58, 0, small)
      }
    }
  }

  // ------------------------------------------------------------------ rooms

  // Local, unshadowed practicals for the two enclosed rooms that receive little daylight.
  private practical(x: number, y: number, z: number, distance: number, intensity: number) {
    const light = new THREE.PointLight('#FFE0BD', intensity, distance, 2)
    light.position.set(x, this.fy + y, z)
    this.group.add(decor(light))
  }

  private async living(r: RoomDef) {
    if (this.plan.id === 'aspen-custom' && r.id === 'great') return this.livingView(r, true)
    const [x0, z0, x1, z1] = this.inner(r)
    const solid = this.anchors(r)
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
    const mediaD = 0.43
    const mediaW = Math.min(2, a.len - 0.12, wallWidth - 0.2)
    const media = this.fitWidth(r, this.wallPoint(a, mediaD), mediaW, mediaD, 0.9)
    if (!media) return this.livingView(r)

    const opposite: Record<Dir, Dir> = { n: 's', s: 'n', w: 'e', e: 'w' }
    const oppSolid = solid.find(s => s.side === opposite[a.side])
    const oppLow = this.anchors(r, 0.92).find(s => s.side === opposite[a.side])
    const against = depth < 3.85
    const sofaWall = against ? oppSolid ?? oppLow : undefined
    const sofaYaw = this.yaw(-a.inX, -a.inZ)
    const sofaW = Math.min(depth > 5.8 && wallWidth > 5.6 ? 3.0 : 2.65, wallWidth - 0.9)
    const positions = against ? [depth - 0.65, depth - 0.53, depth - 0.82] :
      [Math.min(3.65, depth - 1.56), Math.min(3.3, depth - 1.56), Math.min(2.9, depth - 1.45)]
    const sofaSpots = positions.flatMap(v => SLIDES.map(u => ({
      x: a.x + rx * u + a.inX * v,
      z: a.z + rz * u + a.inZ * v,
      yaw: sofaYaw,
    })))
    const sofaFit = this.fitSofa(r, sofaSpots, sofaW, 1.65, !against)
    if (!sofaFit) return this.livingView(r)
    this.occupy(r, media, true)
    jobs.push(this.stageMediaConsole(media))
    const [panelX, panelZ] = this.localPoint(media.x, media.z, media.yaw, 0, -media.d / 2 - 0.008)
    const panelW = Math.min(a.len - 0.08, media.w + 0.42)
    this.kit(oakSlats(this.lib, panelW, Math.min(2.19, this.ceiling(panelX, panelZ) - 0.07)), panelX, panelZ, media.yaw)
    const sofa = sofaFit.footprint
    this.occupy(r, sofa, true)
    jobs.push(this.stageSofa(sofaFit.id, sofa))

    const sofaU = along(sofa.x, sofa.z)
    const sofaV = into(sofa.x, sofa.z)
    const rugW = Math.min(sofa.w + 1.16, wallWidth - 0.22)
    const rugBack = Math.min(depth - 0.15, sofaV + sofa.d * 0.35)
    const rugD = Math.min(3.12, rugBack - 0.54)
    const rugV = rugBack - rugD / 2
    const rugX = a.x + rx * sofaU + a.inX * rugV
    const rugZ = a.z + rz * sofaU + a.inZ * rugV
    const rugYaw = sofa.yaw
    const compactRugD = Math.min(2.25, sofaV - 0.77)
    const compactRugV = sofaV - compactRugD / 2 + 0.18
    const rug = this.seatingRug(r, rugX, rugZ, rugW, rugD, rugYaw) ??
      this.seatingRug(r, a.x + rx * sofaU + a.inX * compactRugV, a.z + rz * sofaU + a.inZ * compactRugV,
        Math.min(sofa.w + 0.5, wallWidth - 0.25), compactRugD, rugYaw)

    // Keep the table within reach of the sofa, with a clear route around the ends.
    const coffeeV = sofaV - sofa.d / 2 - 0.4 - 0.38
    const coffeeX = a.x + rx * sofaU + a.inX * coffeeV
    const coffeeZ = a.z + rz * sofaU + a.inZ * coffeeV
    if (this.canPlace(r, coffeeX, coffeeZ, 0.76, 0.76, rugYaw)) {
      const f = this.occupy(r, { x: coffeeX, z: coffeeZ, w: 0.76, d: 0.76, yaw: rugYaw }, true)
      jobs.push(this.coffeeTable(f, rug))
    }

    for (const k of [-1, 1]) {
      const u = sofaU + k * (sofa.w / 2 + 0.52)
      const v = rugV + 0.14
      const x = a.x + rx * u + a.inX * v
      const z = a.z + rz * u + a.inZ * v
      const yaw = this.yaw(coffeeX - x, coffeeZ - z)
      const chair = this.loungeSeat(r, x, z, yaw, 0.12)
      if (chair) jobs.push(chair)
    }

    const lampD = 0.48
    for (const k of [-1, 1]) {
      const u = sofaU + k * (sofa.w / 2 + 0.3)
      const v = sofaV - (against ? 0.35 : 0)
      const x = a.x + rx * u + a.inX * v
      const z = a.z + rz * u + a.inZ * v
      if (!this.canPlace(r, x, z, lampD, lampD, rugYaw)) continue
      this.occupy(r, { x, z, w: lampD, d: lampD, yaw: rugYaw })
      jobs.push(this.model('floor_lamp_tripod', x, z, rugYaw, { width: lampD, depth: lampD, height: 1.54 }))
      break
    }

    this.livingEntry(r)
    this.curtains(r)
    jobs.push(this.livingPlant(r, solid))

    if (against && oppSolid && sofaWall === oppSolid) this.artAt(oppSolid, Math.min(1.42, oppSolid.len - 0.13), 0.8, 3)
    else this.wallArt(r, 2, 1.45, false, a.side)
    this.livingBasket(r, sofa, rug)
    await Promise.all(jobs)
  }

  /** A living room without a TV wall (glass all round): a floating seating group facing the main view. */
  private async livingView(r: RoomDef, floatInCenter = false) {
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
    const sofaDist = THREE.MathUtils.clamp(depth * (floatInCenter ? 0.46 : 0.66), 2.4, depth - 0.75)
    const sofaSpots = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2].map(sh => ({
      x: wx + inX * sofaDist + rx * sh,
      z: wz + inZ * sofaDist + rz * sh,
      yaw: faceYaw,
    }))
    const sofaFit = this.fitSofa(r, sofaSpots, Math.min(floatInCenter ? 3.11 : 2.4, width - 0.8), 1.6, true)
    if (!sofaFit) return
    const sofa = sofaFit.footprint
    this.occupy(r, sofa, true)
    const jobs: Promise<unknown>[] = [
      this.stageSofa(sofaFit.id, sofa),
    ]
    const rugD = Math.min(2.95, sofaDist + sofa.d * 0.27 - 0.48)
    const rugW = Math.min(sofa.w + 1.04, width - 0.36)
    const rugX = sofa.x - inX * (rugD / 2 - 0.43)
    const rugZ = sofa.z - inZ * (rugD / 2 - 0.43)
    const compactRugD = Math.min(2.25, sofaDist - 0.3)
    const compactOffset = compactRugD / 2 - 0.25
    const rug = this.seatingRug(r, rugX, rugZ, rugW, rugD, faceYaw) ??
      this.seatingRug(r, sofa.x - inX * compactOffset, sofa.z - inZ * compactOffset, Math.min(2.8, width - 0.6), compactRugD, faceYaw)
    const reach = sofa.d / 2 + 0.4 + 0.38
    const tx = sofa.x - inX * reach
    const tz = sofa.z - inZ * reach
    if (this.canPlace(r, tx, tz, 0.76, 0.76, faceYaw)) {
      const f = this.occupy(r, { x: tx, z: tz, w: 0.76, d: 0.76, yaw: faceYaw }, true)
      jobs.push(this.coffeeTable(f, rug))
    }
    for (const k of [-1, 1]) {
      const x = sofa.x - inX * 1.45 + rx * k * (sofa.w / 2 + 0.32)
      const z = sofa.z - inZ * 1.45 + rz * k * (sofa.w / 2 + 0.32)
      const yaw = this.yaw(tx - x, tz - z)
      const chair = this.loungeSeat(r, x, z, yaw, 0.12)
      if (chair) jobs.push(chair)
    }
    for (const k of [1, -1]) {
      const x = sofa.x + rx * k * (sofa.w / 2 + 0.3)
      const z = sofa.z + rz * k * (sofa.w / 2 + 0.3)
      const w = 0.48
      if (!this.canPlace(r, x, z, w, w, faceYaw)) continue
      this.occupy(r, { x, z, w, d: w, yaw: faceYaw })
      jobs.push(this.model('floor_lamp_tripod', x, z, faceYaw, { width: w, depth: w, height: 1.54 }))
      break
    }
    this.livingEntry(r)
    this.curtains(r)
    jobs.push(this.livingPlant(r, this.anchors(r)))
    this.wallArt(r, 3, 1.38)
    this.livingBasket(r, sofa, rug)
    await Promise.all(jobs)
  }

  private async stageMediaConsole(f: Footprint) {
    const id = this.plan.id === 'coastal-modern' ? 'media_console_oak' : 'modern_wooden_cabinet'
    const height = 0.57
    const console = await this.model(id, f.x, f.z, f.yaw, { width: f.w, depth: f.d, height })
    if (!console) return
    const screen = tv(this.lib, Math.min(1.58, f.w * 0.99))
    screen.position.set(0, height, -0.045)
    console.add(screen)
    if (f.w < 1.72) return
    const [lx, lz] = this.localPoint(f.x, f.z, f.yaw, -f.w * 0.415, 0.095)
    const [bx, bz] = this.localPoint(f.x, f.z, f.yaw, f.w * 0.37, 0.09)
    await Promise.all([
      this.model('table_lamp_white', lx, lz, f.yaw, { height: 0.32, y: height }),
      this.model('book_encyclopedia_set_01', bx, bz, f.yaw + 0.07, { size: 0.17, y: height }),
    ])
  }

  private loungeSeat(r: RoomDef, x: number, z: number, yaw: number, gap: number) {
    const options = this.plan.id === 'coastal-modern'
      ? [{ id: 'SheenChair', w: 0.77, d: 0.54, height: 0.68 }]
      : [{ id: 'modern_arm_chair_01', w: 0.72, d: 0.86, height: 0.89 }, { id: 'SheenChair', w: 0.77, d: 0.54, height: 0.68 }]
    for (const { id, w, d, height } of options) {
      if (!this.canPlace(r, x, z, w, d, yaw, gap)) continue
      this.occupy(r, { x, z, w, d, yaw }, true)
      return this.model(id, x, z, yaw, { width: w, depth: d, height })
    }
  }

  private async stageSofa(id: string, sofa: Footprint) {
    const model = await this.model(id, sofa.x, sofa.z, sofa.yaw, {
      width: sofa.w, depth: sofa.d, height: THREE.MathUtils.clamp(sofa.w * 0.312, 0.73, 0.90),
    })
    if (!model) return
    const sectional = id === 'sectional_grey'
    const heightAt = supportHeight(model)
    const xThrow = sofa.w * 0.26
    const samples = [-0.48, -0.43, -0.38, -0.33, -0.28, -0.23, -0.18, -0.13, -0.08]
      .map(v => ({ z: v * sofa.d, y: heightAt(xThrow, v * sofa.d) ?? 0 }))
    const ridge = samples.reduce((a, b) => b.y > a.y ? b : a)
    const seatZ = (sectional ? 0.02 : 0.20) * sofa.d
    const seatY = heightAt(xThrow, seatZ)
    if (seatY && ridge.y - seatY > 0.16) {
      const rear = (samples.find(sample => sample.y > ridge.y - 0.21)?.z ?? -sofa.d * 0.48) - 0.025
      this.kit(sofaThrow(this.lib, xThrow, ridge, rear, { z: seatZ, y: seatY }, this.accentCloth()),
        sofa.x, sofa.z, sofa.yaw)
    }
    const accentX = -0.06 * sofa.w
    const accentZ = (sectional ? -0.06 : 0.05) * sofa.d
    const accentY = heightAt(accentX, accentZ)
    if (accentY && accentY < ridge.y - 0.13) {
      const [x, z] = this.localPoint(sofa.x, sofa.z, sofa.yaw, accentX, accentZ)
      this.kit(cushion(this.accentCloth(), 0.37, 0.31, 0.13, 0.29, 0.12), x, z, sofa.yaw - 0.12, accentY)
    }
    const u = -0.29
    const v = sectional ? -0.035 : 0.105
    const seat = THREE.MathUtils.clamp(heightAt(u * sofa.w, v * sofa.d) ?? 0.34, 0.34, 0.57)
    const [x, z] = this.localPoint(sofa.x, sofa.z, sofa.yaw, u * sofa.w, v * sofa.d)
    await this.model('throw_pillows_01', x, z, sofa.yaw + 0.16, { width: 0.35, depth: 0.23, height: 0.33, y: seat - 0.018 })
  }

  private accentCloth() {
    return this.plan.id === 'modern-farmhouse' || this.plan.id === 'aspen-custom' ? this.lib.rustLinen : this.lib.oliveLinen
  }

  private async botanical(x: number, z: number, yaw: number, y: number, size: number) {
    const vase = await this.model('ceramic_vase_02', x, z, yaw, { height: size * 0.52, y })
    if (vase) this.kit(eucalyptus(this.lib, size), x, z, yaw, y + size * 0.50)
  }

  private seatingRug(r: RoomDef, x: number, z: number, w: number, d: number, yaw: number, material = this.lib.rug) {
    for (const scale of [1, 0.88, 0.76, 0.64]) {
      if (!this.canPlace(r, x, z, w * scale, d * scale, yaw, 0, { ignoreFurniture: true })) continue
      return this.rug(x, z, w * scale, d * scale, yaw, 0, material)
    }
  }

  private async coffeeTable(f: Footprint, rug: Footprint | undefined) {
    const b = this.bounds(f)
    const rb = rug && this.bounds(rug)
    const y = rb && b[0] >= rb[0] && b[1] >= rb[1] && b[2] <= rb[2] && b[3] <= rb[3] ? RUG_HEIGHT : 0
    const table = await this.model('coffee_table_round_01', f.x, f.z, f.yaw, { size: f.w, y })
    if (!table) return
    const bounds = new THREE.Box3().setFromObject(table)
    const [x, z] = this.localPoint(f.x, f.z, f.yaw, 0.057, 0.018)
    this.kit(coffeeTableDecor(this.lib, f.w, this.plan.id !== 'coastal-modern'), x, z, f.yaw + 0.09, bounds.max.y - this.fy)
    const [vx, vz] = this.localPoint(f.x, f.z, f.yaw, -0.16, -0.095)
    await this.botanical(vx, vz, f.yaw + 0.45, bounds.max.y - this.fy, 0.34)
  }

  private livingBasket(r: RoomDef, sofa: Footprint, rug: Footprint | undefined) {
    const d = 0.35
    const side = sofa.w / 2 + d / 2 + 0.10
    const flanks = [-1, 1].map(sign => {
      const [x, z] = this.localPoint(sofa.x, sofa.z, sofa.yaw, side * sign, -sofa.d * 0.24)
      return { x, z, yaw: sofa.yaw }
    })
    const walls = this.anchors(r).filter(a => a.len >= d + 0.15)
      .flatMap(a => [-1, 1].map(sign => this.wallPoint(a, d, sign * (a.len - d - 0.13) / 2)))
    for (const p of [...flanks, ...walls]) {
      if (!this.canPlace(r, p.x, p.z, d, d, p.yaw, 0.07)) continue
      const [u, v] = rug ? [p.x - rug.x, p.z - rug.z] : [0, 0]
      const onRug = rug && Math.abs(u * Math.cos(rug.yaw) - v * Math.sin(rug.yaw)) < rug.w / 2 &&
        Math.abs(u * Math.sin(rug.yaw) + v * Math.cos(rug.yaw)) < rug.d / 2
      this.kit(basket(this.lib, d * 0.46), p.x, p.z, p.yaw, onRug ? RUG_HEIGHT : 0)
      break
    }
  }

  private livingEntry(r: RoomDef) {
    const door = this.roomOpenings(r).find(o => o.exterior && o.kind === 'entry')
    if (!door) return
    for (const a of this.anchors(r, 0.54)) {
      const p = this.wallPoint(a, 0.29)
      const along = door.side === 'n' || door.side === 's' ? p.x : p.z
      const inRoom = this.roomSides(r).find(s => s.side === door.side)!
      const depth = Math.abs((inRoom.inX ? p.x : p.z) - inRoom.line)
      if (Math.abs(along - door.at) > 1.75 || depth > 1.8) continue
      const w = Math.min(1.05, a.len - 0.11)
      if (w < 0.66 || !this.canPlace(r, p.x, p.z, w, 0.29, p.yaw)) continue
      this.occupy(r, { ...p, w, d: 0.29 }, true)
      this.kit(bench(this.lib, w, 0.29), p.x, p.z, p.yaw)
      break
    }
  }

  private async livingPlant(r: RoomDef, solid: Anchor[], compact = false) {
    const w = compact ? 0.38 : 0.55
    const d = compact ? 0.39 : 0.60
    const useBroadleaf = r.type === 'living' || this.plan.id === 'coastal-modern' || this.plan.id === 'modern-farmhouse'
    const model = compact ? 'potted_plant_04' : useBroadleaf ? 'potted_plant_02' : 'potted_plant_01'
    const fit = { width: w, depth: d, ...(r.type === 'living' ? { height: 1.50 } : {}) }
    for (const a of solid) {
      if (a.len < w + 0.12) continue
      for (const k of [-1, 1]) {
        const p = this.wallPoint(a, d, k * (a.len - w - 0.12) / 2)
        if (!this.canPlace(r, p.x, p.z, w, d, p.yaw, 0.48)) continue
        this.occupy(r, { ...p, w, d }, true)
        await this.model(model, p.x, p.z, p.yaw, fit)
        return
      }
    }
    const [x0, z0, x1, z1] = this.inner(r)
    for (const x of [x0 + 0.48, x1 - 0.48]) {
      for (const z of [z0 + 0.48, z1 - 0.48]) {
        if (!this.canPlace(r, x, z, w, d, 0, 0.64)) continue
        this.occupy(r, { x, z, w, d, yaw: 0 }, true)
        await this.model(model, x, z, 0, fit)
        return
      }
    }
  }

  private async dining(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    let best: { table: Footprint; chairs: Footprint[]; score: number } | undefined
    for (const yaw of [0, Math.PI / 2]) {
      for (const [w, d, count] of [[2.08, 0.92, 3], [1.76, 0.86, 2], [1.48, 0.8, 2]]) {
        for (const u of [0, -0.35, 0.35]) {
          for (const v of SLIDES) {
            const [x, z] = this.localPoint(cx, cz, yaw, u, v)
            if (!this.canPlace(r, x, z, w, d, yaw)) continue
            const table = { x, z, w, d, yaw }
            const chairs: Footprint[] = []
            for (let i = 0; i < count; i++) {
              const along = (i - (count - 1) / 2) * (w / count)
              for (const side of [-1, 1]) {
                const [sx, sz] = this.localPoint(x, z, yaw, along, side * (d / 2 + CHAIR.d / 2 + 0.012))
                chairs.push({ x: sx, z: sz, ...CHAIR, yaw: yaw + (side === 1 ? Math.PI : 0) })
              }
            }
            if (!chairs.every(f => this.canPlace(r, f.x, f.z, f.w, f.d, f.yaw))) continue
            const [left, near, right, far] = chairs.reduce<Rect>((b, chair) => {
              const c = this.bounds(chair)
              return [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])]
            }, this.bounds(table))
            const endAisle = yaw === 0 ? Math.max(left - x0, x1 - right) : Math.max(near - z0, z1 - far)
            const sideAisle = yaw === 0 ? Math.max(near - z0, z1 - far) : Math.max(left - x0, x1 - right)
            const score = Math.min(1.13, endAisle) + Math.min(1.05, sideAisle) + w * 0.48 - Math.hypot(u, v) * 0.4
            if (!best || score > best.score) best = { table, chairs, score }
          }
        }
      }
    }
    if (!best) return
    const { table, chairs } = best
    this.occupy(r, table, true)
    const tableId = this.plan.id === 'modern-farmhouse' ? 'wooden_table_02' : 'dining_table_trestle'
    this.seatingRug(r, table.x, table.z, table.w + 0.68, table.d + 1.48, table.yaw)
    const jobs: Promise<unknown>[] = chairs.map(chair => {
      this.occupy(r, chair, true)
      return this.model('dining_chair_bentwood', chair.x, chair.z, chair.yaw, { width: chair.w, depth: chair.d, height: 0.84 })
    })
    jobs.push(this.model(tableId, table.x, table.z, table.yaw, { width: table.w, depth: table.d, height: 0.75 }))
    const h = this.ceiling(table.x, table.z)
    const drop = Math.max(0.35, h - 1.72)
    const hangDiningLight = () => this.kit(
      diningLight(this.lib, interiorStyle(this.plan.id), table.w, drop, this.quality?.tier === 'low'),
      table.x, table.z, table.yaw, h,
    )
    if (this.plan.id === 'modern-farmhouse') {
      jobs.push(this.fittedModel('dining_linear_pendant', { width: table.w * 0.74, depth: 0.074, height: drop }).then(light => {
        if (!light) return hangDiningLight()
        light.name = 'pendant'
        return this.kit(light, table.x, table.z, table.yaw, h - drop)
      }))
    } else hangDiningLight()
    this.kit(linenRunner(this.lib, table.w * 0.80, 0.31), table.x, table.z, table.yaw, 0.75)
    const [vx, vz] = this.localPoint(table.x, table.z, table.yaw, -table.w * 0.11, 0.005)
    jobs.push(this.botanical(vx, vz, table.yaw, 0.754, 0.46))
    const [bx, bz] = this.localPoint(table.x, table.z, table.yaw, table.w * 0.12, 0.021)
    if (this.plan.id === 'coastal-modern' || this.plan.id === 'aspen-custom') {
      jobs.push(this.model('wooden_bowl_01', bx, bz, table.yaw, { size: 0.24, y: 0.754 }))
    } else this.kit(candleGrouping(this.lib), bx, bz, table.yaw + 0.12, 0.754)

    let sideboard = false
    for (const a of this.anchors(r)) {
      const sb = this.fitSideboard(r, a, Math.min(1.6, a.len - 0.2), 0.8)
      if (!sb || [table, ...chairs].some(f => this.clearance(sb, f) < WALKWAY)) continue
      this.occupy(r, sb, true)
      jobs.push(this.modelSideboard(sb, Math.min(0.35, sb.w * 0.25)))
      this.artAt(a, Math.min(1.2, sb.w * 0.8), 0.68, 23)
      sideboard = true
      break
    }
    if (!sideboard) this.wallArt(r, 5, 1.14)
    await Promise.all(jobs)
  }

  private async kitchen(r: RoomDef) {
    const lib = this.lib
    const style = interiorStyle(this.plan.id)
    const finish = lib[style.kitchen]
    const d = 0.62
    const slots = this.anchors(r, 0.97)
    const windows = this.roomOpenings(r).filter(o => o.exterior && !this.isPassage(o.kind))
    const runs = slots.flatMap(wall => [1, -1].flatMap(sign => {
      const w = Math.min(wall.len - 0.08, 5.2)
      if (w < 2.05) return []
      const run = { ...this.wallPoint(wall, 0.88), w, d: 0.88 }
      if (!this.canPlace(r, run.x, run.z, run.w, run.d, run.yaw)) return []
      const coversWindow = (u: number, span: number, y: number) => {
        const [x, z] = this.localPoint(run.x, run.z, run.yaw, u, 0)
        const along = wall.inX === 0 ? x : z
        return windows.some(o => o.side === wall.side && o.sill < y &&
          Math.abs(o.at - along) < (o.width + span) / 2 + 0.05)
      }
      const fridgeU = sign * (-w / 2 + 0.46)
      if (coversWindow(fridgeU, 0.88, 1.8)) return []
      const ovenU = sign * (-w / 2 + 0.92 + TALL_W / 2)
      const oven = w >= 3.6 && !coversWindow(ovenU, TALL_W, 2.3)
      return [{ run, fridgeU, ovenU, oven, sign, coversWindow, score: w + (oven ? 0.12 : 0) }]
    })).sort((a, b) => b.score - a.score)
    const choice = runs[0]
    if (!choice) return
    const { run, fridgeU, ovenU, oven, sign, coversWindow } = choice
    const { yaw, w } = run
    const jobs: Promise<unknown>[] = []
    this.occupy(r, run, true)
    const place = (g: THREE.Group, u: number, depth: number, y = 0) => {
      const [x, z] = this.localPoint(run.x, run.z, yaw, u, depth - run.d / 2)
      return this.kit(g, x, z, yaw, y)
    }
    const [fridgeX, fridgeZ] = this.localPoint(run.x, run.z, yaw, fridgeU, -0.003)
    jobs.push(this.model('fridge_steel', fridgeX, fridgeZ, yaw, { height: 1.8, width: 0.835, depth: 0.80 }))
    const fridgeHeight = Math.min(2.30, this.ceiling(fridgeX, fridgeZ) - 0.07)
    if (fridgeHeight >= 2.05 && !coversWindow(fridgeU, 0.91, fridgeHeight)) {
      place(fridgeSurround(lib, fridgeHeight), fridgeU, run.d / 2 - 0.02)
    }
    if (oven) {
      jobs.push(this.fittedModel('oven_built_in', { width: TALL_W - 0.004, depth: OVEN_MODEL_DEPTH, height: OVEN_H })
        .then(appliance => place(ovenTower(lib, appliance ?? undefined), ovenU, TALL_D / 2)))
    }
    const baseW = w - 0.92 - (oven ? TALL_W : 0)
    const mid = sign * (w - baseW) / 2
    const backsplash = coversWindow(mid, baseW, 1.5) ? 0.06 : 0.58
    place(baseCabinets(lib, baseW, d, backsplash, finish), mid, d / 2)
    const hoodU = [mid, mid - baseW * 0.24, mid + baseW * 0.24,
      mid - baseW / 2 + 0.47, mid + baseW / 2 - 0.47]
      .find(u => Math.abs(u - mid) + 0.45 <= baseW / 2 && !coversWindow(u, 0.9, 2.65))
    const hobU = hoodU ?? mid
    place(inductionHob(), hobU, d / 2 + 0.02, COUNTER_TOP)
    if (hoodU !== undefined) {
      const [x, z] = this.localPoint(run.x, run.z, yaw, hoodU, -0.18)
      place(rangeHood(lib, 0.9, Math.max(0.3, this.ceiling(x, z) - 1.62), 0.54), hoodU, 0.27, 1.62)
    }
    const worktop = counterProps(mid - baseW / 2, mid + baseW / 2, hobU, HOB.w)
    for (const { kind, x } of worktop) {
      if (kind === 'boards') place(kitchenBoards(lib), x, 0.195, COUNTER_TOP)
      if (kind === 'kettle') place(kettle(lib, style.pendant === 'brass' ? lib.blackMetal : lib.decorCeramic), x, 0.225, COUNTER_TOP)
      if (kind === 'cookbooks') {
        const books = place(bookStack(lib, this.accentCloth()), x, 0.235, COUNTER_TOP)
        books.rotation.y += 0.07
      }
      if (kind === 'herbs') {
        const [px, pz] = this.localPoint(run.x, run.z, yaw, x, 0.21 - run.d / 2)
        jobs.push(this.model('potted_plant_04', px, pz, yaw, { width: 0.156, depth: 0.15, height: 0.21, y: COUNTER_TOP }))
      }
    }
    for (const k of [-1, 1]) {
      const open = k * (mid - hobU) + baseW / 2 - 0.5
      const shelfW = Math.min(1.15, open - 0.04)
      const u = hobU + k * (0.5 + shelfW / 2)
      if (shelfW < 0.57 || coversWindow(u, shelfW, 1.8)) continue
      for (const y of [1.52, 1.82]) {
        if (coversWindow(u, shelfW, y + 0.27)) continue
        place(openShelf(lib, shelfW, 0.28, lib.diffuser), u, 0.14, y)
        const [vx, vz] = this.localPoint(run.x, run.z, yaw, u + k * shelfW * 0.26, 0.14 - run.d / 2)
        jobs.push(this.model('ceramic_vase_02', vx, vz, yaw, { height: y < 1.6 ? 0.14 : 0.18, y: y + 0.036 }))
        if (y < 1.6 && shelfW >= 0.75) {
          const [x, z] = this.localPoint(run.x, run.z, yaw, u - k * shelfW * 0.24, 0.15 - run.d / 2)
          jobs.push(this.model('book_encyclopedia_set_01', x, z, yaw + 0.12, { size: 0.19, y: y + 0.036 }))
        }
      }
    }

    let island: Footprint | undefined
    let stools: Footprint[] = []
    const backedStools = this.plan.id === 'woodland-modern' || this.plan.id === 'aspen-custom'
    const stoolSize = backedStools ? { w: 0.43, d: 0.41 } : STOOL
    search: for (const aisle of [0.95, 0.9]) {
      for (const iw of [2.5, 2.16, 1.78]) {
        if (iw > w) continue
        for (const shift of SLIDES) {
          const id = 0.9
          const [x, z] = this.localPoint(run.x, run.z, yaw, shift, aisle + run.d / 2 + id / 2)
          const f = { x, z, w: iw, d: id, yaw }
          if (!this.canPlace(r, x, z, iw, id, yaw, aisle - 0.008)) continue
          const spots = (iw >= 2.15 ? [-0.6, 0, 0.6] : [-0.3, 0.3]).map(u => {
            const [sx, sz] = this.localPoint(x, z, yaw, u, id / 2 + stoolSize.d / 2 + 0.035)
            return { x: sx, z: sz, ...stoolSize, yaw: yaw + Math.PI }
          })
          if (spots.every(s => this.canPlace(r, s.x, s.z, s.w, s.d, s.yaw))) {
            island = f
            stools = spots
            break search
          }
          island ??= f
        }
      }
    }
    if (island) {
      const f = this.occupy(r, island, true)
      jobs.push(this.fittedModel('kitchen_faucet', { width: 0.118, depth: 0.198, height: 0.32 }).then(tap =>
        this.kit(kitchenIsland(lib, f.w, f.d, true, finish, tap ?? undefined), f.x, f.z, yaw)))
      for (const s of stools) {
        this.occupy(r, s, true)
        jobs.push(this.model(backedStools ? 'stool_counter_back' : 'bar_stool_wood', s.x, s.z, s.yaw, {
          width: s.w, depth: s.d, height: backedStools ? 0.94 : 0.68,
        }))
      }
      const lights = f.w >= 2.15 ? [-1, 0, 1] : [-0.57, 0.57]
      for (const k of lights) {
        const [x, z] = this.localPoint(f.x, f.z, yaw, k * f.w * 0.30, 0)
        const h = this.ceiling(x, z)
        if (h > 2.06 && style.pendant === 'bronze') {
          const shadeHeight = 0.16
          const drop = h - 1.79
          jobs.push(this.fittedModel('pendant_dome', { width: 0.39, depth: 0.39, height: shadeHeight }).then(shade =>
            this.kit(shade ? suspendedDome(lib, drop, shade, shadeHeight) : kitchenPendant(lib, style, drop), x, z, yaw, h)))
        } else if (h > 2.4 && h < 2.99 && style.pendant === 'ivory') {
          jobs.push(this.model('modern_ceiling_lamp_01', x, z, yaw, { width: 0.35, depth: 0.35, height: h - 1.79, y: 1.79 }))
        } else if (h > 2.06) this.kit(kitchenPendant(lib, style, h - 1.79), x, z, yaw, h)
      }
      const [x, z] = this.localPoint(f.x, f.z, yaw, f.w * 0.28, 0.085)
      jobs.push(this.model('wooden_bowl_01', x, z, yaw + 0.18, { size: 0.31, y: ISLAND_TOP }).then(bowl => {
        if (bowl) bowl.add(fruitForBowl(lib, bowl, 0.31, style.pendant !== 'bronze'))
      }))
      const [vx, vz] = this.localPoint(f.x, f.z, yaw, f.w * 0.17, -0.219)
      jobs.push(this.botanical(vx, vz, yaw, ISLAND_TOP, style.pendant === 'brass' ? 0.37 : 0.43))
      if (!worktop.some(prop => prop.kind === 'herbs')) {
        const [hx, hz] = this.localPoint(f.x, f.z, yaw, f.w * 0.08, 0.23)
        jobs.push(this.model('potted_plant_04', hx, hz, yaw, { width: 0.156, depth: 0.15, height: 0.21, y: ISLAND_TOP }))
      }
      if (!worktop.some(prop => prop.kind === 'cookbooks')) {
        const [bx, bz] = this.localPoint(f.x, f.z, yaw, -f.w * 0.18, 0.28)
        this.kit(bookStack(lib, this.accentCloth()), bx, bz, yaw - 0.10, ISLAND_TOP)
      }
    }
    this.wallArt(r, 2, 0.86, true)
    await Promise.all(jobs)
  }

  private async bedroom(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    const primary = r.type === 'primary'
    const lowerSuite = this.plan.id === 'aspen-custom' && (r.id === 'bed5' || r.id === 'bed6')
    const styled = primary || lowerSuite
    const solid = this.anchors(r)
    const walls = this.anchors(r, 0.78)
    const windows = this.roomOpenings(r).filter(o => o.exterior && !this.isPassage(o.kind))
    const depthOf = (a: Anchor) => a.inX > 0 ? x1 - a.x : a.inX < 0 ? a.x - x0 : a.inZ > 0 ? z1 - a.z : a.z - z0
    const door = this.roomOpenings(r).find(o => !o.exterior && this.isPassage(o.kind))
    let best: { wall: Anchor; bed: Footprint; stands: Footprint[]; shift: number; score: number } | undefined
    for (const d of primary ? [2.23, 2.08] : [2.14]) {
      if (best) break
      for (const wall of walls) {
        const depth = depthOf(wall)
        if (depth - d < 0.66) continue
        for (const w of primary ? [1.9, 1.75, 1.6] : [1.62, 1.48, 1.32]) {
          for (const standW of [0.48, 0.39, 0.34]) {
            const tableOffset = w / 2 + 0.055 + standW / 2
            for (const shift of SLIDES) {
              if (Math.abs(shift) + tableOffset + standW / 2 > wall.len / 2) continue
              const bed = { ...this.wallPoint(wall, d, shift), w, d }
              const stands = [-1, 1].map(k => ({
                ...this.wallPoint(wall, 0.4, shift + k * tableOffset),
                w: standW, d: 0.4,
              }))
              if (![bed, ...stands].every(f => this.canPlace(r, f.x, f.z, f.w, f.d, f.yaw))) continue
              const uninterrupted = solid.some(a => a.side === wall.side &&
                Math.abs((a.x - bed.x) * wall.inZ - (a.z - bed.z) * wall.inX) + tableOffset + standW / 2 < a.len / 2)
              const sideGap = wall.inX === 0 ? Math.min(bed.x - x0, x1 - bed.x) - w / 2
                : Math.min(bed.z - z0, z1 - bed.z) - w / 2
              const score = w * 2 + standW + Math.min(1.12, sideGap) * 0.8 +
                Math.min(1.05, depth - d) + (uninterrupted ? 0.75 : 0) +
                (wall.side === 's' || wall.side === 'w' ? 0 : 0.3) -
                (wall.side === door?.side ? 0.4 : 0) - Math.abs(shift) * 0.35
              if (!best || score > best.score) best = { wall, bed, stands, shift, score }
            }
          }
        }
      }
    }
    if (!best) return
    const { wall: a, bed, stands, shift } = best
    const { yaw } = bed
    const jobs: Promise<unknown>[] = []
    this.occupy(r, bed, true)
    const along = a.inX === 0 ? bed.x : bed.z
    const sill = Math.min(Infinity, ...windows.filter(o => o.side === a.side &&
      Math.abs(o.at - along) < (o.width + bed.w) / 2).map(o => o.sill))
    const style = interiorStyle(this.plan.id)
    const accentLinen = style.bedAccent ? this.lib.rustLinen : this.lib.oliveLinen
    jobs.push(this.stageBed(bed, Math.min(0.98, sill - 0.035), primary, styled, accentLinen))
    const hasWindowAbove = (stand: Footprint) => windows.some(o => {
      const pos = a.inX === 0 ? stand.x : stand.z
      return o.side === a.side && o.sill < 1.1 && Math.abs(o.at - pos) < o.width / 2 + 0.15
    })
    const lamp = stands.find(f => !hasWindowAbove(f)) ?? stands[0]
    for (const stand of stands) {
      this.occupy(r, stand, true)
      jobs.push(this.stageNightstand(stand, stand === lamp || (primary && !hasWindowAbove(stand)),
        styled ? (stand === lamp ? 'books' : 'tray') : undefined))
    }

    // Start the rug below the nightstands. For a tight bedroom, use a bedside runner.
    const rugChoices = [[1.18, 2.30], [0.96, 2.12], [0.74, 1.85], [0.42, 1.68], [0.18, 1.45]].flatMap(([extra, d]) =>
      [0.55, 0.42, 0.28, 0.12, -0.05].map(v => ({ w: bed.w + extra, d, u: 0, v })))
    if (lowerSuite) rugChoices.unshift({ w: bed.w + 1.38, d: 2.54, u: 0, v: 0.62 })
    for (const sign of [-1, 1]) {
      rugChoices.push({ w: 0.48, d: 1.15, u: sign * (bed.w / 2 + 0.18), v: 0.28 })
    }
    for (const { w, d, u, v } of rugChoices) {
      const [x, z] = this.localPoint(bed.x, bed.z, yaw, u, v)
      if (!this.canPlace(r, x, z, w, d, yaw, 0, { ignoreFurniture: true })) continue
      this.rug(x, z, w, d, yaw)
      break
    }

    if (primary || lowerSuite) {
      const d = 0.42
      const w = Math.min(1.35, bed.w * 0.78)
      const [x, z] = this.localPoint(bed.x, bed.z, yaw, 0, bed.d / 2 + d / 2 + 0.035)
      const footGap = depthOf(a) - bed.d - d - 0.06
      if (footGap >= 0.72 && this.canPlace(r, x, z, w, d, yaw)) {
        this.occupy(r, { x, z, w, d, yaw }, true)
        jobs.push(this.model('bench_upholstered', x, z, yaw, { width: w, depth: d, height: 0.44 }))
      }
      if (primary) {
        const [fx, fz] = this.localPoint(bed.x, bed.z, yaw, 0, bed.d * 0.28)
        const h = this.ceiling(fx, fz)
        if (h > 2.5) this.kit(ceilingFan(this.lib, style.pendant === 'brass'), fx, fz, yaw, h)
      }
    }
    if ((x1 - x0) * (z1 - z0) >= 19) {
      const walls = solid.filter(wall => wall.side !== a.side && wall.len >= 1.16)
        .map(wall => this.wallPoint(wall, 0.89))
      const corners = [[x0 + 0.55, z0 + 0.55], [x1 - 0.55, z0 + 0.55], [x0 + 0.55, z1 - 0.55], [x1 - 0.55, z1 - 0.55]]
        .map(([x, z]) => ({ x, z }))
      const distance = (p: { x: number; z: number }) => Math.hypot(bed.x - p.x, bed.z - p.z)
      walls.sort((a, b) => distance(a) - distance(b))
      corners.sort((a, b) => distance(b) - distance(a))
      for (const { x, z } of [...walls, ...corners]) {
        const chairYaw = this.yaw(bed.x - x, bed.z - z)
        const chair = this.loungeSeat(r, x, z, chairYaw, 0.73)
        if (!chair) continue
        jobs.push(chair)
        break
      }
    }
    if (primary || (x1 - x0) * (z1 - z0) >= 16) {
      for (const wall of solid) {
        if (wall.side === a.side) continue
        const open = primary && !this.plan.rooms.some(other => other.type === 'closet' && /closet/i.test(other.name))
        const w = open ? Math.min(1.64, wall.len - 0.12) : primary ? 0.9 : Math.min(1.32, wall.len - 0.14)
        const d = open ? WARDROBE_DEPTH : primary ? 0.48 : w / 3
        if (w < 0.88 || wall.len < w + 0.12) continue
        const p = this.wallPoint(wall, d)
        if (!this.canPlace(r, p.x, p.z, w, d, p.yaw, WALKWAY)) continue
        const storage = this.occupy(r, { ...p, w, d }, true)
        if (open) {
          const h = this.wardrobeHeight(p, w)
          if (h >= 2.05) this.kit(openWardrobe(this.lib, w, h), p.x, p.z, p.yaw)
          else jobs.push(this.model('dresser_tall', p.x, p.z, p.yaw, { width: w, depth: d }))
          break
        }
        jobs.push(primary
          ? this.model('dresser_tall', p.x, p.z, p.yaw, { width: w, depth: d })
          : this.modelSideboard(storage, w * 0.26))
        break
      }
    }
    const [artX, artZ] = this.localPoint(a.x, a.z, yaw, shift, 0)
    const artW = primary ? 1.48 : 1.05
    const available = solid.find(w => w.side === a.side &&
      Math.abs((w.x - artX) * a.inZ - (w.z - artZ) * a.inX) + artW / 2 < w.len / 2)
    if (available) {
      const accentW = bed.w + 0.22
      const offset = Math.abs((available.x - artX) * a.inZ - (available.z - artZ) * a.inX)
      const accent = primary && style.bedAccent && offset + accentW / 2 <= available.len / 2
      if (accent) this.kit(oakSlats(this.lib, accentW, 2.14), artX, artZ, yaw)
      this.artAt({ ...a, x: artX, z: artZ }, artW, primary ? 0.79 : 0.65, primary ? 0 : r.id.length + r.id.charCodeAt(r.id.length - 1),
        1.55, accent ? 0.043 : 0)
    } else {
      this.wallArt(r, primary ? 4 : 1, primary ? 1.36 : 1.05, false, a.side, bed)
    }
    this.curtains(r)
    if (primary || (x1 - x0) * (z1 - z0) >= 12.5) jobs.push(this.livingPlant(r, solid, !primary))
    await Promise.all(jobs)
  }

  private async stageBed(f: Footprint, height: number, primary: boolean, styled: boolean, accent: THREE.MeshStandardMaterial) {
    const lightBed = this.plan.id === 'aspen-custom' || (primary && this.plan.id !== 'cedar-ridge')
    const id = lightBed ? 'bed_oak_linen' : 'bed_dark_headboard'
    const model = await this.model(id, f.x, f.z, f.yaw, { width: f.w, depth: f.d, height })
    if (!model) {
      const [x, z] = this.localPoint(f.x, f.z, f.yaw, 0, 0.04)
      const bed = this.kit(platformBed(this.lib, f.w - 0.1, f.d - 0.18, height, accent), x, z, f.yaw)
      if (styled) this.dressBed(bed, f.w - 0.1, f.d - 0.18)
      return
    }
    // The source is an untextured fabric study. Use the studio linens with its authored cloth and pillows.
    const parts: [string, THREE.Material][] = [
      ['queen_bed_Curtins1', this.lib.linen],
      ['queen_bed4_', this.lib.linen],
      ['queen_bed5_', accent],
      ['queen_bed6_', this.lib.linen],
      ['queen_bed7_', this.lib.fabric2],
      ['pCube42143476_', this.lib.fabric2],
      ['pCube42143475_', this.lib.cabinet],
      ['polySurface285047_', this.lib.linen],
    ]
    if (id === 'bed_oak_linen') model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      const part = parts.find(([prefix]) => o.name.startsWith(prefix))
      if (part) o.material = part[1]
    })
    if (styled) this.dressBed(model, f.w, f.d)
  }

  private dressBed(bed: THREE.Group, width: number, depth: number) {
    const heightAt = supportHeight(bed)
    const cloth = this.accentCloth()
    const throwCover = bedThrow(this.lib, width, depth, heightAt, cloth)
    const pillows = [-1, 1].flatMap((side, i) => {
      const x = side * width * (i ? 0.18 : 0.20)
      const z = depth * (i ? -0.223 : -0.238)
      const y = heightAt(x, z + 0.043)
      if (y === undefined) return []
      const pillow = cushion(i ? this.lib.fabric2 : cloth, i ? 0.38 : 0.43, i ? 0.24 : 0.28, 0.12, 0.48, side * 0.09)
      pillow.position.set(x, y - 0.011, z)
      pillow.rotation.y = -side * 0.13
      return [pillow]
    })
    bed.add(throwCover, ...pillows)
  }

  private async stageNightstand(f: Footprint, withLamp: boolean, styling?: 'books' | 'tray') {
    const id = this.plan.id === 'coastal-modern' ? 'nightstand_oak' : 'side_table_01'
    const height = 0.53
    const [stand, accessory] = await Promise.all([
      this.fittedModel(id, { width: f.w, depth: f.d, height }),
      withLamp
        ? this.fittedModel('table_lamp_ceramic', { width: 0.275, depth: 0.18, height: 0.44 })
        : this.fittedModel('book_encyclopedia_set_01', { size: 0.16 }),
    ])
    const table = stand ?? nightstand(this.lib, f.w, withLamp)
    table.name = 'nightstand'
    if (stand && accessory) {
      accessory.position.set(0, height, -0.025)
      table.add(accessory)
    }
    this.kit(table, f.x, f.z, f.yaw)
    if (!styling) return
    const surface = stand ? height : 0.58
    if (styling === 'books') {
      const stack = bookStack(this.lib, this.accentCloth())
      stack.scale.setScalar(0.70)
      stack.rotation.y = -0.08
      stack.position.set(-0.024, surface, 0.126)
      table.add(stack)
    } else {
      const dish = bedsideTray(this.lib, Math.min(0.168, f.w * 0.45))
      dish.position.set(0.014, surface, 0.134)
      dish.rotation.y = 0.10
      table.add(dish)
      if (f.w >= 0.38) {
        const [x, z] = this.localPoint(f.x, f.z, f.yaw, -f.w * 0.31, -0.093)
        await this.botanical(x, z, f.yaw, surface, 0.15)
      }
    }
  }

  private async bath(r: RoomDef, powder: boolean) {
    const walls = this.anchors(r)
    const lib = this.lib
    const style = interiorStyle(this.plan.id)
    const metal = lib[style.metal]
    const tileY = r.floor === 'tile' ? 0.004 : 0
    const primary = r.type === 'bath' && /primary/i.test(r.name)
    const spa = primary || (this.plan.id === 'aspen-custom' && (r.id === 'bath5' || r.id === 'bath6'))
    const candidates = (sizes: number[], d: number, inset: number, slots = walls, screen = false) => slots.flatMap(wall =>
      sizes.flatMap(w => {
        const slack = (wall.len - w) / 2
        if (slack < 0.015) return []
        return [0, -slack + 0.012, slack - 0.012, -slack / 2, slack / 2].flatMap(shift => {
          const p = this.wallPoint(wall, d, shift)
          const f = { ...p, w, d }
          if (!this.canPlace(r, f.x, f.z, f.w, f.d, f.yaw)) return []
          return (screen ? [-1, 1] : [0]).flatMap(side => {
            const open = screen ? showerOpening(w) : Math.min(w, 0.59)
            const [x, z] = this.localPoint(p.x, p.z, p.yaw, -side * (w - open) / 2, d / 2 + inset / 2)
            const access = { x, z, yaw: p.yaw, w: open, d: inset }
            return this.canPlace(r, x, z, access.w, access.d, access.yaw, 0, { ignoreFurniture: true, allowDoorLanding: true })
              ? [{ f, access, side }] : []
          })
        })
      }))
    const fixture = r.furnish?.bath
    const toilets = !fixture || fixture === 'toilet' ? candidates([0.439], 0.623, 0.53) : [null]
    const [x0, z0, x1, z1] = this.inner(r)
    const narrow = Math.min(x1 - x0, z1 - z0) < 1.45
    const vanityWidths = powder ? [0.68, 0.55] : narrow ? [0.75, 0.63, 0.55] :
      primary ? [1.84, 1.64, 1.43, 1.12, 0.99, 0.85, 0.68] : [1.12, 0.99, 0.85, 0.68]
    const vanities = !fixture || fixture === 'vanity'
      ? candidates(vanityWidths, powder || narrow ? 0.37 : 0.46, powder ? 0.44 : 0.55)
      : [null]
    const showers = !powder && (!fixture || fixture === 'shower')
      ? candidates(narrow ? [1.02, 0.88, 0.80] : [1.38, 1.19, 1.02, 0.88], 0.83, 0.47, walls, true) : [null]
    const tubs = primary && !fixture && Math.min(x1 - x0, z1 - z0) >= 2.65
      ? candidates([1.68], 0.86, 0.50, this.anchors(r, 0.83)) : []
    type Fit = NonNullable<typeof vanities[number]>
    let best: { vanity: Fit | null; toilet: Fit | null; shower: Fit | null; tub?: Fit; score: number } | undefined
    const conflicts = (a: Fit, b: Fit) =>
      this.clearance(a.f, b.f) < 0.028 || this.clearance(a.access, b.f) < -FIT_EPSILON ||
      this.clearance(b.access, a.f) < -FIT_EPSILON
    for (const vanity of vanities) {
      for (const toilet of toilets) {
        if (vanity && toilet && conflicts(vanity, toilet)) continue
        for (const shower of showers) {
          if (shower && ((vanity && conflicts(shower, vanity)) || (toilet && conflicts(shower, toilet)))) continue
          const score = (vanity?.f.w ?? 0) * 1.25 + (shower?.f.w ?? 0) +
            Math.min(0.7, vanity && toilet ? this.clearance(vanity.f, toilet.f) : 0) * 0.45 +
            Math.min(0.6, vanity && shower ? this.clearance(vanity.f, shower.f) : 0) * 0.3
          if (best && score + (tubs.length ? 1.55 : 0) <= best.score) continue
          const tub = tubs.find(t => [vanity, toilet, shower].every(f => !f || !conflicts(t, f)))
          const total = score + (tub ? 1.55 : 0)
          if (!best || total > best.score) best = { vanity, toilet, shower, tub, score: total }
        }
      }
    }
    if (!best) return

    const { vanity, toilet, shower, tub } = best
    if (primary) {
      const cx = (x0 + x1) / 2
      const cz = (z0 + z1) / 2
      const radius = Math.min(3.15, Math.hypot(x1 - x0, z1 - z0) / 2 + 0.62)
      this.practical(cx, Math.min(2.05, this.ceiling(cx, cz) - 0.18), cz, radius, 6.4)
    }
    const jobs: Promise<unknown>[] = []
    const v = vanity && this.occupy(r, vanity.f, true)
    if (v) {
      const [x, z] = this.localPoint(v.x, v.z, v.yaw, 0, -v.d / 2)
      const sectionHeight = Math.min(2.13, this.ceiling(x, z) - 0.06)
      this.kit(stoneWall(lib, v.w, sectionHeight), x, z, v.yaw, tileY)
      const basins = v.w >= 1.43 ? 2 : 1
      const vesselSize = { width: Math.min(v.w / basins * 0.68, 0.47), depth: v.d * 0.57, height: 0.105 }
      jobs.push(Promise.all(Array.from({ length: basins }, () => this.fittedModel('vessel_sink_white', vesselSize)))
        .then(vessels => this.kit(vanityParts(lib, v.w, v.d, !primary && style.pendant === 'brass', metal, vessels), x, z, v.yaw, tileY)))
      const sideSpace = (v.w / basins - vesselSize.width) / 2
      const [vx, vz] = this.localPoint(x, z, v.yaw, -v.w / 2 + sideSpace / 2, v.d * 0.43)
      if (sideSpace >= 0.092) jobs.push(this.botanical(vx, vz, v.yaw, tileY + 0.863, Math.min(spa ? 0.28 : 0.18, sideSpace * 1.9)))
      const wide = v.w >= 1.38
      if (basins === 2 || sideSpace >= 0.10) {
        const u = basins === 2 ? 0 : v.w / 2 - sideSpace / 2
        const [tx, tz] = this.localPoint(x, z, v.yaw, u, v.d * 0.67)
        this.kit(bathCounterDecor(lib, basins === 2, spa), tx, tz, v.yaw, tileY + 0.863)
      }
      if (primary && wide) {
        const [lx, lz] = this.localPoint(x, z, v.yaw, 0, v.d * 0.65)
        this.practical(lx, tileY + 0.258, lz, 0.80, 0.58)
      }
    }
    if (toilet) {
      const t = this.occupy(r, toilet.f, true)
      jobs.push(this.model('toilet_modern', t.x, t.z, t.yaw, { height: 0.776, width: t.w, depth: t.d, y: tileY }))
    }
    if (shower) {
      const f = this.occupy(r, shower.f)
      const [x, z] = this.localPoint(f.x, f.z, f.yaw, 0, -f.d / 2)
      const height = Math.min(2.28, this.ceiling(f.x, f.z) - 0.04)
      jobs.push(this.fittedModel('shower_black', { width: 0.38, depth: SHOWER_HARDWARE_DEPTH, height: SHOWER_HARDWARE_HEIGHT })
        .then(hardware => this.kit(showerParts(lib, f.w, f.d, metal, shower.side, height, hardware ?? undefined), x, z, f.yaw, tileY)))
      const [sx, sz] = this.localPoint(x, z, f.yaw, -f.w * 0.27, 0.086)
      this.kit(bathCounterDecor(lib, false), sx, sz, f.yaw, tileY + 1.277)
      const open = showerOpening(f.w)
      const [ax, az] = this.localPoint(x, z, f.yaw, shower.side * (open - f.w / 2), f.d - 0.013)
      const [bx, bz] = this.localPoint(x, z, f.yaw, shower.side * (f.w / 2 - 0.013), f.d - 0.013)
      const [cx, cz] = this.localPoint(x, z, f.yaw, shower.side * (f.w / 2 - 0.013), 0.025)
      this.colliders.push({ ax, az, bx, bz }, { ax: bx, az: bz, bx: cx, bz: cz })
    }
    if (tub) {
      const f = this.occupy(r, tub.f, true)
      const width = f.w - 0.02
      const depth = f.d - 0.035
      jobs.push(this.model('bath_angelo', f.x, f.z, f.yaw, { width, depth, height: 0.56, y: tileY }).then(bath => {
        const bathtub = bath ?? this.kit(ovalTub(lib), f.x, f.z, f.yaw, tileY)
        const caddy = bathCaddy(lib, bathtub, width, depth)
        if (caddy) bathtub.add(caddy)
      }))
      const [x, z] = this.localPoint(f.x, f.z, f.yaw, -f.w * 0.34, -0.39)
      this.kit(plumbingArc(lib, 0.81, 0.29, metal), x, z, f.yaw, tileY)
    }

    let towel: Dir | undefined
    const railW = 0.46
    for (const wall of walls) {
      if (wall.len < railW + 0.045) continue
      const reach = wall.len / 2 - railW / 2 - 0.02
      for (const along of [0, -reach, reach]) {
        const p = this.wallPoint(wall, 0.075, along)
        if (!this.canPlace(r, p.x, p.z, railW, 0.075, p.yaw)) continue
        this.kit(towelRail(lib, railW, spa ? hungTowel(lib, railW * 0.78, 0.35, 0.033) : undefined),
          p.x, p.z, p.yaw, tileY + 1.22)
        towel = wall.side
        break
      }
      if (towel) break
    }
    if (!towel && v) {
      const [x, z] = this.localPoint(v.x, v.z, v.yaw, 0, v.d / 2)
      this.kit(towelRail(lib, 0.3, spa ? hungTowel(lib, 0.23, 0.35, 0.033) : undefined),
        x, z, v.yaw, tileY + 0.7)
    }
    mats: for (const wash of [v, tub?.f]) {
      if (!wash) continue
      const matW = Math.min(wash.w * 0.86, 1.06)
      for (const d of [0.57, 0.42]) {
        const [x, z] = this.localPoint(wash.x, wash.z, wash.yaw, 0, wash.d / 2 + d / 2 + 0.075)
        if (!this.canPlace(r, x, z, matW, d, wash.yaw)) continue
        this.rug(x, z, matW, d, wash.yaw, tileY, lib.wovenMat)
        break mats
      }
    }
    if (primary || powder) this.wallArt(r, primary ? 0 : 1, primary ? 0.89 : 0.51, true, towel)
    await Promise.all(jobs)
  }

  private async office(r: RoomDef) {
    const solid = this.anchors(r)
    const [x0, z0, x1, z1] = this.inner(r)
    const area = (x1 - x0) * (z1 - z0)
    const spacious = area >= 19
    const windows = this.roomOpenings(r).filter(o => o.exterior && o.sill >= 0.79)
    const windowWalls = this.anchors(r, 0.79).filter(a =>
      windows.some(o => o.side === a.side && Math.abs(o.at - (a.inX === 0 ? a.x : a.z)) < a.len / 2))
    let desk: Footprint | undefined
    let chair: Footprint | undefined
    search: for (const wall of [...windowWalls, ...solid]) {
      for (const w of spacious ? [1.68, 1.38, 1.19, 1.02] : [1.38, 1.19, 1.02]) {
        for (const shift of SLIDES) {
          if (w + 2 * Math.abs(shift) > wall.len) continue
          const behind = windowWalls.includes(wall) ? 0 : 0.64
          const p = this.wallPoint(wall, 0.59 + behind * 2, shift)
          const d = 0.59
          const [x, z] = this.localPoint(p.x, p.z, p.yaw, 0, behind ? -0.58 : 0.61)
          const yaw = p.yaw + (behind ? 0 : Math.PI)
          if (!this.canPlace(r, p.x, p.z, w, d, p.yaw) || !this.canPlace(r, x, z, CHAIR.w, CHAIR.d, yaw)) continue
          desk = { ...p, w, d }
          chair = { x, z, yaw, ...CHAIR }
          break search
        }
      }
    }
    if (!desk || !chair) return
    const { x, z, yaw, w, d } = desk
    this.occupy(r, desk, true)
    this.occupy(r, chair, true)
    const chairInFront = (chair.x - x) * Math.sin(yaw) + (chair.z - z) * Math.cos(yaw) > 0
    const [rugX, rugZ] = this.localPoint(x, z, yaw, 0, chairInFront ? 0.43 : 0.08)
    const rugDepth = chairInFront ? 1.42 : spacious ? 1.87 : 1.64
    this.seatingRug(r, rugX, rugZ, w + 0.56, rugDepth, yaw, this.lib.wovenMat)
    const [lx, lz] = this.localPoint(x, z, yaw, -w * 0.29, 0.08)
    const [bx, bz] = this.localPoint(x, z, yaw, w * 0.28, -0.06)
    const jobs: Promise<unknown>[] = [
      this.model('desk_wood', x, z, yaw + (chairInFront ? 0 : Math.PI), { width: w, depth: d, height: 0.76 }),
      this.model('book_encyclopedia_set_01', bx, bz, yaw + 0.08, { size: 0.22, y: 0.76 }),
      this.model('dining_chair_bentwood', chair.x, chair.z, chair.yaw, { width: chair.w, depth: chair.d, height: 0.84 }),
      this.model('desk_lamp_black', lx, lz, yaw, { height: 0.43, y: 0.76 }),
    ]
    let art = false
    if (area >= 15) {
      for (const wall of solid) {
        const storage = this.fitSideboard(r, wall, Math.min(1.44, wall.len - 0.16), 0.88)
        if (!storage || [desk, chair].some(f => this.clearance(f, storage) < WALKWAY)) continue
        this.occupy(r, storage, true)
        jobs.push(this.modelSideboard(storage, storage.w * 0.25))
        this.artAt(wall, Math.min(0.92, storage.w * 0.75), 0.65, 31)
        art = true
        break
      }
    }
    if (spacious) {
      const farWalls = [...solid].sort((a, b) => Math.hypot(b.x - x, b.z - z) - Math.hypot(a.x - x, a.z - z))
      const seats = [{ x: (x0 + x1) / 2, z: (z0 + z1) / 2 },
        ...farWalls.filter(wall => wall.len >= 1.1).map(wall => this.wallPoint(wall, 0.9))]
      for (const seat of seats) {
        const lounge = this.loungeSeat(r, seat.x, seat.z, this.yaw(x - seat.x, z - seat.z), 0.72)
        if (!lounge) continue
        jobs.push(lounge)
        break
      }
    }
    if (!art || spacious) this.wallArt(r, 1, spacious ? 1.30 : 0.92, false, undefined, desk)
    jobs.push(this.livingPlant(r, solid, true))
    await Promise.all(jobs)
  }

  private async laundry(r: RoomDef) {
    for (const a of this.anchors(r, 0.99)) {
      const w = 1.38
      const d = 0.66
      const p = this.wallPoint(a, d)
      if (a.len < w || !this.canPlace(r, p.x, p.z, w, d, p.yaw)) continue
      this.occupy(r, { ...p, w, d }, true)
      const fy = this.fy + (r.floor === 'tile' ? 0.004 : 0)
      const appliances = [-0.35, 0.35].map(k => {
        const [x, z] = this.localPoint(p.x, p.z, p.yaw, k, 0)
        return this.model('washer_front_load', x, z, p.yaw, { width: 0.66, depth: 0.62, height: 0.88, y: fy - this.fy })
      })
      this.box(this.lib.counter, p.x, fy + 0.89, p.z, w, 0.038, d, p.yaw, 0.006)
      const [x, z] = this.localPoint(p.x, p.z, p.yaw, 0.38, -0.07)
      this.kit(bathCounterDecor(this.lib, true), x, z, p.yaw, fy - this.fy + 0.928)
      await Promise.all(appliances)
      return
    }
  }

  private async gym(r: RoomDef) {
    const walls = this.anchors(r, 1.44)
    for (const wall of walls) {
      const w = 0.82
      const d = 1.72
      const p = this.wallPoint(wall, d + 0.10)
      if (wall.len < w + 0.25 || !this.canPlace(r, p.x, p.z, w, d, p.yaw, 0.12)) continue
      const [x, z] = this.localPoint(p.x, p.z, p.yaw, 0, d / 2 + 0.49)
      if (!this.canPlace(r, x, z, 0.92, 0.96, p.yaw)) continue
      this.occupy(r, { ...p, w, d }, true)
      const mat = this.seatingRug(r, p.x, p.z, w + 0.14, d + 0.10, p.yaw, this.lib.wovenMat)
      const y = mat && mat.w >= w && mat.d >= d ? RUG_HEIGHT : 0
      this.wallArt(r, 5, 1.02, false, wall.side)
      await Promise.all([
        this.model('treadmill_gym', p.x, p.z, p.yaw + Math.PI, { width: w, depth: d, height: 1.35, y }),
        this.livingPlant(r, walls, true),
      ])
      return
    }
  }

  private wardrobeHeight(f: Pick<Footprint, 'x' | 'z' | 'yaw'>, w: number) {
    const heights = [-1, 0, 1].map(k => {
      const [x, z] = this.localPoint(f.x, f.z, f.yaw, k * w / 2, -WARDROBE_DEPTH / 2)
      return this.ceiling(x, z)
    })
    return Math.min(2.31, ...heights.map(h => h - 0.075))
  }

  private closet(r: RoomDef) {
    const d = WARDROBE_DEPTH
    const [x0, z0, x1, z1] = this.inner(r)
    const runs: Anchor[] = []
    for (const a of this.anchors(r)) {
      if (runs.length && (runs[0].side === a.side || runs[0].inX * a.inX + runs[0].inZ * a.inZ !== -1)) continue
      const roomDepth = a.inX ? x1 - x0 : z1 - z0
      if (roomDepth - (runs.length + 1) * d < 0.76) continue
      const w = Math.min(a.len - 0.08, 3.34)
      const shifts = [0, (a.len - w) / 2 - 0.035, -(a.len - w) / 2 + 0.035]
      const f = shifts.map(shift => this.fitWidth(r, this.wallPoint(a, d, shift), w, d, 0.66)).find(p => p)
      if (!f) continue
      const h = this.wardrobeHeight(f, f.w)
      if (h < 2.05) continue
      this.occupy(r, f, true)
      this.kit(openWardrobe(this.lib, f.w, h), f.x, f.z, f.yaw)
      runs.push(a)
      if (runs.length === 2) break
    }
    if (runs.length && (r.id === 'closet' || r.id === 'primary-closet')) {
      const cx = (x0 + x1) / 2
      const cz = (z0 + z1) / 2
      this.practical(cx, 1.60, cz, 1.46, 2.6)
      const alongX = x1 - x0 > z1 - z0
      const w = Math.min(0.72, (alongX ? z1 - z0 : x1 - x0) - runs.length * d - 0.12)
      const len = Math.min(2.45, (alongX ? x1 - x0 : z1 - z0) - 0.30)
      const yaw = alongX ? Math.PI / 2 : 0
      if (w >= 0.52 && this.canPlace(r, cx, cz, w, len, yaw, 0.04)) {
        this.rug(cx, cz, w, len, yaw)
        const aisle = (alongX ? z1 - z0 : x1 - x0) - runs.length * d
        if (runs.length === 2 && aisle >= 1.84 && this.canPlace(r, cx, cz, 0.96, 0.42, yaw + Math.PI / 2, 0.70)) {
          this.occupy(r, { x: cx, z: cz, w: 0.96, d: 0.42, yaw: yaw + Math.PI / 2 }, true)
          this.kit(linenBench(this.lib, 0.96), cx, cz, yaw + Math.PI / 2, RUG_HEIGHT)
        }
      }
    }
  }

  private async entry(r: RoomDef) {
    const [x0, z0, x1, z1] = this.inner(r)
    for (const a of this.anchors(r, 0.92)) {
      const depth = a.inX ? x1 - x0 : z1 - z0
      for (const along of SLIDES) {
        const w = Math.min(1.4, a.len - 0.14 - 2 * Math.abs(along))
        if (w < 0.65) continue
        if (r.type === 'entry' && depth > 1.66) {
          const d = w * (39.99 / 119.989)
          const p = this.wallPoint(a, d, along)
          if (this.canPlace(r, p.x, p.z, w, d, p.yaw)) {
            const sb = this.occupy(r, { ...p, w, d }, true)
            const [x, z] = this.localPoint(a.x, a.z, p.yaw, along, 0)
            if (this.anchors(r).some(s => s.side === a.side && Math.hypot(s.x - x, s.z - z) + w * 0.36 < s.len / 2)) {
              this.artAt({ ...a, x, z }, Math.min(0.92, w * 0.78), 0.66, 29)
            }
            return this.modelSideboard(sb, w * 0.27)
          }
        }
        const d = depth >= 1.25 ? 0.31 : 0.25
        if (depth - d < WALKWAY - 0.03) continue
        const p = this.wallPoint(a, d, along)
        if (!this.canPlace(r, p.x, p.z, w, d, p.yaw)) continue
        this.occupy(r, { ...p, w, d }, true)
        this.kit(bench(this.lib, w, d), p.x, p.z, p.yaw)
        this.wallArt(r, 2, 0.75)
        return
      }
    }
    // In a narrow hallway the wall can carry a picture while the floor stays clear.
    if (r.type === 'hall') this.wallArt(r, 29, 0.62)
  }

  dispose() {
    this.artwork.dispose()
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.geometry.dispose()
    })
  }
}
