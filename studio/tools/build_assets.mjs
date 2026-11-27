#!/usr/bin/env node
// Turns the raw Poly Haven downloads (.cache/raw, see fetch_assets.py) into web-ready files in public/assets/:
//   hdri/<id>_<res>.hdr                 copied as-is (RGBE)
//   tex/<id>_<res>_{d,n,arm}.webp        PBR maps (diffuse sRGB, OpenGL normal, AO/rough/metal)
//   models{,-lo}/<id>.json + <id>_<n>.webp  simplified meshes as glTF JSON (one inline buffer, no meshopt:
//                                        hosts may refuse WebAssembly) with textures as separate webp files
//   trees/*.webp                         ez-tree bark and needle textures
// Usage: node tools/build_assets.mjs [only-matching-substring]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, weld, simplify, textureCompress, reorder, metalRough, unpartition, getBounds } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW = process.env.CUBY_ASSET_CACHE ?? path.join(ROOT, '.cache', 'raw')
const objaverse = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'objaverse.json'), 'utf8'))
const OUT = path.join(ROOT, 'public', 'assets')
const args = process.argv.slice(2)
const steps = args.filter(a => a.startsWith('--')).map(a => a.slice(2))
const only = args.find(a => !a.startsWith('--')) ?? ''
const run = (name) => !steps.length || steps.includes(name)
const COASTAL_DIFFUSE = new Set(['withered_grass', 'wood_chip_path'])

// target triangle counts (approximate) and texture size per model
const MODELS = {
  rock_moss_set_01: { tris: 12000, tex: 1024, error: 0.03 },
  rock_moss_set_02: { tris: 12000, tex: 1024, error: 0.03 },
  namaqualand_boulder_02: { tris: 6000, tex: 1024, error: 0.03 },
  stone_01: { tris: 1200, tex: 512, error: 0.03 },
  rock_07: { tris: 1500, tex: 512, error: 0.03 },
  rock_09: { tris: 1200, tex: 512, error: 0.03 },
  fern_02: { tris: 6500, tex: 1024 },
  shrub_04: { tris: 16000, tex: 1024, error: 0.01 },
  shrub_03: { tris: 1600, tex: 512, error: 0.02, diffuseOnly: true },
  grass_medium_01: { tris: 2400, tex: 512, error: 0.025, diffuseOnly: true },
  mid_century_lounge_chair: { tris: 7000, tex: 1024 },
  coffee_table_round_01: { tris: 5000, tex: 1024 },
  potted_plant_01: { tris: 30000, tex: 1024, error: 0.01 },
  potted_plant_04: { tris: 6500, tex: 512, error: 0.006 },
  ceramic_vase_02: { tris: 3000, tex: 512, error: 0.004 },
  wooden_bowl_01: { tris: 3000, tex: 512, error: 0.004 },
  modern_wooden_cabinet: { tris: 5000, tex: 1024 },
  wooden_display_shelves_01: { tris: 5000, tex: 1024 },
  // Khronos glTF Sample Assets (CC BY 4.0, Wayfair); gltf-transform keeps their sheen/specular extensions
  GlamVelvetSofa: { tris: 12000, tex: 1024 },
  SheenChair: { tris: 12000, tex: 1024 },
  // Objaverse (Sketchfab, CC BY 4.0; authors in tools/objaverse.json, fetched by tools/fetch_objaverse.py)
  sofa_beige: { loTex: 512, tris: 30000, tex: 1024 },
  sectional_grey: { loTex: 512, tris: 30000, tex: 1024 },
  sideboard_midcentury: { loTex: 512, tris: 20000, tex: 1024 },
  dining_table_oak: { loTex: 512, tris: 10000, tex: 1024 },
  dining_chair_bentwood: { tris: 10000, tex: 512, error: 0.003 },
  bar_stool_wood: { tris: 6000, tex: 512 },
  fridge_steel: { tris: 6000, tex: 1024 },
  kitchen_faucet: { tris: 6000, tex: 512, error: 0.003 },
  bed_upholstered_white: { loTex: 512, tris: 30000, tex: 1024 },
  bed_dark_headboard: { loTex: 512, tris: 30000, tex: 1024 },
  dresser_tall: { tris: 15000, tex: 1024 },
  vanity_floating: { tris: 15000, tex: 1024 },
  toilet_modern: { tris: 15000, tex: 512 },
  shower_black: { tris: 12000, tex: 512, error: 0.02 },
  towel_bar: { tris: 6000, tex: 512, error: 0.003 },
  desk_lamp_black: { tris: 12000, tex: 512 },
}

