import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * The path tracer reads plain meshes: it ignores instancing and custom vertex shaders. These helpers turn the
 * real-time tricks (instanced trees, shader-placed grass and plumes, billboard forest) into static geometry for
 * one photo, posed for the current camera.
 */

/** InstancedMesh -> one merged Mesh (instance colours become vertex colours). */
export function expandInstanced(im: THREE.InstancedMesh, filter?: (m: THREE.Matrix4) => boolean): THREE.Mesh | null {
  const geos: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const c = new THREE.Color()
  const base = im.geometry.index ? im.geometry.toNonIndexed() : im.geometry.clone()
  for (const k of Object.keys(base.attributes)) if (!['position', 'normal', 'uv'].includes(k)) base.deleteAttribute(k)
  if (!base.getAttribute('uv')) base.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(base.getAttribute('position').count * 2), 2))
  if (!base.getAttribute('normal')) base.computeVertexNormals()
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m)
    if (filter && !filter(m)) continue
    const g = base.clone()
    g.applyMatrix4(m)
    if (im.instanceColor) {
      im.getColorAt(i, c)
      const n = g.getAttribute('position').count
      const col = new Float32Array(n * 3)
      for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3)
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    }
    geos.push(g)
  }
  if (!geos.length) return null
  const merged = mergeGeometries(geos, false)
  if (!merged) return null
  let mat = im.material as THREE.MeshStandardMaterial
  if (im.instanceColor) {
    mat = mat.clone()
    mat.vertexColors = true
  }
  const out = new THREE.Mesh(merged, mat)
  out.castShadow = im.castShadow
  out.receiveShadow = true
  return out
}

/** Instanced [x,y,z,scale] + [yaw, var] geometry (plumes, clumps) -> static mesh. */
export function expandShaderInstances(
  g: THREE.InstancedBufferGeometry,
  mat: THREE.Material,
  colorize?: (t: number, hue: number) => THREE.Color,
): THREE.Mesh | null {
  const iPos = g.getAttribute('iPos') as THREE.InstancedBufferAttribute
  const iRot = g.getAttribute('iRot') as THREE.InstancedBufferAttribute
  if (!iPos) return null
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nor = g.getAttribute('normal') as THREE.BufferAttribute
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  const idx = g.getIndex()!
  const P: number[] = []
  const N: number[] = []
  const U: number[] = []
  const C: number[] = []
  const I: number[] = []
  for (let i = 0; i < g.instanceCount; i++) {
    const x = iPos.getX(i)
    const y = iPos.getY(i)
    const z = iPos.getZ(i)
    const s = iPos.getW(i)
    const yaw = iRot.getX(i)
    const hue = iRot.getY(i)
    const c = Math.cos(yaw)
    const sn = Math.sin(yaw)
    const base = P.length / 3
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v) * s
      const py = pos.getY(v) * s
      const pz = pos.getZ(v) * s
      // mat2(c, s, -s, c) * xz (GLSL column-major) = (c*x - s*z, s*x + c*z)
      P.push(x + c * px - sn * pz, y + py, z + sn * px + c * pz)
      const nx = nor.getX(v)
      const nz = nor.getZ(v)
      N.push(c * nx - sn * nz, nor.getY(v), sn * nx + c * nz)
      U.push(uv.getX(v), uv.getY(v))
      if (colorize) {
        const col = colorize(uv.getY(v), hue)
        C.push(col.r, col.g, col.b)
      }
    }
    for (let k = 0; k < idx.count; k++) I.push(base + idx.getX(k))
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2))
  if (colorize) out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3))
  out.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1))
  const m = (mat as THREE.MeshStandardMaterial).clone()
  m.onBeforeCompile = () => {}
  if (colorize) m.vertexColors = true
  const mesh = new THREE.Mesh(out, m)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Billboard forest -> quads facing the camera. */
export function expandImpostors(mesh: THREE.Mesh, camera: THREE.Camera, aspect: number): THREE.Mesh | null {
  const g = mesh.geometry as THREE.InstancedBufferGeometry
  const iPos = g.getAttribute('iPos') as THREE.InstancedBufferAttribute
  if (!iPos) return null
  const P: number[] = []
  const N: number[] = []
  const U: number[] = []
  const I: number[] = []
  const cam = camera.position
  for (let i = 0; i < g.instanceCount; i++) {
    const x = iPos.getX(i)
    const y = iPos.getY(i)
    const z = iPos.getZ(i)
    const h = iPos.getW(i)
    let tx = cam.x - x
    let tz = cam.z - z
    const L = Math.hypot(tx, tz) || 1
    tx /= L
    tz /= L
    const rx = tz
    const rz = -tx
    const w = (h * aspect) / 2
    const base = P.length / 3
    const corners = [
      [-w, 0, 0, 0],
      [w, 0, 1, 0],
      [w, h, 1, 1],
      [-w, h, 0, 1],
    ]
    for (const [o, oy, u, v] of corners) {
      P.push(x + rx * o, y + oy, z + rz * o)
      N.push(tx, 0, tz)
      U.push(u, v)
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2))
  out.setIndex(I)
  const m = (mesh.material as THREE.MeshStandardMaterial).clone()
  m.onBeforeCompile = () => {}
  return new THREE.Mesh(out, m)
}
