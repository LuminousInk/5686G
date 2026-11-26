// Renders a card thumbnail for every plan (hero view, no UI) into public/thumbs/<id>.webp.
// Needs the dev server running. node tools/thumbs.mjs [plan-id ...]
import { createRequire } from 'node:module'
import fs from 'node:fs'
import sharp from 'sharp'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = process.env.BASE ?? 'http://localhost:5173/'
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['cedar-ridge', 'coastal-modern', 'woodland-modern', 'aspen-custom', 'modern-farmhouse']
fs.mkdirSync('public/thumbs', { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const id of ids) {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 1 })).newPage()
  await page.goto(`${base}?quality=medium&frames=10&ui=0&plan=${id}`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 })
  await page.waitForFunction(() => window.__engine.pipeline.converged, null, { timeout: 600000 })
  const png = await page.screenshot()
  await sharp(png).resize(960, 480).webp({ quality: 82 }).toFile(`public/thumbs/${id}.webp`)
  console.log('thumb', id, fs.statSync(`public/thumbs/${id}.webp`).size)
  await page.close()
}
await browser.close()
