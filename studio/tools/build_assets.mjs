#!/usr/bin/env node
// Turns the raw Poly Haven downloads (.cache/raw, see fetch_assets.py) into web-ready files in public/assets/:
//   hdri/<id>_<res>.hdr                 copied as-is (RGBE)
//   tex/<id>_<res>_{d,n,arm}.webp        PBR maps (diffuse sRGB, OpenGL normal, AO/rough/metal)
//   models/<id>.json + <id>_<n>.webp  simplified meshes as glTF JSON (one inline buffer, no meshopt:
//                                        hosts may refuse WebAssembly) with textures as separate webp files
//   trees/*.webp                         ez-tree bark and needle textures
//   art/*.webp and manifest.json          Art Institute of Chicago prints (see fetch_art.py)
// Usage: node tools/build_assets.mjs [only-matching-substring]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, flatten, getBounds, join, metalRough, prune, quantize, reorder, simplify, textureCompress, unpartition, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { Matrix4, Vector3 } from 'three'

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
  fern_02: { tris: 6500, tex: 512 },
  shrub_04: { tris: 16000, tex: 512, error: 0.01 },
  shrub_03: { tris: 1600, tex: 512, error: 0.02, diffuseOnly: true },
  grass_medium_01: { tris: 2400, tex: 512, error: 0.025, diffuseOnly: true },
  coffee_table_round_01: { tris: 5000, tex: 512 },
  potted_plant_01: { tris: 14000, tex: 512, error: 0.016, quantize: true },
  potted_plant_04: { tris: 6500, tex: 512, error: 0.006 },
  ceramic_vase_02: { tris: 3000, tex: 512, error: 0.004 },
  wooden_bowl_01: { tris: 3000, tex: 512, error: 0.004 },
  modern_wooden_cabinet: { tris: 7500, tex: 1024, error: 0.012, quantize: true },
  modern_arm_chair_01: { tris: 5800, tex: 1024, error: 0.01, quantize: true },
  side_table_01: { tris: 2500, tex: 512, quantize: true },
  modern_ceiling_lamp_01: { tris: 4200, tex: 512, error: 0.005, quantize: true },
  potted_plant_02: { tris: 12500, tex: 512, error: 0.018, quantize: true },
  book_encyclopedia_set_01: { tris: 2000, tex: 512, error: 0.02, quantize: true },
  throw_pillows_01: { tris: 2700, tex: 512, error: 0.012, quantize: true },
  wooden_table_02: { tris: 1100, tex: 1024, quantize: true },
  // Khronos glTF Sample Assets (Wayfair, CC0), with sheen and texture transforms.
  SheenChair: { tris: 9000, tex: 512, error: 0.011, quantize: true },
  // Objaverse (Sketchfab, CC BY 4.0; authors in tools/objaverse.json, fetched by tools/fetch_objaverse.py)
  bench_upholstered: { tris: 7000, tex: 512, error: 0.02, quantize: true },
  pendant_dome: { tris: 4200, tex: 512, error: 0.018, quantize: true },
  dining_linear_pendant: { tris: 3500, tex: 512, error: 0.02, quantize: true },
  stool_counter_back: { tris: 3800, tex: 512, error: 0.018, quantize: true },
  bed_oak_linen: { tris: 11000, tex: 1024, error: 0.016, quantize: true },
  sofa_linen: { tris: 9000, tex: 512, error: 0.017, quantize: true },
  nightstand_oak: { tris: 3000, tex: 512, quantize: true },
  media_console_oak: { tris: 4500, tex: 1024, quantize: true },
  desk_wood: { tris: 3500, tex: 1024, error: 0.012, quantize: true },
  floor_lamp_tripod: { tris: 5000, tex: 512, error: 0.02, quantize: true },
  bath_angelo: { tris: 3500, tex: 512, quantize: true },
  vessel_sink_white: { tris: 3000, tex: 512, error: 0.015, quantize: true },
  oven_built_in: { tris: 5000, tex: 512, error: 0.016, quantize: true },
  washer_front_load: { tris: 5500, tex: 512, error: 0.025, quantize: true },
  dining_table_trestle: { tris: 5000, tex: 1024, error: 0.022, quantize: true },
  table_lamp_ceramic: { tris: 3800, tex: 512, error: 0.022, quantize: true },
  table_lamp_white: { tris: 3000, tex: 512, error: 0.017, quantize: true },
  sofa_beige: { tris: 11000, tex: 512, error: 0.014, quantize: true },
  sectional_grey: { tris: 15000, tex: 1024, error: 0.013, quantize: true },
  sideboard_midcentury: { tris: 6800, tex: 512, error: 0.015, quantize: true },
  dining_chair_bentwood: { tris: 5100, tex: 512, error: 0.013, quantize: true },
  bar_stool_wood: { tris: 5000, tex: 512, error: 0.013, quantize: true },
  fridge_steel: { tris: 6000, tex: 512, error: 0.012, quantize: true },
  kitchen_faucet: { tris: 3500, tex: 512, error: 0.015, quantize: true },
  bed_dark_headboard: { tris: 11000, tex: 512, error: 0.015, quantize: true },
  dresser_tall: { tris: 7800, tex: 512, error: 0.015, quantize: true },
  treadmill_gym: { tris: 4700, tex: 512, error: 0.014, quantize: true },
  toilet_modern: { tris: 6000, tex: 512, error: 0.012, quantize: true },
  shower_black: { tris: 5500, tex: 512, error: 0.022, quantize: true },
  desk_lamp_black: { tris: 4200, tex: 512, error: 0.018, quantize: true },
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
  // Old raw caches can still contain these replaced sets.
  const retired = new Set(['laminate_floor_02', 'large_grey_tiles', 'long_white_tiles'])
  for (const id of fs.readdirSync(base)) {
    if (retired.has(id)) continue
    if (only && !only.split(',').some(o => id === o || id.includes(o))) continue
    for (const res of fs.readdirSync(path.join(base, id))) {
      const dir = path.join(base, id, res)
      if (COASTAL_DIFFUSE.has(id)) {
        await sharp(path.join(dir, 'Diffuse.jpg')).resize(512, 512).webp({ quality: 83, effort: 5 })
          .toFile(path.join(OUT, 'tex', `${id}_512_d.webp`))
        continue
      }
      if (id.startsWith('ambientcg_')) {
        for (const [label, size] of [['1k', 1024], ['512', 512]]) {
          const out = suffix => path.join(OUT, 'tex', `${id}_${label}_${suffix}.webp`)
          const diffuse = sharp(path.join(dir, 'Diffuse.jpg')).resize(size, size)
          // The wall palette supplies the pigment. Keep the plaster's small tonal changes in the colour map.
          if (id === 'ambientcg_plaster001') diffuse.linear(0.8, 70)
          if (id === 'ambientcg_marble019') diffuse.modulate({ saturation: 0.55 }).linear(0.72, 65)
          if (id === 'ambientcg_tiles142') diffuse.modulate({ saturation: 0.72 })
          await diffuse.webp({ quality: 86, effort: 5 }).toFile(out('d'))
          await sharp(path.join(dir, 'nor_gl.jpg')).resize(size, size)
            .webp({ quality: 92, effort: 5 }).toFile(out('n'))
          const channel = file => sharp(path.join(dir, file)).resize(size, size).extractChannel(0).raw().toBuffer()
          const aoPath = path.join(dir, 'ao.jpg')
          const [rough, ao] = await Promise.all([
            channel('rough.jpg'),
            fs.existsSync(aoPath) ? channel('ao.jpg') : Buffer.alloc(size * size, 255),
          ])
          const arm = Buffer.alloc(size * size * 3)
          for (let i = 0; i < rough.length; i++) {
            arm[i * 3] = ao[i]
            // Bring the stone tile out of polished territory. Quantise roughness before lossless packing
            // to keep 512 px downloads small while preserving the neutral AO and metal channels.
            const value = id === 'ambientcg_tiles142' ? 94 + 0.66 * rough[i] : rough[i]
            arm[i * 3 + 1] = Math.min(255, Math.round(value / 8) * 8)
          }
          await sharp(arm, { raw: { width: size, height: size, channels: 3 } })
            .webp({ lossless: true }).toFile(out('arm'))
        }
        log('tex  ', id, res)
        continue
      }
      const jobs = [
        ['Diffuse.jpg', 'd', 84],
        ['nor_gl.jpg', 'n', 90],
        ['arm.jpg', 'arm', 86],
      ]
      const image = (src, suffix) => {
        const map = sharp(path.join(dir, src))
        if (id === 'oak_wood_planks' && suffix === 'd') {
          // Lightly bleached, oil-finished oak. Preserve the grain and reduce the source varnish's orange cast.
          map.recomb([[0.83, 0.13, 0.04], [0.08, 0.89, 0.03], [0.14, 0.17, 0.69]]).linear(1.08, 21)
        }
        if (id === 'oak_wood_planks' && suffix === 'arm') map.linear([1, 0.75, 1], [0, 65, 0])
        return map
      }
      for (const [src, suffix, q] of jobs) {
        const out = path.join(OUT, 'tex', `${id}_${res}_${suffix}.webp`)
        await image(src, suffix).webp({ quality: q, effort: 5 }).toFile(out)
      }
      const total = jobs.reduce((s, [, suffix]) => s + fs.statSync(path.join(OUT, 'tex', `${id}_${res}_${suffix}.webp`)).size, 0)
      log('tex  ', id, res, mb(total))
      if (res === '1k') {
        // phone variant: half resolution
        for (const [src, suffix, q] of jobs) {
          await image(src, suffix).resize(512, 512).webp({ quality: q, effort: 5 }).toFile(path.join(OUT, 'tex', `${id}_512_${suffix}.webp`))
        }
      }
    }
  }
}

