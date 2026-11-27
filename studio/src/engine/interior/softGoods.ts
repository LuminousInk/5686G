import * as THREE from 'three'
import { V3 } from '../geo'
import type { MaterialLibrary } from '../materials/library'
import { decor, Piece } from './modern'

type HeightAt = (x: number, z: number) => number | undefined
type FabricPoint = (u: number, v: number) => [number, number, number]

const twoSided = new WeakMap<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>()

function clothFace(lib: MaterialLibrary, material: THREE.MeshStandardMaterial) {
  if (material.side === THREE.DoubleSide) return material
  const cached = twoSided.get(material)
  if (cached) return cached
  const cloth = material.clone()
  cloth.side = THREE.DoubleSide
  twoSided.set(material, cloth)
  lib.interiorExtra.add(cloth)
  return cloth
}

/** Sample the fitted furniture in its local frame, before adding any new accessories to it. */
export function supportHeight(model: THREE.Object3D): HeightAt {
  model.updateWorldMatrix(true, true)
  const origin = model.getWorldPosition(V3(0, 0, 0))
  const top = new THREE.Box3().setFromObject(model).max.y
  const ray = new THREE.Raycaster(V3(0, 0, 0), V3(0, -1, 0), 0, top - origin.y + 0.1)
  const hits: THREE.Intersection[] = []
  return (x, z) => {
    model.localToWorld(ray.ray.origin.set(x, 0, z))
    ray.ray.origin.y = top + 0.05
    hits.length = 0
    const hit = ray.intersectObject(model, true, hits)[0]
    return hit && hit.point.y - origin.y
  }
}

function sheet(point: FabricPoint, across: number, along: number, start = 0, end = 1) {
  const geometry = new THREE.PlaneGeometry(1, 1, across, along)
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i)
    const v = THREE.MathUtils.lerp(start, end, 0.5 - positions.getY(i))
    positions.setXYZ(i, ...point(u, v))
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Slightly uneven ridges interrupt the silhouette and keep the hem from reading as a straight slab. */
function folds(u: number, v: number, amplitude: number) {
  return amplitude * (Math.sin(u * 23 + v * 3.1) + 0.38 * Math.sin(u * 51 - v * 5.5))
}

export function sofaThrow(lib: MaterialLibrary, x: number, ridge: { z: number; y: number }, rear: number,
  seat: { z: number; y: number }, material = lib.throwLinen) {
  const path = new THREE.CatmullRomCurve3([
    V3(x - 0.025, ridge.y - 0.36, rear - 0.025),
    V3(x - 0.009, ridge.y - 0.12, rear - 0.025),
    V3(x, ridge.y + 0.025, rear + 0.018),
    V3(x, ridge.y + 0.025, ridge.z),
    V3(x + 0.014, ridge.y + 0.002, ridge.z + 0.045),
    V3(x + 0.036, seat.y + 0.065, seat.z - 0.047),
    V3(x + 0.041, seat.y + 0.019, seat.z),
  ], false, 'centripetal')
  const point: FabricPoint = (u, v) => {
    const q = path.getPoint(v)
    const wave = folds(u, v, THREE.MathUtils.lerp(0.009, 0.003, v))
    return [q.x + u * (0.45 + 0.035 * Math.sin(v * 7)), q.y + wave * 0.60, q.z + wave]
  }
  const p = new Piece()
  p.add(clothFace(lib, material), sheet(point, 18, 22, 0.025, 1))
  p.add(clothFace(lib, lib.linen), sheet(point, 18, 1, 0, 0.025))
  return decor(p.build('sofa-throw'))
}

export function bedThrow(lib: MaterialLibrary, width: number, depth: number, heightAt: HeightAt,
  material: THREE.MeshStandardMaterial) {
  const mat = clothFace(lib, material)
  const near = depth * 0.10
  const far = depth * 0.34
  const lerp = THREE.MathUtils.lerp
  const top = heightAt(0, near) ?? 0.55
  const edge = (side: number) => {
    // The duvet can finish well inside the fitted bed footprint. Keep the ends of the throw on its shoulder.
    const reaches = [0.424, 0.402, 0.380, 0.358].map(fraction => side * width * fraction)
    return reaches.find(x => [near - 0.042, (near + far) / 2, far + 0.042]
      .every(z => (heightAt(x, z) ?? 0) > top - 0.062)) ?? reaches.at(-1)!
  }
  const left = edge(-1)
  const right = edge(1)
  const point: FabricPoint = (u, v) => {
    const x = lerp(left + 0.007, right - 0.007, u + 0.5) + 0.007 * Math.sin(v * 7 + u * 3)
    const z = lerp(near, far, v) + width * u * 0.035 + 0.009 * Math.sin(u * 16 + v)
    const y = heightAt(x, z) ?? top
    const foldOver = 0.021 * Math.exp(-105 * (v - 0.14) ** 2)
    return [x, y + 0.022 + folds(u, v, 0.007) + foldOver, z]
  }
  const p = new Piece()
  p.add(mat, sheet(point, 20, 12, 0, 0.962))
  p.add(lib.throwLinen, sheet(point, 20, 1, 0.962, 1))
  return decor(p.build('bed-knit-throw'))
}

