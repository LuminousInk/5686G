import * as THREE from 'three'
import type { HouseModel } from '../house/build'
import type { HomePlan } from '../house/types'
import type { MaterialLibrary } from '../materials/library'
import { rng } from '../materials/textures'
import { modelPieces } from '../models'
import type { QualitySettings } from '../quality'
import type { TimePreset } from '../env/environment'
import { wind } from './grass'
import { plantHillside } from './coastalPlanting'
import { coastalLawn, coastalNeighbors } from './coastalLayout'
import { buildCoastalLawn, buildCoastalLots, buildCoastalStreets } from './coastalLots'
import { buildGravelPaths } from './gravelPaths'
import type { Hillside } from './hillside'
import { buildOcean, canyonMaterial, CoastalSky, loadCoastalMaps, retainingMaterial, type CoastalMaps } from './ocean'
import { GrassField } from './grassField'
import { buildOrnamental } from './ornamental'
import { Terrain, type Berm } from './terrain'
import { coastalTreeVariant, impostorForest, makeVariant, treeInstances, type TreePlacement } from './trees'
import { diningSet, fence, loungeSet, planter } from './furniture'
import { expandImpostors, expandInstanced, expandShaderInstances } from '../photo/bake'

const ROCKS = ['rock_moss_set_01', 'rock_moss_set_02']
const ACCENT_ROCKS = ['namaqualand_boulder_02']
const SMALL = ['stone_01', 'rock_07', 'rock_09']