function triCount(doc) {
  let n = 0
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4) continue
      const idx = p.getIndices()
      n += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3
    }
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

async function prepareFurniture(doc, id) {
  const root = doc.getRoot()
  if (id === 'floor_lamp_tripod') {
    // The cord and plug extend past the tripod's usable footprint.
    for (const node of root.listNodes()) {
      if (/^(Cable|Electrical-Plug)_/.test(node.getName())) node.dispose()
    }
  }
  if (id === 'pendant_dome') {
    // Keep the spun shade and cut the cord to each plan's ceiling height at placement time.
    for (const node of root.listNodes()) {
      if (/^cable(?:_|$)/i.test(node.getName())) node.dispose()
    }
  }
  if (id === 'shower_black') {
    // The brassware's individual millimetre-scale spray nozzles account for most source triangles.
    for (const node of root.listNodes()) {
      if (/^Circle\d+$/.test(node.getName())) node.dispose()
    }
  }
  if (id === 'throw_pillows_01') {
    // Keep the scanned folds and the fabric weave in a solid olive accent.
    for (const node of root.listNodes()) {
      if (node.getName().endsWith('_pillow01')) node.dispose()
    }
  }
  if (id === 'book_encyclopedia_set_01') {
    // Keep four neighboring volumes and lay the original meshes on their sides.
    const turn = new Matrix4().makeRotationZ(Math.PI / 2)
    for (const node of root.listNodes()) {
      if (!/_book0[4-7]$/.test(node.getName())) node.dispose()
      else node.setMatrix(new Matrix4().fromArray(node.getMatrix()).premultiply(turn).toArray())
    }
  }
  if (id === 'bed_oak_linen') {
    // Hem the bottom of the drape at the foot so the bed frame takes the floor contact.
    const nodes = root.listNodes()
    const duvet = nodes.find(node => node.getName() === 'queen_bed_Curtins1_0')
    const headboard = nodes.find(node => node.getName() === 'pCube42143476_fabric_brown_0')
    const floor = getBounds(headboard).min[1] + 0.07
    const matrix = new Matrix4().fromArray(duvet.getWorldMatrix())
    const inverse = matrix.clone().invert()
    const vertex = new Vector3()
    const xyz = [0, 0, 0]
    for (const primitive of duvet.getMesh().listPrimitives()) {
      const positions = primitive.getAttribute('POSITION')
      for (let i = 0; i < positions.getCount(); i++) {
        vertex.fromArray(positions.getElement(i, xyz)).applyMatrix4(matrix)
        if (vertex.y < floor) {
          vertex.y = floor
          positions.setElement(i, vertex.applyMatrix4(inverse).toArray(xyz))
        }
      }
    }
  }
  for (const material of root.listMaterials()) {
    if (id === 'SheenChair' && material.getName().includes('Mango Velvet')) {
      material.setBaseColorFactor([0.38, 0.20, 0.125, 1])
      material.getExtension('KHR_materials_sheen')?.setSheenColorFactor([0.41, 0.27, 0.19])
    }
    if (id === 'sectional_grey' && material.getName() === 'Tela_Victoria') {
      material.setBaseColorFactor([0.97, 0.9, 0.81, 1])
    }
    if (id === 'sofa_linen' && material.getMetallicFactor() === 0) {
      const upholstery = material.getBaseColorTexture()
      if (upholstery) {
        const image = await sharp(upholstery.getImage()).linear([0.81, 0.75, 0.67], [56, 54, 54]).png().toBuffer()
        upholstery.setImage(image).setMimeType('image/png')
      }
    }
    if (id === 'throw_pillows_01') {
      material.setBaseColorTexture(null).setBaseColorFactor([0.25, 0.27, 0.16, 1])
        .setMetallicFactor(0).setRoughnessFactor(0.93)
    }
    if (id === 'pendant_dome') {
      material.setBaseColorTexture(null).setBaseColorFactor([0.36, 0.24, 0.13, 1])
        .setMetallicRoughnessTexture(null).setMetallicFactor(0.76).setRoughnessFactor(0.37)
    }
    if (id === 'table_lamp_ceramic' && material.getName() === 'fabric.002') {
      material.setEmissiveFactor([0.13, 0.090, 0.054])
    }
    if (id === 'floor_lamp_tripod' && material.getName() === 'Lamp_Shade_Outside') {
      material.setBaseColorTexture(null).setBaseColorFactor([0.72, 0.61, 0.49, 1]).setMetallicFactor(0)
    }
    if (id === 'washer_front_load') {
      material.setExtension('KHR_materials_ior', null).setExtension('KHR_materials_specular', null)
        .setEmissiveTexture(null).setAlphaMode('OPAQUE').setRoughnessFactor(0.45)
    }
  }
}

