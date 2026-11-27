// Drives the UI like a person would and saves screenshots of each state.
// node tools/interact.mjs [--mobile]
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')
const mobile = process.argv.includes('--mobile')
const base = process.env.BASE ?? 'http://localhost:5173/'
const out = process.env.OUT ?? 'shots/ix'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = mobile ? await browser.newContext({ ...devices['iPhone 13'] }) : await browser.newContext({ viewport: { width: 1440, height: 860 } })
// The page loads Chakra Petch from Google Fonts; keep tests hermetic (and fast behind a proxy) with an empty stylesheet.
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200))
})
await page.goto(base + '?quality=low&frames=2')
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
const settle = async () => {
  await page.waitForTimeout(400)
  await page.waitForFunction(() => window.__engine.pipeline.converged || window.__engine.paused, null, { timeout: 120000 }).catch(() => {})
}
const shot = async name => {
  await settle()
  await page.screenshot({ path: `${out}_${mobile ? 'm' : 'd'}_${name}.png` })
  console.log('shot', name)
}
const vp = page.viewportSize()
const cx = vp.width / 2
const cy = vp.height / 2

// drag helper that works for mouse and touch-like pointers (the app listens to pointer events)
const drag = async (x0, y0, x1, y1, steps = 10) => {
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)
  await page.mouse.up()
}

await shot('01-start')
await page.click('.sheet-plans .icon-btn')
await page.click('.mode:has-text("Walk")')
await page.waitForTimeout(2500)
await shot('02-walk')
// drag downward = look up (grab the world)
await drag(cx, cy - 100, cx, cy + 140)
await shot('03-walk-lookup')
console.log('pitch after drag (rad):', (await page.evaluate(() => window.__nav.pitch)).toFixed(3))
// look back down, then tap the floor ahead to walk there
await drag(cx, cy + 100, cx, cy - 160)
await page.mouse.click(cx, vp.height * 0.78)
await page.waitForTimeout(2500)
console.log('feet after tap-walk:', await page.evaluate(() => window.__nav.feet.toArray().map(v => +v.toFixed(2))))
await shot('04-walked')
await page.click('.mode:has-text("Dollhouse")')
await page.waitForTimeout(2500)
await shot('05-dollhouse')
await page.click('.mode:has-text("Floor plan")')
await shot('06-plan')
await page.click('.plan-overlay .icon-btn')
await page.waitForTimeout(2200)
await page.click('.btn-style')
await page.click('.swatch[title="Charred Cedar"]')
await shot('07-style')
await page.click('.sheet-custom .icon-btn')
await page.click('.actions .icon-btn[aria-label="Edit plan"]')
await page.waitForTimeout(800)
const blocks = await page.$$('.ed-block')
const bb = await blocks[0].boundingBox()
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
await page.waitForTimeout(300)
const handles = await page.$$('.ed-handle')
if (handles.length > 1) {
  const h = await handles[1].boundingBox()
  await drag(h.x + h.width / 2, h.y + h.height / 2, h.x + h.width / 2, h.y + h.height / 2 + 48, 8)
}
await page.waitForTimeout(1500)
await shot('08-editor')
if (mobile) {
  // phones: the 3D button turns the editor into a bottom sheet over the live model
  await page.click('.tool-3d')
  await page.waitForTimeout(1500)
  await shot('09-editor-3d')
}
console.log(errors.length ? errors.slice(0, 15).join('\n') : 'no page errors')
await browser.close()
