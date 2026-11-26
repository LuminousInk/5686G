import * as THREE from 'three'
import { plumeTexture, rng } from '../materials/textures'
import { wind } from './grass'

/**
 * Feather reed grass clumps (the beige plumes in front of the house): arching green-gold blades plus plume heads
 * on thin stems. Instanced; each instance = [x, y, z, scale] + [yaw, hue].
 */
function clumpGeometry(seed: number) {
  const rand = rng(seed)
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const blade = (bx: number, bz: number, yaw: number, h: number, lean: number, w: number) => {
    const segs = 5
    const dx = Math.cos(yaw)
    const dz = Math.sin(yaw)
    const sx = -dz
    const sz = dx
    const base = pos.length / 3
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const width = w * (1 - t * 0.9)
      const off = lean * Math.pow(t, 1.8) * h
      const y = h * t - lean * 0.35 * Math.pow(t, 2.5) * h
      const cx = bx + dx * off
      const cz = bz + dz * off
      pos.push(cx - sx * width, y, cz - sz * width, cx + sx * width, y, cz + sz * width)
      uv.push(0, t, 1, t)
      const nx = dx * (0.3 + t * 0.6)
      const ny = 1 - t * 0.4
      const L = Math.hypot(nx, ny, dz * (0.3 + t * 0.6))
      nor.push(nx / L, ny / L, (dz * (0.3 + t * 0.6)) / L, nx / L, ny / L, (dz * (0.3 + t * 0.6)) / L)
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2)
    }
  }
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 0.12
    blade(Math.cos(a) * r, Math.sin(a) * r, a + (rand() - 0.5) * 0.8, 0.55 + rand() * 0.4, 0.25 + rand() * 0.55, 0.006 + rand() * 0.004)
  }
  const blades = new THREE.InstancedBufferGeometry()
  blades.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  blades.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  blades.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  blades.setIndex(idx)

  // plume stems + heads: two crossed cards per plume
  const pp: number[] = []
  const pn: number[] = []
  const pu: number[] = []
  const pi: number[] = []
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 0.1
    const lean = 0.05 + rand() * 0.12
    const top = 1.05 + rand() * 0.35
    const bx = Math.cos(a) * r
    const bz = Math.sin(a) * r
    const tx = bx + Math.cos(a) * lean
    const tz = bz + Math.sin(a) * lean
    const ph = 0.3 + rand() * 0.12
    for (let k = 0; k < 2; k++) {
      const yaw = a + k * (Math.PI / 2)
      const sx = Math.cos(yaw) * 0.035
      const sz = Math.sin(yaw) * 0.035
      const base = pp.length / 3
      // head card from (top - ph) to top
      const y0 = top - ph
      pp.push(tx - sx, y0, tz - sz, tx + sx, y0, tz + sz, tx + sx, top, tz + sz, tx - sx, top, tz - sz)
      for (let q = 0; q < 4; q++) pn.push(0, 1, 0)
      pu.push(0, 0, 1, 0, 1, 1, 0, 1)
      pi.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    // stem (thin card)
    const base = pp.length / 3
    const w = 0.003
    pp.push(bx - w, 0, bz, bx + w, 0, bz, tx + w, top - 0.3, tz, tx - w, top - 0.3, tz)
    for (let q = 0; q < 4; q++) pn.push(0, 1, 0)
    pu.push(0.49, 0.02, 0.51, 0.02, 0.51, 0.03, 0.49, 0.03)
    pi.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const plumes = new THREE.InstancedBufferGeometry()
  plumes.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3))
  plumes.setAttribute('normal', new THREE.Float32BufferAttribute(pn, 3))
  plumes.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2))
  plumes.setIndex(pi)
  return { blades, plumes }
}

function patch(mat: THREE.MeshStandardMaterial, key: string, colorize: boolean) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = wind.uTime
    shader.uniforms.uWind = wind.uWind
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 iPos; attribute vec2 iRot; uniform float uTime; uniform float uWind; varying float vT; varying float vHue;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float gc = cos(iRot.x); float gs = sin(iRot.x);
        vec3 objectNormal = normal;
        objectNormal.xz = mat2(gc, gs, -gs, gc) * objectNormal.xz;
        objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.35));`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position * iPos.w;
        float bc = cos(iRot.x); float bs = sin(iRot.x);
        transformed.xz = mat2(bc, bs, -bs, bc) * transformed.xz;
        float h = clamp(position.y / 1.3, 0.0, 1.0);
        vec2 wdir = normalize(vec2(1.0, 0.4));
        float ph = uTime * 1.1 + dot(iPos.xz, vec2(0.31, 0.19));
        float sway = (sin(ph) * 0.6 + sin(ph * 2.1 + 0.7) * 0.25 + 0.3) * uWind;
        transformed.xz += wdir * sway * h * h * 0.16 * iPos.w;
        transformed += iPos.xyz;
        vT = uv.y; vHue = iRot.y;`,
      )
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vT; varying float vHue;')
    if (colorize)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `vec3 g0 = vec3(0.09, 0.11, 0.035); vec3 g1 = vec3(0.42, 0.36, 0.17); vec3 g2 = vec3(0.55, 0.47, 0.25);
        vec3 gc2 = mix(g0, mix(g1, g2, vHue), smoothstep(0.1, 0.9, vT));
        diffuseColor.rgb *= gc2;`,
      )
  }
  mat.customProgramCacheKey = () => key
}

export interface OrnamentalGrass {
  group: THREE.Group
}

export function buildOrnamental(points: [number, number, number, number][], seed = 4): THREE.Group {
  const { blades, plumes } = clumpGeometry(seed)
  const n = points.length
  const iPos = new Float32Array(n * 4)
  const iRot = new Float32Array(n * 2)
  const rand = rng(seed + 9)
  points.forEach((p, i) => {
    iPos.set(p, i * 4)
    iRot.set([rand() * Math.PI * 2, rand()], i * 2)
  })
  for (const g of [blades, plumes]) {
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4))
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(iRot, 2))
    g.instanceCount = n
  }
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide })
  patch(bladeMat, 'orn-blades', true)
  const plumeMat = new THREE.MeshStandardMaterial({
    map: plumeTexture(),
    color: '#f3e3c2',
    roughness: 0.85,
    side: THREE.DoubleSide,
    alphaTest: 0.25,
    transparent: false,
  })
  patch(plumeMat, 'orn-plumes', false)
  const group = new THREE.Group()
  group.name = 'ornamental-grass'
  for (const [g, m] of [
    [blades, bladeMat],
    [plumes, plumeMat],
  ] as const) {
    const mesh = new THREE.Mesh(g, m)
    mesh.frustumCulled = false
    mesh.castShadow = true
    mesh.receiveShadow = true
    // shadow depth needs the same vertex transform
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map ?? null, alphaTest: m.alphaTest })
    patch(depth as unknown as THREE.MeshStandardMaterial, `${m === bladeMat ? 'orn-blades' : 'orn-plumes'}-depth`, false)
    mesh.customDepthMaterial = depth
    group.add(mesh)
  }
  return group
}
