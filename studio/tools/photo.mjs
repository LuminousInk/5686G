// Starts photo mode (path tracer), waits for a few samples, finishes and saves the result image.
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = process.env.BASE ?? 'http://localhost:5173/'
const want = Number(process.env.SAMPLES ?? 3)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: Number(process.env.W ?? 640), height: Number(process.env.H ?? 360) } })).newPage()
const logs = []
page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('Texture marked')) logs.push(m.type() + ': ' + m.text().slice(0, 240)) })
page.on('pageerror', e => logs.push('pageerror: ' + e.message))
await page.goto(base + '?quality=low&frames=2&sheet=none' + (process.env.Q ?? ''))
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
await page.waitForTimeout(1500)
const t0 = Date.now()
await page.click('.actions .icon-btn[aria-label="Render a photo"]')
await page.waitForFunction(n => {
  const el = document.querySelector('.photo-count')
  return el && parseInt(el.textContent) >= n
}, want, { timeout: 900000 }).catch(e => logs.push('wait samples: ' + e.message))
console.log('samples reached after', ((Date.now() - t0) / 1000).toFixed(1), 's')
await page.screenshot({ path: 'shots/photo_progress.png' })
await page.click('.photo-bar .btn').catch(() => {})
await page.waitForSelector('.photo-result img', { timeout: 120000 }).catch(e => logs.push('no result ' + e.message))
const src = await page.$eval('.photo-result img', el => el.getAttribute('src')).catch(() => null)
if (src) fs.writeFileSync('shots/photo_result.jpg', Buffer.from(src.split(',')[1], 'base64'))
console.log(src ? 'result saved' : 'no result')
console.log(logs.slice(0, 20).join('\n'))
await browser.close()
