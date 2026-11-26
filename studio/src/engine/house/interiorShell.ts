import * as THREE from 'three'
import { applyMatrixKeepWinding, GeoBuilder, MeshBatch, V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { blockAt, ceilingAt, INT_WALL_T, sideIntervals, sidePoint, SIDES, WALL_T } from './massing'
import type { HomePlan } from './types'
import type { Segment2 } from './walls'

export interface InteriorShellOutput {
  colliders: Segment2[]
}

/** Partition walls (with door openings), floors, tile floors and baseboards. */
export function buildInteriorShell(plan: HomePlan, lib: MaterialLibrary, batch: MeshBatch): InteriorShellOutput {
  const out: InteriorShellOutput = { colliders: [] }
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
      .map(o => ({ u0: o.at - o.width / 2, u1: o.at + o.width / 2, y1: fy + o.height, o }))
      .sort((a, b) => a.u0 - b.u0)
    // outline with a sampled top that follows vaulted ceilings
    const shape = new THREE.Shape()
    shape.moveTo(0, fy)
    shape.lineTo(len, fy)
    const steps = Math.max(1, Math.ceil(len / 0.25))
    for (let i = steps; i >= 0; i--) {
      const u = (i / steps) * len
      shape.lineTo(u, ceil(ax + dx * u, az + dz * u) - 0.002)
    }
    shape.closePath()
    for (const d of doors) {
      const p = new THREE.Path()
      p.moveTo(d.u0, fy - 0.01)
      p.lineTo(d.u0, d.y1)
      p.lineTo(d.u1, d.y1)
      p.lineTo(d.u1, fy - 0.01)
      p.closePath()
      shape.holes.push(p)
    }
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
      const cw = 0.065
      for (const side of [-1, 1]) {
        const w0 = side * (t / 2)
        const w1 = side * (t / 2 + 0.014)
        const lo = Math.min(w0, w1)
        const hi = Math.max(w0, w1)
        trim.box(d.u0 - cw, fy, lo, d.u0, d.y1 + cw, hi)
        trim.box(d.u1, fy, lo, d.u1 + cw, d.y1 + cw, hi)
        trim.box(d.u0, d.y1, lo, d.u1, d.y1 + cw, hi)
      }
      // jamb liners
      trim.box(d.u0 - 0.004, fy, -t / 2, d.u0, d.y1, t / 2)
      trim.box(d.u1, fy, -t / 2, d.u1 + 0.004, d.y1, t / 2)
      trim.box(d.u0, d.y1, -t / 2, d.u1, d.y1 + 0.004, t / 2)
      // Swing into the larger room, defaulting to +w unless both sides can be compared.
      const sideRooms = [1, -1].map(side => {
        const x = ax + dx * d.o.at - dz * side * 0.6
        const z = az + dz * d.o.at + dx * side * 0.6
        return plan.rooms.find(r => x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3])
      })
      let swing = 1
      const [plusRoom, minusRoom] = sideRooms
      if (plusRoom && minusRoom) {
        const plusArea = (plusRoom.rect[2] - plusRoom.rect[0]) * (plusRoom.rect[3] - plusRoom.rect[1])
        const minusArea = (minusRoom.rect[2] - minusRoom.rect[0]) * (minusRoom.rect[3] - minusRoom.rect[1])
        if (minusArea > plusArea) swing = -1
      }
      // open door leaf, hinged at u0, swung 92 degrees into the larger room
      const lw = d.u1 - d.u0 - 0.01
      const bottom = fy + 0.01
      const top = d.y1 - 0.003
      const ang = THREE.MathUtils.degToRad(92)
      const yaw = -swing * ang
      const along = V3(Math.cos(ang), 0, swing * Math.sin(ang))
      const normal = V3(-swing * Math.sin(ang), 0, Math.cos(ang))
      const hinge = V3(d.u0 + 0.02, bottom, swing * t / 2)
      const tip = hinge.clone().addScaledVector(along, lw)
      const c = hinge.clone().addScaledVector(along, lw / 2)
      c.y = (bottom + top) / 2
      leaf.orientedBox(c, lw / 2, (top - bottom) / 2, 0.02, yaw)
      // lever handles and roses on both faces, 65 mm in from the latch edge
      const handle = hinge.clone().addScaledVector(along, lw - 0.065)
      handle.y = fy + 1
      for (const face of [-1, 1]) {
        const rose = handle.clone().addScaledVector(normal, face * 0.024)
        hardware.orientedBox(rose, 0.024, 0.024, 0.004, yaw)
        const lever = handle.clone().addScaledVector(normal, face * 0.034).addScaledVector(along, -0.065)
        hardware.orientedBox(lever, 0.065, 0.009, 0.007, yaw)
      }
      for (const y of [bottom + 0.2, (bottom + top) / 2, top - 0.2]) {
        const knuckle = hinge.clone()
        knuckle.y = y
        hardware.orientedBox(knuckle, 0.012, 0.025, 0.012, yaw)
      }
      const worldHinge = hinge.clone().applyMatrix4(m)
      const worldTip = tip.clone().applyMatrix4(m)
      out.colliders.push({ ax: worldHinge.x, az: worldHinge.z, bx: worldTip.x, bz: worldTip.z })
    }
    if (len - u > 0.02) out.colliders.push(seg(ax, az, dx, dz, u, len))
    if (trim.vertexCount) batch.add(lib.ceiling, applyMatrixKeepWinding(trim.build(), m))
    if (leaf.vertexCount) batch.add(lib.cabinet, applyMatrixKeepWinding(leaf.build(), m))
    if (hardware.vertexCount) batch.add(lib.blackMetal, applyMatrixKeepWinding(hardware.build(), m))
  }

  // floors
  for (const b of plan.blocks) {
    const [x0, z0, x1, z1] = b.rect
    const gb = new GeoBuilder()
    gb.quad(V3(x0 + 0.01, fy, z1 - 0.01), V3(x1 - 0.01, fy, z1 - 0.01), V3(x1 - 0.01, fy, z0 + 0.01), V3(x0 + 0.01, fy, z0 + 0.01))
    batch.add(b.utility ? lib.concrete : lib.floor, gb.build())
  }
  for (const r of plan.rooms) {
    if (r.floor !== 'tile') continue
    const [x0, z0, x1, z1] = r.rect
    const gb = new GeoBuilder()
    const y = fy + 0.004
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
