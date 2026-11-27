import * as THREE from 'three'
import { applyMatrixKeepWinding, GeoBuilder, MeshBatch, V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import type { WallCutaway } from './cutaway'
import { buildInteriorDoor } from './interiorDoor'
import { subtractRect } from './levels'
import { blockAt, ceilingAt, INT_WALL_T, sideIntervals, sidePoint, SIDES, WALL_T } from './massing'
import type { BuiltDoor, HomePlan, Rect } from './types'
import { partitionShape, type Segment2 } from './walls'

export interface InteriorShellOutput {
  colliders: Segment2[]
  doors: BuiltDoor[]
}

/** Partition walls (with door openings), floors, tile floors and baseboards. */
export function buildInteriorShell(plan: HomePlan, lib: MaterialLibrary, batch: MeshBatch, floorCuts: Rect[] = [], cutaway?: WallCutaway): InteriorShellOutput {
  const out: InteriorShellOutput = { colliders: [], doors: [] }
  const fy = plan.floorY
  const ceil = (x: number, z: number) => {
    const b = blockAt(plan.blocks, x, z)
    return fy + (b ? ceilingAt(b, x, z) : 2.7)
  }

  for (const w of plan.walls) {
    const t = w.thickness ?? INT_WALL_T
    const [ax, az] = w.a
    const [bx, bz] = w.b
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 0.05) continue
    const dx = (bx - ax) / len
    const dz = (bz - az) / len
    // local frame: u along wall, y up, w across (centered)
    const m = new THREE.Matrix4().set(dx, 0, -dz, ax, 0, 1, 0, 0, dz, 0, dx, az, 0, 0, 0, 1)
    const doors = plan.openings
      .filter(o => o.wall === w.id)
      .map(o => ({ u0: o.at - o.width / 2, u1: o.at + o.width / 2, y0: fy, y1: fy + o.height, o, openingIndex: plan.openings.indexOf(o) }))
      .sort((a, b) => a.u0 - b.u0)
    const build = () => {
      const shape = partitionShape(0, len, fy, u => ceil(ax + dx * u, az + dz * u) - 0.002, doors)
      const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false })
      g.translate(0, 0, -t / 2)
      batch.add(lib.wall, applyMatrixKeepWinding(g, m))
      // casings, door leaves, collisions
      const trim = new GeoBuilder()
      const leaf = new GeoBuilder()
      const hardware = new GeoBuilder()
      let u = 0
      for (const d of doors) {
        if (d.u0 - u > 0.02) out.colliders.push(seg(ax, az, dx, dz, u, d.u0))
        u = d.u1
        out.colliders.push(buildInteriorDoor(plan, { op: d.o, u0: d.u0, u1: d.u1, y1: d.y1 }, m, t, trim, leaf, hardware))
        out.doors.push({ openingIndex: d.openingIndex, kind: d.o.kind, leaf: true, glass: false, casing: true })
      }
      if (len - u > 0.02) out.colliders.push(seg(ax, az, dx, dz, u, len))
      if (trim.vertexCount) batch.add(lib.ceiling, applyMatrixKeepWinding(trim.build(), m))
      if (leaf.vertexCount) batch.add(lib.cabinet, applyMatrixKeepWinding(leaf.build(), m))
      if (hardware.vertexCount) batch.add(lib.blackMetal, applyMatrixKeepWinding(hardware.build(), m))
      cutaway?.cap(m, 0, len, -t / 2, t / 2, doors)
    }
    if (cutaway) cutaway.wall((ax + bx) / 2, (az + bz) / 2, -dz, dx, true, build)
    else build()
  }

  // floors
  for (const b of plan.blocks) {
    const gb = new GeoBuilder()
    const [x0, z0, x1, z1] = b.rect
    const floor: Rect = [x0 + 0.01, z0 + 0.01, x1 - 0.01, z1 - 0.01]
    for (const [a, c, d, e] of floorCuts.reduce((pieces, cut) => pieces.flatMap(r => subtractRect(r, cut)), [floor]))
      gb.quad(V3(a, fy, e), V3(d, fy, e), V3(d, fy, c), V3(a, fy, c))
    batch.add(b.utility ? lib.concrete : lib.floor, gb.build())
  }
  for (const r of plan.rooms) {
    if (r.floor !== 'tile') continue
    const gb = new GeoBuilder()
    const y = fy + 0.004
    for (const [x0, z0, x1, z1] of floorCuts.reduce((pieces, cut) => pieces.flatMap(rect => subtractRect(rect, cut)), [r.rect]))
      gb.quad(V3(x0, y, z1), V3(x1, y, z1), V3(x1, y, z0), V3(x0, y, z0))
    batch.add(lib.tileFloor, gb.build())
  }

  // baseboards along the inside of exterior walls and both faces of partitions
  const base = new GeoBuilder()
  const bh = 0.075
  const bt = 0.012
  for (const b of plan.blocks) {
    if (b.utility) continue
    for (const s of SIDES) {
      const { frame: f, intervals } = sideIntervals(b, s, plan.blocks)
      const cuts = plan.openings
        .filter(o => o.block === b.id && o.side === s && (o.sill ?? 0) < 0.1)
        .map(o => [o.at - o.width / 2, o.at + o.width / 2] as [number, number])
      for (const iv of intervals) {
        if (iv.neighbour) continue
        // runs between door cuts, kept clear of the corners
        const runs: [number, number][] = []
        let u = iv.u0 + WALL_T
        for (const [c0, c1] of cuts.sort((a, c) => a[0] - c[0])) {
          if (c1 < u || c0 > iv.u1) continue
          if (c0 > u) runs.push([u, c0])
          u = Math.max(u, c1)
        }
        if (iv.u1 - WALL_T > u) runs.push([u, iv.u1 - WALL_T])
        for (const [r0, r1] of runs) {
          const [ax, az] = sidePoint(f, r0, WALL_T)
          const [bx, bz] = sidePoint(f, r1, WALL_T + bt)
          base.box(Math.min(ax, bx), fy, Math.min(az, bz), Math.max(ax, bx), fy + bh, Math.max(az, bz))
        }
      }
    }
  }
  batch.add(lib.ceiling, base.build())
  return out
}

function seg(ax: number, az: number, dx: number, dz: number, u0: number, u1: number): Segment2 {
  return { ax: ax + dx * u0, az: az + dz * u0, bx: ax + dx * u1, bz: az + dz * u1 }
}
