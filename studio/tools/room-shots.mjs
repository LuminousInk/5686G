// One eye-height shot per main room (corner looking at the opposite corner), for layout and lighting review.
//   BASE=http://localhost:4177/ OUT=shots/rooms node tools/room-shots.mjs <plan-id> [room-id ...]
// env: TIME (golden|day|dusk|night, default golden), Q (quality, default low), W/H (viewport, default 900x560),
//      TOP=1 adds a straight-down dollhouse shot of the whole home (<OUT>_<plan>_top.png).
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = process.env.BASE ?? 'http://localhost:4173/'
const out = process.env.OUT ?? 'shots/rooms'
mkdirSync(dirname(out), { recursive: true })
const [id, ...only] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: +(process.env.W ?? 900), height: +(process.env.H ?? 560) } })
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto(`${base}?plan=${id}&time=${process.env.TIME ?? 'golden'}&quality=${process.env.Q ?? 'low'}&frames=4&sheet=none&ui=0`)
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 })
const rooms = await page.evaluate(() => window.__engine.plan.rooms.filter(r => !['closet', 'laundry', 'garage'].includes(r.type)).map(r => ({ id: r.id, type: r.type, rect: r.rect })))
const fy = await page.evaluate(() => window.__engine.plan.floorY)
for (const r of rooms) {
  if (only.length && !only.includes(r.id)) continue
  const [x0, z0, x1, z1] = r.rect
  const pos = [x0 + 0.5, fy + 1.55, z1 - 0.5]
  const target = [x1 - 0.3, fy + 0.95, z0 + 0.3]
  await page.evaluate(([pos, target]) => window.__nav.goToView({ id: 'review', label: 'review', kind: 'walk', pos, target, fov: 75 }, false), [pos, target])
  await page.waitForTimeout(800)
  await page.waitForFunction(() => window.__engine.pipeline.converged, null, { timeout: 60000 }).catch(() => {})
  await page.screenshot({ path: `${out}_${id}_${r.id}.png` })
  console.log('shot', r.id, r.type)
}
if (process.env.TOP) {
  const box = await page.evaluate(() => { const b = window.__engine.house.bounds; return [b.min.x, b.min.z, b.max.x, b.max.z] })
  const [x0, z0, x1, z1] = box
  await page.evaluate(([cx, cz, h]) => {
    const e = window.__engine
    e.setDollhouse(true)
    e.house.roof.visible = false
    e.house.ceilings.visible = false
    window.__nav.goToView({ id: 'top', label: 'top', kind: 'orbit', pos: [cx, h, cz + 0.5], target: [cx, 0, cz], fov: 50 }, false)
  }, [(x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) * 1.15 + 4])
  await page.waitForTimeout(3000)
  await page.waitForFunction(() => window.__engine.pipeline.converged, null, { timeout: 60000 }).catch(() => {})
  await page.screenshot({ path: `${out}_${id}_top.png` })
  console.log('shot top')
}
console.log(errs.length ? errs.slice(0, 3) : 'no page errors')
await browser.close()