async function models() {
  await MeshoptEncoder.ready
  await MeshoptSimplifier.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  for (const [id, cfg] of Object.entries(MODELS)) {
    if (only && !only.split(',').some(o => id === o || id.includes(o))) continue
    const base = path.join(RAW, 'models', id)
    // Poly Haven ships .gltf + .bin + textures; the Khronos samples are self-contained .glb
    const src = [path.join(base, `${id}.gltf`), path.join(base, `${id}.glb`)].find(f => fs.existsSync(f))
    if (!src) { log('skip ', id); continue }
    const doc = await io.read(src)
    await prepareFurniture(doc, id)
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
    // Sketchfab exports often use the old specular-glossiness workflow, which three.js no longer reads
    if (Object.hasOwn(objaverse, id)) {
      await doc.transform(metalRough(), unpartition())
      dropGroundPlanes(doc, id)
    }
    // Batch fixed parts before measuring the triangle budget so repeated meshes count once per use.
    // Keep the bed's named fabrics for the room styling.
    const batch = cfg.quantize && id !== 'bed_oak_linen'
    await doc.transform(dedup(), prune(), ...(batch ? [flatten(), join()] : []), weld({}))
    const ratio = Math.min(1, cfg.tris / triCount(doc))
    await doc.transform(
      ...(ratio < 0.98 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.error ?? 0.001, lockBorder: false })] : []),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 84 }),
      prune(),
      ...(cfg.quantize ? [quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 })] : []),
      reorder({ encoder: MeshoptEncoder }),
    )
    // No EXT_meshopt_compression: its decoder is WebAssembly, which locked-down hosts (the artifact CSP) refuse.
    const dir = path.join(OUT, 'models')
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
    log('model', id.padEnd(26), `${before} -> ${triCount(doc)} tris`, 'geometry', mb(fs.statSync(out).size), 'textures', mb(texBytes))
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

async function art() {
  const src = path.join(RAW, 'art')
  const dest = path.join(OUT, 'art')
  const metadata = path.join(src, 'manifest.json')
  if (!fs.existsSync(metadata)) {
    if (steps.includes('art')) throw new Error('Run tools/fetch_art.py before building art assets')
    return
  }
  fs.mkdirSync(dest, { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(metadata, 'utf8'))
  for (const [id, work] of Object.entries(manifest)) {
    const file = path.join(dest, `${id}.webp`)
    if (!only || id.includes(only)) {
      await sharp(path.join(src, `${id}.jpg`)).rotate().resize(512, 512, { fit: 'inside' })
        .webp({ quality: 84 }).toFile(file)
    }
    const { width, height } = await sharp(file).metadata()
    Object.assign(work, { width, height })
  }
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

if (run('hdri')) await hdris()
if (run('tex')) await textures()
if (run('models')) await models()
if (run('trees')) await trees()
if (run('art')) await art()
log('BUILD_ASSETS_OK')
