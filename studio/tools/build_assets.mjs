#!/usr/bin/env node
// Turns the raw Poly Haven downloads (.cache/raw, see fetch_assets.py) into web-ready files in public/assets/:
//   hdri/<id>_<res>.hdr                 copied as-is (RGBE)
//   tex/<id>_<res>_{d,n,arm}.webp        PBR maps (diffuse sRGB, OpenGL normal, AO/rough/metal)
//   models/<id>.glb                      simplified meshes (meshoptimizer), webp textures, meshopt-compressed
//   trees/*.webp                         ez-tree bark and needle textures
// Usage: node tools/build_assets.mjs [only-matching-substring]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, prune, weld, simplify, textureCompress, reorder, flatten, join } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW = path.join(ROOT, '.cache', 'raw')
const OUT = path.join(ROOT, 'public', 'assets')
const args = process.argv.slice(2)
const steps = args.filter(a => a.startsWith('--')).map(a => a.slice(2))
const only = args.find(a => !a.startsWith('--')) ?? ''
const run = (name) => !steps.length || steps.includes(name)

// target triangle counts (approximate) and texture size per model
const MODELS = {
  rock_moss_set_01: { tris: 12000, tex: 1024, error: 0.03 },
  rock_moss_set_02: { tris: 12000, tex: 1024, error: 0.03 },
  namaqualand_boulder_02: { tris: 6000, tex: 1024, error: 0.03 },
  namaqualand_boulders_01: { tris: 5000, tex: 1024, error: 0.03 },
  stone_01: { tris: 1200, tex: 512, error: 0.03 },
  rock_07: { tris: 1500, tex: 512, error: 0.03 },
  rock_09: { tris: 1200, tex: 512, error: 0.03 },
  fern_02: { tris: 6500, tex: 1024 },
  shrub_04: { tris: 16000, tex: 1024, error: 0.01 },
  sofa_03: { tris: 9000, tex: 1024 },
  Sofa_01: { tris: 9000, tex: 1024 },
  modern_arm_chair_01: { tris: 9000, tex: 1024 },
  mid_century_lounge_chair: { tris: 7000, tex: 1024 },
  coffee_table_round_01: { tris: 5000, tex: 1024 },
  modern_coffee_table_01: { tris: 5000, tex: 1024 },
  dining_table: { tris: 2000, tex: 1024 },
  dining_chair_02: { tris: 7000, tex: 512, error: 0.003 },
  bar_chair_round_01: { tris: 6000, tex: 512, error: 0.003 },
  modern_ceiling_lamp_01: { tris: 6000, tex: 512 },
  potted_plant_01: { tris: 30000, tex: 1024, error: 0.01 },
  potted_plant_02: { tris: 24000, tex: 1024, error: 0.01 },
  potted_plant_04: { tris: 6500, tex: 512, error: 0.006 },
  ceramic_vase_01: { tris: 3000, tex: 512, error: 0.004 },
  ceramic_vase_02: { tris: 3000, tex: 512, error: 0.004 },
  ceramic_vase_03: { tris: 3000, tex: 512 },
  ceramic_vase_04: { tris: 3000, tex: 512, error: 0.004 },
  throw_pillows_01: { tris: 6500, tex: 512 },
  side_table_01: { tris: 3000, tex: 512 },
  wooden_bowl_01: { tris: 3000, tex: 512, error: 0.004 },
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
    if (!id.includes(only)) continue
    for (const res of fs.readdirSync(path.join(base, id))) {
      const dir = path.join(base, id, res)
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

async function models() {
  await MeshoptEncoder.ready
  await MeshoptSimplifier.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  fs.mkdirSync(path.join(OUT, 'models-lo'), { recursive: true })
  for (const [id, cfg0] of Object.entries(MODELS)) {
    if (!id.includes(only)) continue
    for (const lo of [false, true]) {
    const isRock = /rock|stone|boulder/.test(id)
    // furniture and props never need more than 512px; phones get 256 (rocks keep 512)
    const cfg = { ...cfg0, tex: lo ? (isRock ? 512 : 256) : Math.min(cfg0.tex, isRock ? 1024 : 512) }
    const src = path.join(RAW, 'models', id, `${id}.gltf`)
    if (!fs.existsSync(src)) { log('skip ', id); continue }
    const doc = await io.read(src)
    const before = triCount(doc)
    const ratio = Math.min(1, cfg.tris / before)
    await doc.transform(
      dedup(),
      prune(),
      weld({}),
      ...(ratio < 0.98 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.error ?? 0.001, lockBorder: false })] : []),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 84 }),
      prune(),
      reorder({ encoder: MeshoptEncoder }),
    )
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
      method: EXTMeshoptCompression.EncoderMethod.FILTER,
    })
    // self-contained glTF JSON (buffers and webp textures as data URIs): served everywhere as .json
    const out = path.join(OUT, lo ? 'models-lo' : 'models', `${id}.json`)
    const { json, resources } = await io.writeJSON(doc)
    for (const b of json.buffers ?? []) {
      if (b.uri && resources[b.uri]) b.uri = `data:application/octet-stream;base64,${Buffer.from(resources[b.uri]).toString('base64')}`
    }
    for (const im of json.images ?? []) {
      if (im.uri && resources[im.uri]) im.uri = `data:${im.mimeType ?? 'image/webp'};base64,${Buffer.from(resources[im.uri]).toString('base64')}`
    }
    fs.writeFileSync(out, JSON.stringify(json))
    log('model', (lo ? 'lo ' : '') + id.padEnd(26), `${before} -> ${triCount(doc)} tris`, mb(fs.statSync(out).size))
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