function signedPow(x: number, exponent: number) {
  return Math.sign(x) * Math.pow(Math.abs(x), exponent)
}

/** A stuffed sham with a pinched middle and softly pointed corners. */
export function cushion(material: THREE.Material, width: number, height: number,
  depth: number, lean = 0.27, twist = 0) {
  const geometry = new THREE.SphereGeometry(1, 20, 12)
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const y = positions.getY(i)
    const z = positions.getZ(i)
    const vertical = signedPow(y, 0.57)
    const pinch = 1 - 0.11 * Math.exp(-26 * x * x) * Math.max(0, y)
    positions.setXYZ(i, signedPow(x, 0.46) * width * 0.5 * (1 + 0.045 * vertical),
      vertical * height * 0.5 * pinch, signedPow(z, 0.70) * depth * 0.5 * (1 + 0.07 * Math.sin(x * 7 + y * 2)))
  }
  geometry.rotateX(-lean).rotateZ(twist)
  geometry.computeBoundingBox()
  geometry.translate(0, -geometry.boundingBox!.min.y, 0)
  geometry.computeVertexNormals()
  const p = new Piece()
  p.add(material, geometry)
  return decor(p.build('tailored-cushion'))
}

export function linenRunner(lib: MaterialLibrary, length: number, width: number) {
  const geometry = sheet((u, v) => [
    (v - 0.5) * length + 0.008 * Math.sin(u * 6),
    0.003 + 0.0015 * Math.sin(u * 18 + v * 4),
    -u * width + 0.009 * Math.sin(v * 9),
  ], 12, 15)
  const p = new Piece()
  p.add(clothFace(lib, lib.throwLinen), geometry)
  return decor(p.build('linen-table-runner'))
}

export function hungTowel(lib: MaterialLibrary, width: number, length: number, front: number) {
  const point: FabricPoint = (u, v) => {
    const frontFace = v >= 0.22
    const travel = frontFace ? (v - 0.22) / 0.78 : (0.22 - v) / 0.22
    const bend = Math.min(1, travel * 7) * Math.PI / 2
    const wave = folds(u, v, 0.008) * Math.sin(bend)
    const fall = frontFace ? length : length * 0.53
    return [u * width * (1 - 0.035 * travel) + 0.012 * travel,
      0.012 * Math.cos(bend) - fall * travel + 0.009 * Math.sin(u * 11) * travel,
      front + (frontFace ? 1 : -1) * (0.013 * Math.sin(bend) + wave)]
  }
  const p = new Piece()
  p.add(clothFace(lib, lib.linen), sheet(point, 16, 17, 0, 0.90))
  p.add(lib.throwLinen, sheet(point, 16, 1, 0.90, 0.945))
  p.add(clothFace(lib, lib.linen), sheet(point, 16, 2, 0.945))
  return decor(p.build('draped-hand-towel'))
}

export function rolledTowel(lib: MaterialLibrary, length: number, radius: number, x: number, y: number, z: number) {
  const p = new Piece()
  const geometry = new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 16)
  const positions = geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) {
    const along = positions.getY(i)
    const wave = 1 + 0.05 * Math.cos(positions.getX(i) * 180 + along * 80)
    positions.setXYZ(i, positions.getX(i) * wave, along, positions.getZ(i) * wave)
  }
  geometry.rotateZ(Math.PI / 2).translate(x, y + radius, z)
  geometry.computeVertexNormals()
  p.add(lib.linen, geometry)
  for (const side of [-1, 1]) {
    const coil = Array.from({ length: 27 }, (_, i) => {
      const angle = i * Math.PI / 6
      const r = radius * (0.08 + i * 0.027)
      const end = length / 2 - radius + Math.sqrt(radius * radius - r * r)
      return V3(x + side * (end + 0.001), y + radius + r * Math.sin(angle), z + r * Math.cos(angle))
    })
    p.add(lib.fabric2, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 25, 0.0013, 4, false))
  }
  return decor(p.build('rolled-hand-towel'))
}
