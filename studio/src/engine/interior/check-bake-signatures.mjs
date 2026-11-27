// Run on the original full preview with --record, then on the styled preview with the same file.
//   node src/engine/interior/check-bake-signatures.mjs http://localhost:4208/ shots/bake-signatures.json [--record|--check] [PLAN...]
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright')

const [base, file, mode = '--check', ...selected] = process.argv.slice(2)
const homes = ['cedar-ridge', 'coastal-modern', 'woodland-modern', 'aspen-custom', 'modern-farmhouse']
if (!base || !file || !['--record', '--check'].includes(mode) || selected.some(plan => !homes.includes(plan))) {
  throw new Error('Usage: node check-bake-signatures.mjs PREVIEW_URL BASELINE_JSON [--record|--check] [PLAN...]')
}

const record = mode === '--record'
const plans = selected.length ? selected : homes
const baseline = JSON.parse(await readFile(file, 'utf8').catch(error => {
  if (record && error.code === 'ENOENT') return '{}'
  throw error
}))
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
try {
  for (const plan of plans) {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
    try {
      await page.route(/fonts\.(googleapis|gstatic)\.com/, route =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
      // The runtime binder calls collectBakeMeshes and bakeSignature on the same scene as exportForBake.
      // A mismatched sidecar exposes the calculated signature, then skips the atlas download and layout.
      await page.route(/\/assets\/lightmaps\/[^/]+-(golden|day)\.json$/, route => {
        const preset = new URL(route.request().url()).pathname.endsWith('-day.json') ? 'day' : 'golden'
        return route.fulfill({ json: { plan, preset, signature: 'signature-check' } })
      })
      const url = new URL(base)
      url.search = new URLSearchParams({ plan, time: 'golden', quality: 'medium', frames: '1', sheet: 'none', ui: '0', gallery: 'export' })
      url.hash = 'studio'
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(url.href)
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 600_000 })
      const result = await page.evaluate(async () => {
        const engine = window.__engine
        const golden = engine.lightmapStatus
        await engine.setTime('day')
        await engine.refreshLightmap()
        return { golden, day: engine.lightmapStatus }
      })
      assert.deepEqual(errors, [])
      for (const [preset, meta] of Object.entries(result)) {
        const key = `${plan}/${preset}`
        assert.equal(meta.plan, plan)
        assert.equal(meta.preset, preset)
        assert.equal(meta.reason, 'bake signature mismatch')
        assert.match(meta.signature, /^gi\d+-[0-9a-f]+$/)
        if (!record || baseline[key]) assert.equal(meta.signature, baseline[key], key)
        baseline[key] = meta.signature
        console.log(key, meta.signature, record ? 'recorded' : 'match')
      }
      if (record) await writeFile(file, JSON.stringify(baseline, null, 2) + '\n')
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