const log = (...a) => console.log(...a)
const mb = n => `${(n / 1e6).toFixed(2)} MB`
fs.mkdirSync(path.join(OUT, 'hdri'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'tex'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'models'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'trees'), { recursive: true })

async function hdris() {
  // web hosts only serve web formats: skies ship as lossless RGBE WebP (see tools/encode_hdri.py)
  const { execFileSync } = await import('node:child_process')
  log(execFileSync('python3', [path.join(ROOT, 'tools', 'encode_hdri.py')]).toString().trim())
}

async function textures() {
  const base = path.join(RAW, 'tex')
  for (const id of fs.readdirSync(base)) {
    if (only && !only.split(',').some(o => id === o || id.includes(o))) continue
    for (const res of fs.readdirSync(path.join(base, id))) {
      const dir = path.join(base, id, res)
      if (COASTAL_DIFFUSE.has(id)) {
        await sharp(path.join(dir, 'Diffuse.jpg')).resize(512, 512).webp({ quality: 83, effort: 5 })
          .toFile(path.join(OUT, 'tex', `${id}_512_d.webp`))
        continue
      }
      const jobs = [
        ['Diffuse.jpg', 'd', 84],
        ['nor_gl.jpg', 'n', 90],
        ['arm.jpg', 'arm', 86],
      ]
      for (const [src, suffix, q] of jobs) {
        const out = path.join(OUT, 'tex', `${id}_${res}_${suffix}.webp`)
        await sharp(path.join(dir, src)).webp({ quality: q, effort: 5 }).toFile(out)
      }
      const total = jobs.reduce((s, [, suffix]) => s + fs.statSync(path.join(OUT, 'tex', `${id}_${res}_${suffix}.webp`)).size, 0)
      log('tex  ', id, res, mb(total))
      if (res === '1k') {
        // phone variant: half resolution
        for (const [src, suffix, q] of jobs) {
          await sharp(path.join(dir, src)).resize(512, 512).webp({ quality: q, effort: 5 }).toFile(path.join(OUT, 'tex', `${id}_512_${suffix}.webp`))
        }
      }
    }
  }
}

function triCount(doc) {
  let n = 0
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices()
      n += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3
    }
  return n
}

/** Names carry over into the glTF JSON; some uploads have broken encodings (U+FFFD), which strict hosts reject. */
function sanitizeNames(doc) {
  const root = doc.getRoot()
  const lists = [root.listNodes(), root.listMeshes(), root.listMaterials(), root.listTextures(), root.listAccessors(), root.listScenes(),
    root.listSkins(), root.listAnimations(), root.listCameras(), root.listBuffers()]
  for (const list of lists) for (const p of list) p.setName(p.getName().replace(/[^\x20-\x7e]/g, '_'))
}

/** Sketchfab uploads often carry a flat shadow-catcher disc or floor under the object: drop it. */
function dropGroundPlanes(doc, id) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const all = getBounds(scene)
  const H = all.max[1] - all.min[1]
  const nodes = doc.getRoot().listNodes().filter(n => n.getMesh())
  const info = nodes.map(n => {
    const b = getBounds(n)
    return { n, b, h: b.max[1] - b.min[1], area: (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) }
  })
  const solid = info.filter(i => i.h >= 0.02 * H)
  if (!solid.length) return
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity]
  for (const i of solid) {
    lo[0] = Math.min(lo[0], i.b.min[0]); lo[1] = Math.min(lo[1], i.b.min[2])
    hi[0] = Math.max(hi[0], i.b.max[0]); hi[1] = Math.max(hi[1], i.b.max[2])
  }
  const solidArea = (hi[0] - lo[0]) * (hi[1] - lo[1])
  for (const i of info) {
    if (i.h < 0.02 * H && i.area > 1.6 * solidArea && i.b.max[1] <= all.min[1] + 0.05 * H) {
      log('drop ground plane', id, i.n.getName())
      i.n.setMesh(null)
    }
  }
}

