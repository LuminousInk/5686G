// Render the catalog from a Vite preview. Pass image IDs to re-shoot a selection.
// BASE=http://localhost:4187/ node tools/gallery.mjs [id ...]
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = new URL(process.env.BASE ?? 'http://localhost:4187/')
const out = new URL('../public/gallery/', import.meta.url)
const width = 1600
const height = 900
const frames = Number(process.env.FRAMES ?? 12)
if (!Number.isInteger(frames) || frames < 1) throw new Error('FRAMES must be a positive integer')

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
async function withPage(run) {
  const browser = await chromium.launch({ args })
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', error => {
      errors.push(error.message)
      console.error(error.message)
    })
    page.setDefaultTimeout(420_000)
    return await run(page, errors)
  } finally {
    await browser.close()
  }
}

async function capture(page, entry, errors) {
  await page.waitForFunction(() => window.__ready === true || document.querySelector('.loading-error'))
  const failure = await page.locator('.loading-error').textContent({ timeout: 150 }).catch(() => null)
  if (failure || errors.length) throw new Error(`${entry.id}: ${failure ?? errors.join('; ')}`)
  await page.waitForFunction(() => {
    const { pipeline, quality } = window.__engine
    return quality.tier === 'high' && pipeline.converged && !pipeline.meter.pending
  })
  const size = await page.locator('.stage').evaluate(canvas => [canvas.width, canvas.height])
  if (size[0] !== width || size[1] !== height) throw new Error(`${entry.id}: unexpected render size ${size.join('×')}`)
  const png = await page.screenshot({ timeout: 120_000 })
  let quality = 92
  let webp = await sharp(png).webp({ quality, effort: 5 }).toBuffer()
  while (webp.length > 350_000 && quality > 65) {
    quality -= 3
    webp = await sharp(png).webp({ quality, effort: 5 }).toBuffer()
  }
  if (webp.length < 200_000) {
    const detailed = await sharp(png).webp({ quality: 98, effort: 5 }).toBuffer()
    if (detailed.length <= 350_000) webp = detailed
  }
  await writeFile(new URL(`${entry.id}.webp`, out), webp)
  return Math.round(webp.length / 1000)
}

const catalog = await withPage(async page => {
  const url = new URL(base)
  url.searchParams.set('gallery', 'catalog')
  url.hash = '#studio'
  await page.goto(url.href)
  await page.waitForFunction(() => !!window.__gallery)
  return page.evaluate(() => window.__gallery)
})
const ids = process.argv.slice(2)
for (const id of ids) if (!catalog.images.some(image => image.id === id)) throw new Error(`Unknown gallery image: ${id}`)
await mkdir(out, { recursive: true })

for (const home of catalog.homes) {
  // Reuse geometry and lighting between stills and release the GPU between homes.
  const shots = catalog.images
    .filter(entry => entry.plan === home.id && (!ids.length || ids.includes(entry.id)))
    .sort((a, b) => a.light.localeCompare(b.light))
  if (!shots.length) continue
  await withPage(async (page, errors) => {
    const url = new URL(base)
    url.search = new URLSearchParams({ gallery: '1', quality: 'high', frames: String(frames), sheet: 'none', ui: '0' })
    url.hash = shots[0].share
    await page.goto(url.href)
    for (const [index, entry] of shots.entries()) {
      const start = Date.now()
      console.log(`Rendering ${entry.id}`)
      if (index > 0) {
        await page.evaluate(hash => {
          window.__ready = false
          location.hash = hash
        }, entry.share)
      }
      const kilobytes = await capture(page, entry, errors)
      console.log(`${entry.id} · ${kilobytes} KB · ${Math.round((Date.now() - start) / 1000)} s`)
    }
  })
}

await writeFile(new URL('gallery.json', out), JSON.stringify(catalog, null, 2) + '\n')
