// Export a studio view in Chromium and render it offline in Blender Cycles.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { chromium } = createRequire(import.meta.url)('playwright')
const script = fileURLToPath(new URL('./render.py', import.meta.url))
const timeout = 420_000
const times = ['golden', 'day', 'dusk', 'night']
const browserArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const numericFlags = ['samples', 'threads', 'focus', 'f-stop', 'ev', 'white-balance', 'bevel-scale', 'haze']
const renderFlags = {
  ...Object.fromEntries(numericFlags.map(name => [name, { type: 'string' }])),
  size: { type: 'string' },
}
const base = () => new URL(process.env.BASE ?? 'http://localhost:4201/')

async function withBrowser(run) {
  const browser = await chromium.launch({ args: browserArgs })
  try {
    return await run(browser)
  } finally {
    await browser.close()
  }
}

export async function readCatalog(browser, address = base()) {
  const page = await browser.newPage()
  try {
    const url = new URL(address)
    url.searchParams.set('gallery', 'catalog')
    url.hash = '#studio'
    await page.goto(url.href)
    await page.waitForFunction(() => !!window.__gallery, null, { timeout })
    const catalog = await page.evaluate(() => window.__gallery)
    for (const [id, camera, lighting] of [
      ['woodland-garden-day', 'woodland-modern-golden', 'woodland-day'],
      ['aspen-walkout-dusk', 'aspen-custom-golden', 'aspen-dusk'],
    ]) {
      const source = catalog.images.find(image => image.id === camera)
      const light = catalog.images.find(image => image.id === lighting)
      if (!source || !light) throw new Error(`Missing comparison source for ${id}`)
      const time = light.share.split('-')[2]
      catalog.images.push({ ...source, id, light: light.light, share: source.share.replace(/^(#c-\d+-)\d+/, (_, prefix) => prefix + time) })
    }
    return catalog
  } finally {
    await page.close()
  }
}

function parsePose(raw) {
  const [position, target, lens, mode = 'walk', ...extra] = raw.split(';')
  const tuple = text => (text ?? '').split(',').filter(value => value.trim()).map(Number)
  const pos = tuple(position)
  const look = tuple(target)
  const fov = Number(lens)
  if (pos.length !== 3 || look.length !== 3 || ![...pos, ...look, fov].every(Number.isFinite) ||
      pos.every((value, i) => value === look[i]) || fov <= 1 || fov >= 179 || !['walk', 'orbit'].includes(mode) || extra.length) {
    throw new Error('--pose requires "x,y,z;tx,ty,tz;fov[;walk|orbit]" with distinct position and target')
  }
  return { pos, target: look, fov, mode }
}

async function savePageBuffer(page, key, file) {
  // Keep large GLBs off Playwright's JSON channel. The browser writes a local binary download.
  const [download, url] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(key => {
      const encoded = window.__cyclesPayload[key]
      const chunks = []
      const chunk = 4 * 1024 * 1024
      for (let offset = 0; offset < encoded.length; offset += chunk) {
        const part = encoded.slice(offset, offset + chunk)
        chunks.push(Uint8Array.fromBase64 ? Uint8Array.fromBase64(part) : Uint8Array.from(atob(part), c => c.charCodeAt(0)))
      }
      const handle = document.createElement('a')
      handle.href = URL.createObjectURL(new Blob(chunks, { type: 'application/octet-stream' }))
      handle.download = key
      handle.click()
      delete window.__cyclesPayload[key]
      return handle.href
    }, key),
  ])
  await download.saveAs(file)
  await page.evaluate(url => URL.revokeObjectURL(url), url)
  await download.delete()
}

async function exportScene(browser, { shot, plan, view, pose, time, finishes, quality = 'high', prefix, base: address = base() }) {
  const start = performance.now()
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shaderErrors = []
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('THREE.WebGLProgram: Shader Error')) shaderErrors.push(message.text())
  })
  page.setDefaultTimeout(timeout)
  try {
    const url = new URL(address)
    url.search = new URLSearchParams({ gallery: 'export', quality, frames: '4', sheet: 'none', ui: '0' })
    if (shot) {
      // Share codes carry the preset and finishes as well as the gallery composition.
      const parts = shot.share.split('-')
      if (time) parts[2] = String(times.indexOf(time))
      url.hash = parts.join('-')
    } else {
      url.hash = '#studio'
      url.searchParams.set('plan', plan)
      if (time) url.searchParams.set('time', time)
      if (view) url.searchParams.set('view', view)
    }
    await page.goto(url.href)
    await page.waitForFunction(() => window.__ready === true || document.querySelector('.loading-error'))
    const failure = await page.locator('.loading-error').textContent({ timeout: 150 }).catch(() => null)
    if (failure || errors.length) throw new Error(failure || errors.join(', '))

    await page.evaluate(({ pose, plan, view }) => {
      const engine = window.__engine
      if (plan && engine.plan.id !== plan) throw new Error(`Unknown plan: ${plan}`)
      if (view && !engine.plan.views.some(v => v.id === view) &&
          !window.__gallery.images.some(v => v.plan === engine.plan.id && v.id === view)) {
        throw new Error(`Unknown view for ${engine.plan.id}: ${view}`)
      }
      if (pose) window.__nav.goToPose(pose)
    }, { pose, plan, view })
    const { meta, size } = await page.evaluate(async finishes => {
      window.__cyclesPayload = await window.__beautyExport(finishes)
      const { glb, meta } = window.__cyclesPayload
      return { size: glb.length, meta }
    }, finishes)
    if (shaderErrors.length) throw new Error(shaderErrors.join('\n'))
    await mkdir(path.dirname(prefix), { recursive: true })
    await savePageBuffer(page, 'glb', prefix + '.glb')
    await savePageBuffer(page, 'sky', prefix + '.sky.f32')
    await writeFile(prefix + '.json', JSON.stringify(meta) + '\n')
    console.log(`EXPORTED ${meta.plan} / ${meta.preset} | ${(size * 0.75 / 1e6).toFixed(1)} MB GLB | ${((performance.now() - start) / 1000).toFixed(1)}s`)
  } finally {
    await page.close()
  }
}