async function models() {
  await MeshoptEncoder.ready
  await MeshoptSimplifier.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  fs.mkdirSync(path.join(OUT, 'models-lo'), { recursive: true })
  for (const [id, cfg0] of Object.entries(MODELS)) {
    if (only && !only.split(',').some(o => id === o || id.includes(o))) continue
    for (const lo of [false, true]) {
    const isRock = /rock|stone|boulder/.test(id)
    // furniture and props never need more than 512px; phones get 256 (rocks keep 512)
    const cfg = { ...cfg0, tex: lo ? (isRock ? 512 : cfg0.loTex ?? 256) : Math.min(cfg0.tex, isRock ? 1024 : 512) }
    const base = path.join(RAW, 'models', id)
    // Poly Haven ships .gltf + .bin + textures; the Khronos samples are self-contained .glb
    const src = [path.join(base, `${id}.gltf`), path.join(base, `${id}.glb`)].find(f => fs.existsSync(f))
    if (!src) { log('skip ', id); continue }
    const doc = await io.read(src)
    if (cfg.diffuseOnly) {
      for (const material of doc.getRoot().listMaterials()) {
        material.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null)
        material.setMetallicFactor(0).setRoughnessFactor(0.92)
        if (material.getAlphaMode() === 'BLEND') material.setAlphaMode('MASK').setAlphaCutoff(0.33)
      }
    }
    // some samples carry a presentation light; furniture must not light the room it stands in
    for (const node of doc.getRoot().listNodes()) node.setExtension('KHR_lights_punctual', null)
    sanitizeNames(doc)
    const before = triCount(doc)
    const ratio = Math.min(1, cfg.tris / before)
    // Sketchfab exports often use the old specular-glossiness workflow, which three.js no longer reads
    if (Object.hasOwn(objaverse, id)) {
      await doc.transform(metalRough(), unpartition())
      dropGroundPlanes(doc, id)
    }
    await doc.transform(
      dedup(),
      prune(),
      weld({}),
      ...(ratio < 0.98 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.error ?? 0.001, lockBorder: false })] : []),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 84 }),
      prune(),
      reorder({ encoder: MeshoptEncoder }),
    )
    // No EXT_meshopt_compression: its decoder is WebAssembly, which locked-down hosts (the artifact CSP) refuse.
    const dir = path.join(OUT, lo ? 'models-lo' : 'models')
    const { json, resources } = await io.writeJSON(doc)
    // geometry: one buffer, inline as base64. src/engine/models.ts decodes it itself; a strict host refuses to
    // fetch data: URLs, so the loader never hands this URI to GLTFLoader.
    if ((json.buffers ?? []).length !== 1) throw new Error(`${id}: expected one buffer, got ${json.buffers?.length ?? 0}`)
    for (const b of json.buffers) b.uri = `data:application/octet-stream;base64,${Buffer.from(resources[b.uri]).toString('base64')}`
    // textures: plain same-origin .webp files next to the model (fetched like any other texture)
    for (const f of fs.readdirSync(dir).filter(f => f.startsWith(`${id}_`) && f.endsWith('.webp'))) fs.unlinkSync(path.join(dir, f))
    let texBytes = 0
    ;(json.images ?? []).forEach((im, i) => {
      const name = `${id}_${i}.webp`
      fs.writeFileSync(path.join(dir, name), Buffer.from(resources[im.uri]))
      texBytes += resources[im.uri].byteLength
      im.uri = name
    })
    const out = path.join(dir, `${id}.json`)
    fs.writeFileSync(out, JSON.stringify(json))
    log('model', (lo ? 'lo ' : '') + id.padEnd(26), `${before} -> ${triCount(doc)} tris`, 'geometry', mb(fs.statSync(out).size), 'textures', mb(texBytes))
    }
  }
}

async function trees() {
  const src = path.join(ROOT, 'node_modules', '@dgreenheck', 'ez-tree', 'src', 'lib', 'assets')
  const jobs = [
    ['bark/pine_color_1k.jpg', 'pine_bark_d.webp', 82, 512],
    ['bark/pine_normal_1k.jpg', 'pine_bark_n.webp', 88, 512],
    ['bark/oak_color_1k.jpg', 'oak_bark_d.webp', 82, 512],
    ['bark/oak_normal_1k.jpg', 'oak_bark_n.webp', 88, 512],
    ['leaves/pine_color.png', 'pine_leaves.webp', 90, 512],
    ['leaves/aspen_color.png', 'aspen_leaves.webp', 90, 512],
    ['leaves/oak_color.png', 'oak_leaves.webp', 90, 512],
  ]
  for (const [from, to, q, size] of jobs) {
    if (!to.includes(only)) continue
    await sharp(path.join(src, from)).resize(size, size, { fit: 'inside' }).webp({ quality: q, alphaQuality: 100 }).toFile(path.join(OUT, 'trees', to))
    log('tree ', to, mb(fs.statSync(path.join(OUT, 'trees', to)).size))
  }
}

if (run('hdri')) await hdris()
if (run('tex')) await textures()
if (run('models')) await models()
if (run('trees')) await trees()
log('BUILD_ASSETS_OK')
