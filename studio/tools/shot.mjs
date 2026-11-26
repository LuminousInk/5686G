// Headless screenshot of the running dev server.
// node tools/shot.mjs "<url-query>" out.png [width height] [--mobile]
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')
const [query = '', out = 'shot.png', w = '1600', h = '900'] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const mobile = process.argv.includes('--mobile')
const base = process.env.BASE ?? 'http://localhost:5173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = mobile ? await browser.newContext({ ...devices['iPhone 13'] }) : await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`) })
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`))
const t0 = Date.now()
await page.goto(base + query, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 }).catch(e => logs.push('timeout waiting ready ' + e.message))
const tReady = Date.now()
await page.waitForFunction(() => window.__engine && window.__engine.pipeline.converged, null, { timeout: 600000 }).catch(e => logs.push('timeout converge ' + e.message))
const stats = await page.evaluate(() => ({ ...window.__engine?.stats, dpr: window.__engine?.dpr, tier: window.__engine?.quality.tier }))
await page.screenshot({ path: out })
console.log(JSON.stringify({ readyMs: tReady - t0, totalMs: Date.now() - t0, stats }))
console.log(logs.slice(0, 40).join('\n'))
await browser.close()