function runBlender(prefix, output, options) {
  const args = [script, prefix, output]
  for (const name of Object.keys(renderFlags)) {
    if (options[name] !== undefined) args.push('--' + name, String(options[name]))
  }
  if (options.pano) args.push('--pano')
  const python = process.env.CYCLES_PYTHON ?? process.env.BAKE_PYTHON ?? '/root/.venvs/bake/bin/python'
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { stdio: 'inherit', env: { ...process.env, PYTHONUNBUFFERED: '1' } })
    const abort = signal => child.kill(signal)
    process.once('SIGINT', abort)
    process.once('SIGTERM', abort)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      process.off('SIGINT', abort)
      process.off('SIGTERM', abort)
      if (code === 0) resolve()
      else reject(new Error(`Blender exited with ${signal ?? code}`))
    })
  })
}

export async function renderCycles({ output, prefix: saved, from, exportOnly, ...options }) {
  if (from) return runBlender(from, output, options)
  const scratch = saved ? null : await mkdtemp(path.join(tmpdir(), 'cuby-cycles-'))
  const prefix = saved ?? path.join(scratch, 'scene')
  try {
    await withBrowser(async browser => {
      if (typeof options.shot === 'string') {
        const { images } = await readCatalog(browser, options.base)
        const shot = images.find(image => image.id === options.shot)
        if (!shot) throw new Error(`Unknown gallery shot: ${options.shot}`)
        options.shot = shot
      }
      await exportScene(browser, { ...options, prefix })
    })
    if (!exportOnly) await runBlender(prefix, output, options)
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  }
}

export function galleryCyclesArgs(args) {
  return parseArgs({ args, options: { ...renderFlags, engine: { type: 'string', default: 'webgl' } }, allowPositionals: true })
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      ...renderFlags,
      plan: { type: 'string' }, view: { type: 'string' }, pose: { type: 'string' },
      time: { type: 'string' }, finish: { type: 'string', multiple: true }, quality: { type: 'string' },
      out: { type: 'string' }, pano: { type: 'boolean' }, 'save-export': { type: 'string' },
      'export-only': { type: 'string' }, from: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log('Usage: node tools/cycles/render.mjs SHOT | --plan ID [--view ID | --pose "x,y,z;tx,ty,tz;fov"] | --from PREFIX')
    console.log('Options: --out FILE --size WxH --samples N --pano --time PRESET --finish ZONE=OPTION (repeatable)')
    console.log('         --focus METRES --f-stop N --ev STOPS --white-balance K --threads N --bevel-scale N --haze N')
    console.log('         --export-only PREFIX --save-export PREFIX --quality medium|high')
    return
  }
  const [shot, extra] = positionals
  const { plan, view, time, quality, from } = values
  if (extra || [shot, plan, from].filter(Boolean).length !== 1 || (view && (!plan || values.pose))) {
    throw new Error('Choose one gallery shot, --plan ID or --from PREFIX. --view applies to --plan and is mutually exclusive with --pose.')
  }
  if (time && !times.includes(time)) throw new Error(`Unknown time: ${time}`)
  if (quality && !['medium', 'high'].includes(quality)) throw new Error('Use --quality medium or high')
  if (from && ['time', 'view', 'pose', 'finish', 'quality', 'save-export', 'export-only'].some(key => values[key])) {
    throw new Error('--from uses the camera, lighting and finishes in the saved export')
  }
  if (values['export-only'] && values['save-export']) throw new Error('Choose either --export-only or --save-export')
  const pose = values.pose && parsePose(values.pose)
  const finishes = Object.fromEntries((values.finish ?? []).map(value => {
    const match = /^([\w-]+)=([\w-]+)$/.exec(value)
    if (!match) throw new Error(`Expected --finish ZONE=OPTION, got ${value}`)
    return [match[1], match[2]]
  }))
  const stem = shot ?? plan ?? path.basename(from)
  await renderCycles({
    ...values, shot, pose, finishes,
    prefix: values['export-only'] ?? values['save-export'],
    exportOnly: Boolean(values['export-only']),
    output: values.out ?? path.join('shots', 'cycles', stem + (values.pano ? '-pano.webp' : '.webp')),
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
