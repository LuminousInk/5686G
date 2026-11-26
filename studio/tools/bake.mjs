// Bakes interior lightmaps for the shipped plans (see src/engine/bake and tools/bake/bake.py).
//
//   npm run build && npx vite preview        (or BASE=... to point at a running build)
//   node tools/bake.mjs [plan-id ...] [--times golden,day] [--samples 256]
//
// For each plan and time of day: loads the home in headless Chromium, exports it with window.__bakeExport (GLB,
// world-space sky, sun), bakes with Blender Cycles (the bake venv) and writes public/assets/lightmaps/. Re-bake
// whenever house or furniture geometry changes: the app refuses a lightmap whose signature does not match.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = process.env.BASE ?? 'http://localhost:4173/'
const PY = process.env.BAKE_PYTHON ?? '/root/.venvs/bake/bin/python'
const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const times = (opt('--times') ?? 'golden,day').split(',')
const samples = opt('--samples') ?? '256'
const flagValues = new Set([opt('--times'), opt('--samples')])
const plans = args.filter(a => !a.startsWith('--') && !flagValues.has(a))
const work = path.resolve('.cache/bake')
const out = path.resolve('public/assets/lightmaps')
fs.mkdirSync(work, { recursive: true })

const ids = plans.length ? plans : ['cedar-ridge', 'coastal-modern', 'woodland-modern', 'aspen-custom', 'modern-farmhouse']
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const id of ids) {
  for (const t of times) {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const t0 = Date.now()
    await page.goto(`${base}?plan=${id}&time=${t}&quality=medium&frames=1&sheet=none&ui=0`)
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 })
    const r = await page.evaluate(() => window.__bakeExport())
    await page.close()
    if (errors.length) console.log('page errors:', errors.slice(0, 3))
    const prefix = path.join(work, `${id}-${t}`)
    fs.writeFileSync(`${prefix}.glb`, Buffer.from(r.glb, 'base64'))
    fs.writeFileSync(`${prefix}.sky.f32`, Buffer.from(r.sky, 'base64'))
    fs.writeFileSync(`${prefix}.json`, JSON.stringify(r.meta))
    console.log(`exported ${id}-${t}: ${r.meta.charts} charts, ${(fs.statSync(`${prefix}.glb`).size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
    const log = execFileSync(PY, [path.resolve('tools/bake/bake.py'), prefix, out, '--samples', samples], { encoding: 'utf8', maxBuffer: 64e6 })
    console.log(log.split('\n').filter(l => l.startsWith('BAKED')).join('\n'))
  }
}
await browser.close()
