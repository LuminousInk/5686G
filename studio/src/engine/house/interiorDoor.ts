import * as THREE from 'three'
import { GeoBuilder, V3 } from '../geo'
import type { HomePlan, Opening } from './types'
import type { Segment2 } from './walls'

export interface InteriorDoorSpec {
  op: Opening
  u0: number
  u1: number
  y1: number
}

/** Casing, an open wood leaf, handles, hinges and the leaf collider in a wall-local frame. */
export function buildInteriorDoor(
  plan: HomePlan,
  d: InteriorDoorSpec,
  m: THREE.Matrix4,
  t: number,
  trim: GeoBuilder,
  leaf: GeoBuilder,
  hardware: GeoBuilder,
): Segment2 {
  const fy = plan.floorY
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
  const ax = m.elements[12]
  const az = m.elements[14]
  const dx = m.elements[0]
  const dz = m.elements[2]
  const sideRooms = [1, -1].map(side => {
    const x = ax + dx * d.op.at - dz * side * 0.6
    const z = az + dz * d.op.at + dx * side * 0.6
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
  return { ax: worldHinge.x, az: worldHinge.z, bx: worldTip.x, bz: worldTip.z }
}