export class Site {
  readonly group = new THREE.Group()
  terrain!: Terrain
  private disposables: { dispose(): void }[] = []
  private lawn: GrassField | null = null
  private grassMotion = { value: 0 }
  private plants: { fern: THREE.Mesh[]; shrub: THREE.Mesh[] } = { fern: [], shrub: [] }
  /** pieces the path tracer cannot read directly (see bakeForPhoto) */
  private instanced: THREE.InstancedMesh[] = []
  private shaderInstanced: THREE.Mesh[] = []
  private coast: THREE.Group | null = null
  private coastalMaps: CoastalMaps = { grass: null, bark: null }
  private coastalSky = new CoastalSky()
  private coastalLots: THREE.InstancedMesh[] = []
  private coastalLotMaterial: THREE.Material | null = null
  private ocean: THREE.Mesh | null = null
  private photoWater: THREE.MeshPhysicalMaterial | null = null
  private forests: THREE.Mesh[] = []
  private clear: [number, number, number, number][] = []
  private isClear(x: number, z: number) {
    return this.clear.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1)
  }

  constructor(
    private lib: MaterialLibrary,
    private quality: QualitySettings,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.group.name = 'site'
  }

  heightAt(x: number, z: number) {
    return this.terrain.heightAt(x, z)
  }

  async build(plan: HomePlan, house: HouseModel) {
    const L = plan.landscape
    this.terrain = new Terrain(plan, house.bounds)
    const t = this.terrain
    if (t.hillside) {
      this.coastalMaps = await loadCoastalMaps()
      const neighbors = coastalNeighbors(t.hillside)
      this.buildCoastalGround(plan, t.hillside, neighbors)
      const planting = await plantHillside(plan, t.hillside, this.quality, neighbors, this.coastalSky, this.renderer, this.grassMotion)
      this.disposables.push(...planting.materials)
      this.group.add(...planting.meshes, ...planting.impostors)
      this.instanced.push(...planting.meshes)
      this.forests.push(...planting.impostors)
      this.buildOutdoorLiving(plan, house, planting.grasses)
      return
    }
    const ground = t.buildMesh(this.lib.ground)
    this.group.add(ground)
    const center = house.bounds.getCenter(new THREE.Vector3())

    // ------------------------------------------------------------ exclusion map for the lawn (see blockedFn)
    const blocked = this.blockedFn(plan)

    // ------------------------------------------------------------ lawn (camera-following, world anchored)
    const msize = 150
    this.lawn = new GrassField(
      {
        x0: center.x - msize / 2,
        z0: center.z - msize / 2,
        size: msize,
        res: 768,
        height: (x, z) => t.heightAt(x, z),
        lawn: (x, z) => (blocked(x, z) ? 0 : 1),
      },
      this.quality,
    )
    this.group.add(this.lawn.group)

    // ------------------------------------------------------------ berms (planting beds)
    const rockPieces = (await Promise.all(ROCKS.map(id => modelPieces(id)))).flat()
    rockPieces.push(...(await Promise.all(ACCENT_ROCKS.map(id => modelPieces(id)))).flat())
    const smallPieces = (await Promise.all(SMALL.map(id => modelPieces(id)))).flat()
    this.plants.fern = await modelPieces('fern_02').catch(() => [])
    this.plants.shrub = await modelPieces('shrub_04').catch(() => [])
    const clumps: [number, number, number, number][] = []
    this.clear = L.clear ?? []
    for (const b of t.berms) this.berm(b, rockPieces, smallPieces, clumps)

    this.buildOutdoorLiving(plan, house, clumps)

    // ------------------------------------------------------------ trees
    const detail = this.quality.treeDetail
    const pineA = makeVariant('Pine Large', 4417, detail, 'pine')
    const pineB = makeVariant('Pine Medium', 913, detail, 'pine')
    const pineS = makeVariant('Pine Small', 31, detail, 'pine')
    const aspen = makeVariant('Aspen Medium', 77, detail, 'aspen')
    const rand = rng(42)
    const byVariant = new Map<typeof pineA, TreePlacement[]>([
      [pineA, []],
      [pineB, []],
      [pineS, []],
      [aspen, []],
    ])
    for (const tr of L.trees ?? []) {
      const s = tr.s ?? 1
      const v = tr.kind === 'pine-small' ? pineS : tr.kind === 'aspen' ? aspen : rand() < 0.5 ? pineA : pineB
      const h = tr.kind === 'pine-small' ? 6 * s : tr.kind === 'aspen' ? 13 * s : 15.5 * s
      byVariant.get(v)!.push({ x: tr.x, y: t.heightAt(tr.x, tr.z), z: tr.z, height: h, yaw: rand() * Math.PI * 2 })
    }
    // mid-distance ring of real trees for depth
    const mid = this.quality.tier === 'low' ? 12 : this.quality.tier === 'medium' ? 24 : 36
    for (let i = 0; i < mid; i++) {
      const a = rand() * Math.PI * 2
      const r = 28 + rand() * 18
      const x = center.x + Math.cos(a) * r
      const z = center.z + Math.sin(a) * r
      // keep the street view open in front of the house
      if (z > center.z + 14 && Math.abs(x - center.x) < 22) continue
      const v = rand() < 0.45 ? pineA : rand() < 0.8 ? pineB : aspen
      byVariant.get(v)!.push({ x, y: t.heightAt(x, z), z, height: (v === aspen ? 11 : 13) + rand() * 7, yaw: rand() * Math.PI * 2 })
    }
    for (const [v, places] of byVariant) {
      const near = places.filter(p => Math.hypot(p.x - center.x, p.z - center.z) < 34)
      const far = places.filter(p => Math.hypot(p.x - center.x, p.z - center.z) >= 34)
      for (const g of [treeInstances(v, near, true), treeInstances(v, far, false)]) {
        this.group.add(g)
        for (const c of g.children) this.instanced.push(c as THREE.InstancedMesh)
      }
    }
    // impostor forest
    const forest: TreePlacement[] = []
    const nf = this.quality.forestTrees * 2
    const fr = L.forest?.radius ?? 55
    for (let i = 0; i < nf; i++) {
      const a = rand() * Math.PI * 2
      const r = fr + rand() * 70
      const x = center.x + Math.cos(a) * r
      const z = center.z + Math.sin(a) * r
      if (z > center.z + 20 && Math.abs(x - center.x) < 30 && rand() < 0.7) continue
      forest.push({ x, y: t.heightAt(x, z), z, height: 14 + rand() * 12, yaw: 0 })
    }
    const distant = impostorForest(this.renderer, pineA, forest, 5)
    this.forests.push(distant)
    this.group.add(distant)
  }

  private buildCoastalGround(plan: HomePlan, hill: Hillside, neighbors = coastalNeighbors(hill)) {
    const sky = this.coastalSky
    const low = this.quality.tier === 'low'
    const ground = hill.buildSurface(canyonMaterial(this.lib, hill, sky, this.coastalMaps), retainingMaterial(this.lib), low)
    this.coast = ground
    sky.bind(ground.children[0] as THREE.Mesh)
    if (plan.landscape.paths?.length) ground.add(buildGravelPaths(plan.landscape.paths, hill, this.lib))
    const lawn = coastalLawn(plan, hill)
    if (lawn) ground.add(buildCoastalLawn(lawn, hill, this.coastalMaps))
    if (neighbors.length) {
      const { meshes, material } = buildCoastalLots(hill, neighbors, sky)
      this.coastalLots = meshes
      this.coastalLotMaterial = material
      ground.add(...meshes, buildCoastalStreets(hill, neighbors, sky))
    }
    if (hill.oceanDistance !== undefined) {
      const ocean = buildOcean(hill, sky, wind.uTime, low)
      ground.add(ocean)
      this.ocean = ocean
      this.photoWater = new THREE.MeshPhysicalMaterial({ color: '#217088', roughness: 0.22, metalness: 0.18, clearcoat: 0.68 })
    }
    this.group.add(ground)
  }

  private disposeCoastalGround() {
    if (!this.coast) return
    this.coast.removeFromParent()
    for (const mesh of this.coast.children) {
      if (!(mesh instanceof THREE.Mesh)) continue
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose()
      mesh.geometry.dispose()
      const material = mesh.material as THREE.Material
      if (material !== this.coastalLotMaterial) material.dispose()
    }
    this.coastalLotMaterial?.dispose()
    this.coastalLotMaterial = null
    this.coastalLots = []
    this.photoWater?.dispose()
    this.photoWater = null
    this.coast = this.ocean = null
  }

  private buildOutdoorLiving(plan: HomePlan, house: HouseModel, planting: [number, number, number, number][]) {
    const L = plan.landscape
    const t = this.terrain
    const clumps: [number, number, number, number][] = t.hillside ? [] : [...planting]
    const pottedOlives: TreePlacement[] = []
    for (const p of L.planters ?? []) {
      const pl = planter(this.lib, p.kind)
      const y = house.floorAt(p.x, p.z) ?? t.heightAt(p.x, p.z)
      pl.group.position.set(p.x, y, p.z)
      this.group.add(pl.group)
      if (t.hillside && p.kind === 'tall') {
        pottedOlives.push({ x: p.x, z: p.z, y: y + pl.soil, height: 1.65, yaw: p.x + p.z })
      } else if (p.grass) clumps.push([p.x, y + pl.soil - 0.02, p.z, p.kind === 'tall' ? 0.85 : 0.6])
    }
    if (pottedOlives.length) {
      const trees = treeInstances(coastalTreeVariant('olive', 182, this.quality.treeDetail), pottedOlives, true)
      trees.name = 'Potted terrace olives'
      this.group.add(trees)
      this.instanced.push(...trees.children as THREE.InstancedMesh[])
    }
    for (const l of L.lounge ?? []) {
      const g = loungeSet(this.lib)
      g.position.set(l.x, house.floorAt(l.x, l.z) ?? 0, l.z)
      g.rotation.y = l.rot
      this.group.add(g)
    }
    for (const d of L.dining ?? []) {
      const g = diningSet(this.lib)
      g.position.set(d.x, house.floorAt(d.x, d.z) ?? 0, d.z)
      g.rotation.y = d.rot
      this.group.add(g)
    }
    if (t.hillside) clumps.push(...planting)
    if (clumps.length) {
      const orn = buildOrnamental(clumps.slice(0, Math.max(12, this.quality.ornamentalClumps)), 4)
      this.group.add(orn)
      for (const c of orn.children) this.shaderInstanced.push(c as THREE.Mesh)
    }

    if (L.fence && L.fence.length > 1) this.group.add(fence(this.lib, L.fence, (x, z) => t.heightAt(x, z)))
  }

  /** Planting bed: soil/moss surface, pebble border, boulders, stepping stones, grasses. */
  private berm(b: Berm, rocks: THREE.Mesh[], small: THREE.Mesh[], clumps: [number, number, number, number][]) {
    const t = this.terrain
    const rand = rng(b.seed * 31 + 7)
    const c = Math.cos(b.rot)
    const s = Math.sin(b.rot)
    const toWorld = (lx: number, lz: number): [number, number] => [b.x + lx * b.rx * c - lz * b.rz * s, b.z + lx * b.rx * s + lz * b.rz * c]
    const edge = (ang: number) => {
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      const wob = 1 + 0.07 * Math.sin(ang * 3 + b.seed) + 0.04 * Math.sin(ang * 5 + b.seed * 2.3)
      return wob / Math.pow(Math.pow(Math.abs(ca), 2.6) + Math.pow(Math.abs(sa), 2.6), 1 / 2.6)
    }
    // bed surface: radial fan from centre to edge
    const seg = 96
    const rings = 14
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2
        const rr = (i / rings) * edge(a) * 1.0
        const [x, z] = toWorld(Math.cos(a) * rr, Math.sin(a) * rr)
        pos.push(x, t.heightAt(x, z) + 0.012, z)
        uv.push(x, z)
      }
    }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < seg; j++) {
        const a = i * seg + j
        const bq = i * seg + ((j + 1) % seg)
        const cq = (i + 1) * seg + ((j + 1) % seg)
        const d = (i + 1) * seg + j
        idx.push(a, cq, bq, a, d, cq)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    const bed = new THREE.Mesh(g, this.bedMaterial())
    bed.receiveShadow = true
    this.group.add(bed)
    // pebble border ring
    const rp: number[] = []
    const ru: number[] = []
    const ri: number[] = []
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2
      const e = edge(a)
      for (const k of [0.96, 1.12]) {
        const [x, z] = toWorld(Math.cos(a) * e * k, Math.sin(a) * e * k)
        rp.push(x, t.heightAt(x, z) + 0.02, z)
        ru.push(x, z)
      }
      if (j < seg) {
        const q = j * 2
        ri.push(q, q + 3, q + 1, q, q + 2, q + 3)
      }
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3))
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2))
    rg.setIndex(ri)
    rg.computeVertexNormals()
    const ring = new THREE.Mesh(rg, this.lib.pebbles)
    ring.receiveShadow = true
    this.group.add(ring)
    // 3D pebbles on the border
    const pebGeo = new THREE.IcosahedronGeometry(1, 1)
    {
      const p = pebGeo.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i)
        v.multiplyScalar(1 + (Math.sin(v.x * 9.1) + Math.cos(v.z * 7.3)) * 0.08)
        p.setXYZ(i, v.x, v.y * 0.55, v.z)
      }
      pebGeo.computeVertexNormals()
    }
    const nPeb = this.quality.tier === 'low' ? 900 : 2600
    const peb = new THREE.InstancedMesh(pebGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }), nPeb)
    const m4 = new THREE.Matrix4()
    const col = new THREE.Color()
    for (let i = 0; i < nPeb; i++) {
      const a = rand() * Math.PI * 2
      const e = edge(a) * (0.97 + rand() * 0.15)
      const [x, z] = toWorld(Math.cos(a) * e, Math.sin(a) * e)
      const r = 0.018 + rand() * rand() * 0.05
      m4.compose(new THREE.Vector3(x, t.heightAt(x, z) + r * 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)), new THREE.Vector3(r * (1 + rand() * 0.5), r, r))
      peb.setMatrixAt(i, m4)
      const tone = 0.16 + rand() * 0.3
      col.setRGB(tone * 1.03, tone, tone * 0.93)
      peb.setColorAt(i, col)
    }
    peb.castShadow = true
    peb.receiveShadow = true
    this.group.add(peb)
    this.instanced.push(peb)

    // boulders on the slope (front half mostly), partly buried
    const place = (pieces: THREE.Mesh[], n: number, size: [number, number], where: [number, number], flat = 1) => {
      // every rock model may have been skipped (see loadModel); the berm then keeps its pebbles and plants
      if (!pieces.length) return
      for (let i = 0; i < n; i++) {
        const src = pieces[Math.floor(rand() * pieces.length)]
        const a = rand() * Math.PI * 2
        const rr = where[0] + rand() * (where[1] - where[0])
        const e = edge(a) * rr
        const [x, z] = toWorld(Math.cos(a) * e, Math.sin(a) * e)
        const mesh = src.clone()
        const bb = src.geometry.boundingBox!
        const dim = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
        const want = size[0] + rand() * (size[1] - size[0])
        const k = want / dim
        mesh.scale.set(k, k * flat * (0.8 + rand() * 0.4), k)
        mesh.rotation.y = rand() * Math.PI * 2
        const h = (bb.max.y - bb.min.y) * mesh.scale.y
        mesh.position.set(x, t.heightAt(x, z) - h * (0.22 + rand() * 0.15), z)
        this.group.add(mesh)
      }
    }
    const bigN = Math.round(b.rx * b.rz * 0.85)
    place(rocks, Math.ceil(bigN * 0.35), [1.1, 1.8], [0.3, 0.85])
    place(rocks, bigN, [0.5, 1.1], [0.2, 1.0])
    place(small, bigN * 4, [0.1, 0.32], [0.05, 1.02])
    // low ground cover between the rocks
    for (const [pieces, n, size] of [
      [this.plants.fern, Math.round(b.rx * b.rz * 0.35), [0.6, 1.0]],
      [this.plants.shrub, Math.round(b.rx * b.rz * 0.25), [0.5, 0.9]],
    ] as const) {
      if (!pieces.length) continue
      for (let i = 0; i < n; i++) {
        const src = pieces[Math.floor(rand() * pieces.length)]
        const a = rand() * Math.PI * 2
        const e = edge(a) * (0.2 + rand() * 0.72)
        const [x, z] = toWorld(Math.cos(a) * e, Math.sin(a) * e)
        if (this.isClear(x, z)) continue
        const mesh = src.clone()
        const bb = src.geometry.boundingBox!
        const dim = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
        const k = (size[0] + rand() * (size[1] - size[0])) / dim
        mesh.scale.setScalar(k)
        mesh.rotation.y = rand() * Math.PI * 2
        mesh.position.set(x, t.heightAt(x, z) - 0.02, z)
        this.group.add(mesh)
      }
    }
    // stepping stones up the middle (flat slabs)
    const steps = Math.max(3, Math.round(b.rz * 1.6))
    for (let i = 0; i < steps; i++) {
      const lz = 1.05 - (i / (steps - 1)) * 1.1
      const [x, z] = toWorld(0.05 + (rand() - 0.5) * 0.08, lz)
      const src = small[Math.floor(rand() * small.length)]
      const mesh = src.clone()
      const bb = src.geometry.boundingBox!
      const dim = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
      const k = (0.55 + rand() * 0.15) / dim
      mesh.scale.set(k, k * 0.22, k * 0.8)
      mesh.rotation.y = rand() * Math.PI
      mesh.position.set(x, t.heightAt(x, z) - 0.03, z)
      this.group.add(mesh)
    }
    // grasses
    const nClumps = Math.round(b.rx * b.rz * 1.0)
    for (let i = 0; i < nClumps; i++) {
      const a = rand() * Math.PI * 2
      const e = edge(a) * (0.15 + rand() * 0.75)
      const [x, z] = toWorld(Math.cos(a) * e, Math.sin(a) * e)
      if (this.isClear(x, z)) continue
      clumps.push([x, t.heightAt(x, z), z, 0.75 + rand() * 0.55])
    }
  }

  private bedMat: THREE.MeshStandardMaterial | null = null
  /** Soil with moss patches blended by world-space noise. */
  private bedMaterial() {
    if (this.bedMat) return this.bedMat
    const soil = this.lib.soil
    const moss = this.lib.moss
    const m = soil.clone()
    m.name = 'bed'
    const mossMap = moss.map!
    m.onBeforeCompile = shader => {
      shader.uniforms.mossMap = { value: mossMap }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D mossMap; varying vec2 vWXZ;
          float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float mn = vn(vWXZ * 0.9) * 0.65 + vn(vWXZ * 2.7) * 0.35;
          float mk = smoothstep(0.42, 0.62, mn);
          vec3 mossCol = texture2D(mossMap, vWXZ / 1.6).rgb * vec3(0.95, 1.05, 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.78, 0.72, 0.66), mossCol, mk);`,
        )
    }
    m.customProgramCacheKey = () => 'bed-moss'
    this.bedMat = m
    return m
  }

  /** Where the lawn must not grow: house, decks, terraces, stairs, planters and planting beds. */
  private blockedFn(plan: HomePlan) {
    const t = this.terrain
    const rects: [number, number, number, number, number][] = [] // x0,z0,x1,z1,pad
    for (const b of plan.blocks) rects.push([...b.rect, 0.35])
    for (const d of plan.decks) rects.push([...d.rect, 0.12])
    for (const tr of plan.terraces) rects.push([...tr.rect, 0.12])
    for (const p of plan.porches) rects.push([...p.rect, -0.2])
    for (const s of plan.stairs) {
      const [fx, fz] = s.from
      const run = s.steps * 0.3 + 0.1
      const dir = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[s.dir]
      const ex = fx + dir[0] * run
      const ez = fz + dir[1] * run
      const hw = s.width / 2 + 0.2
      rects.push([Math.min(fx, ex) - (dir[0] ? 0 : hw), Math.min(fz, ez) - (dir[1] ? 0 : hw), Math.max(fx, ex) + (dir[0] ? 0 : hw), Math.max(fz, ez) + (dir[1] ? 0 : hw), 0])
    }
    const planterSpots = (plan.landscape.planters ?? []).map(p => [p.x, p.z, 0.45] as const)
    return (x: number, z: number) => {
      for (const [x0, z0, x1, z1, pad] of rects) if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) return true
      for (const [px, pz, r] of planterSpots) if ((x - px) ** 2 + (z - pz) ** 2 < r * r) return true
      return t.bermMask(x, z) > 0.01
    }
  }

  /** After a plan edit, keep the new footprint on grade. */
  updateFootprint(plan: HomePlan, house: HouseModel) {
    if (this.terrain.hillside && plan.landscape.site) {
      this.terrain = new Terrain(plan, house.bounds, this.terrain.hillside)
      this.disposeCoastalGround()
      this.buildCoastalGround(plan, this.terrain.hillside!)
      return
    }
    if (!this.lawn) return
    const blocked = this.blockedFn(plan)
    this.lawn.setMask(this.terrain, (x, z) => (blocked(x, z) ? 0 : 1))
  }

  /** Swap real-time-only pieces for static geometry the path tracer can read. */
  bakeForPhoto(camera: THREE.PerspectiveCamera): { add: THREE.Object3D[]; hide: THREE.Object3D[] } {
    const add: THREE.Object3D[] = []
    const hide: THREE.Object3D[] = []
    if (this.ocean && this.photoWater) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200).rotateX(-Math.PI / 2), this.photoWater)
      water.position.copy(this.ocean.position)
      hide.push(this.ocean)
      add.push(water)
    }
    if (this.lawn) {
      hide.push(this.lawn.group)
      const g = this.lawn.bake(camera)
      if (g) add.push(g)
    }
    for (const im of [...this.instanced, ...this.coastalLots]) {
      hide.push(im)
      const m = expandInstanced(im)
      if (m) add.push(m)
    }
    const g0 = new THREE.Color(0.09, 0.11, 0.035)
    const g1 = new THREE.Color(0.42, 0.36, 0.17)
    const g2 = new THREE.Color(0.55, 0.47, 0.25)
    for (const m of this.shaderInstanced) {
      hide.push(m)
      const plume = !!(m.material as THREE.MeshStandardMaterial).map
      const e = expandShaderInstances(m.geometry as THREE.InstancedBufferGeometry, m.material as THREE.Material, plume ? undefined : (t, hue) => g0.clone().lerp(g1.clone().lerp(g2, hue), Math.min(1, Math.max(0, (t - 0.1) / 0.8))))
      if (e) add.push(e)
    }
    for (const forest of this.forests) {
      hide.push(forest)
      const f = expandImpostors(forest, camera, forest.userData.aspect ?? 0.5)
      if (f) add.push(f)
    }
    return { add, hide }
  }

  setTime(preset: TimePreset) {
    // calmer air at night
    wind.uWind.value = preset.id === 'night' ? 0.4 : 1
  }

  update(time: number, camera: THREE.Camera, moving = false) {
    wind.uTime.value = time
    this.grassMotion.value = moving ? 1 : 0
    this.lawn?.update(camera)
  }

  dispose() {
    this.disposeCoastalGround()
    this.group.traverse(o => {
      const m = o as THREE.Mesh
      if (m instanceof THREE.InstancedMesh) m.dispose()
      if (m.isMesh && m.geometry) m.geometry.dispose()
    })
    for (const forest of this.forests) {
      (forest.material as THREE.Material).dispose()
      forest.userData.target.dispose()
    }
    this.coastalMaps.grass?.dispose()
    this.coastalMaps.bark?.dispose()
    for (const d of this.disposables) d.dispose()
    this.lawn?.dispose()
  }
}
