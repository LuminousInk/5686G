import * as THREE from 'three'
import { rng } from '../materials/textures'

export interface WindUniforms {
  uTime: { value: number }
  uWind: { value: number }
}

export const wind: WindUniforms = { uTime: { value: 0 }, uWind: { value: 1 } }

/** One tuft: `blades` tapered, curved blades around a small radius. Height normalised to 1. */
function tuftGeometry(blades: number, seed: number) {
  const rand = rng(seed)
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const segs = 3
  for (let b = 0; b < blades; b++) {
    const a = rand() * Math.PI * 2
    const r = rand() * 0.05
    const bx = Math.cos(a) * r
    const bz = Math.sin(a) * r
    const yaw = rand() * Math.PI * 2
    const lean = 0.15 + rand() * 0.35
    const h = 0.65 + rand() * 0.35
    const w = 0.009 + rand() * 0.006
    const dirX = Math.cos(yaw)
    const dirZ = Math.sin(yaw)
    // blade plane spans perpendicular to the lean direction
    const sx = -dirZ
    const sz = dirX
    const base = pos.length / 3
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const width = w * (1 - t * 0.85)
      const y = t * h
      const off = lean * t * t * h
      const cx = bx + dirX * off
      const cz = bz + dirZ * off
      if (i < segs) {
        pos.push(cx - sx * width, y, cz - sz * width, cx + sx * width, y, cz + sz * width)
        uv.push(0, t, 1, t)
      } else {
        pos.push(cx, y, cz)
        uv.push(0.5, 1)
      }
      // normal faces the lean direction, tilted up
      const nx = dirX * 0.6
      const nz = dirZ * 0.6
      const ny = 0.8
      const L = Math.hypot(nx, ny, nz)
      if (i < segs) nor.push(nx / L, ny / L, nz / L, nx / L, ny / L, nz / L)
      else nor.push(nx / L, ny / L, nz / L)
    }
    for (let i = 0; i < segs - 1; i++) {
      const a0 = base + i * 2
      idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2)
    }
    const l = base + (segs - 1) * 2
    idx.push(l, l + 1, l + 2)
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

export interface GrassOptions {
  count: number
  seed?: number
  /** returns [x, y, z, heightScale, colourVar] or null to reject */
  sample: (rand: () => number) => [number, number, number, number, number] | null
  base: THREE.Color
  tip: THREE.Color
  dry: THREE.Color
  bladesPerTuft?: number
  roughness?: number
  name?: string
}

export function buildGrass(opts: GrassOptions): THREE.Mesh {
  const rand = rng(opts.seed ?? 5)
  const geo = tuftGeometry(opts.bladesPerTuft ?? 5, (opts.seed ?? 5) + 1)
  const iPos = new Float32Array(opts.count * 4)
  const iRot = new Float32Array(opts.count * 2)
  let n = 0
  let tries = 0
  while (n < opts.count && tries < opts.count * 8) {
    tries++
    const s = opts.sample(rand)
    if (!s) continue
    iPos.set([s[0], s[1], s[2], s[3]], n * 4)
    iRot.set([rand() * Math.PI * 2, s[4]], n * 2)
    n++
  }
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos.subarray(0, n * 4), 4))
  geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(iRot.subarray(0, n * 2), 2))
  geo.instanceCount = n
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: opts.roughness ?? 0.72, side: THREE.DoubleSide })
  const uBase = { value: opts.base }
  const uTip = { value: opts.tip }
  const uDry = { value: opts.dry }
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = wind.uTime
    shader.uniforms.uWind = wind.uWind
    shader.uniforms.uBase = uBase
    shader.uniforms.uTip = uTip
    shader.uniforms.uDry = uDry
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 iPos; attribute vec2 iRot;
        uniform float uTime; uniform float uWind; uniform vec3 uBase; uniform vec3 uTip; uniform vec3 uDry;
        varying vec3 vGrass;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float gc = cos(iRot.x); float gs = sin(iRot.x);
        vec3 objectNormal = normal;
        objectNormal.xz = mat2(gc, gs, -gs, gc) * objectNormal.xz;
        objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.55));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
        float t = uv.y;
        transformed.y *= iPos.w;
        transformed.xz *= mix(1.0, iPos.w * 6.0, 0.35);
        float bc = cos(iRot.x); float bs = sin(iRot.x);
        transformed.xz = mat2(bc, bs, -bs, bc) * transformed.xz;
        vec2 wdir = normalize(vec2(1.0, 0.4));
        float ph = uTime * 1.7 + dot(iPos.xz, vec2(0.23, 0.17)) + sin(iPos.x * 0.6 + iPos.z * 0.4) * 1.3;
        float sway = (sin(ph) * 0.55 + sin(ph * 2.7 + 1.3) * 0.2 + 0.35) * uWind;
        transformed.xz += wdir * sway * t * t * iPos.w * 0.55;
        transformed.y -= t * t * sway * sway * 0.12 * iPos.w;
        transformed += iPos.xyz;
        vec3 col = mix(uBase, uTip, smoothstep(0.0, 1.0, t));
        col = mix(col, uDry * mix(0.8, 1.1, t), smoothstep(0.55, 1.0, iRot.y) * 0.8);
        col *= 0.82 + 0.36 * fract(iRot.y * 13.7);
        vGrass = col;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrass;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= vGrass;')
  }
  mat.customProgramCacheKey = () => 'grass-tufts'
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.name = opts.name ?? 'grass'
  return mesh
}
