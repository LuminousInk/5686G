// Build the tour manifest from the plans and the rendered files on disk.
// node tools/cycles/panos.mjs [plan-id ...] --render
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { createServer } from 'vite'

const directory = fileURLToPath(new URL('../../public/pano/', import.meta.url))
const renderScratch = fileURLToPath(new URL('../../shots/', import.meta.url))
const eyeHeight = 1.55
const size = '2560x1280'

// X/Z positions in clear circulation space, with a subject to face. The two
// existing samples keep the camera and filenames used in the Cycles README.
const compositions = {
  'cedar-ridge': [
    { id: 'great-room', room: 'great', view: 'tour-living', at: [-1.4, -5.35], look: [1.95, -0.5], image: 'cedar-great-room.webp' },
    { id: 'kitchen', room: 'kitchen', view: 'kitchen', at: [-3.75, -5.65], look: [-6.25, -8.5] },
    { id: 'primary-suite', room: 'primary', view: 'primary', at: [10.5, -3.35], look: [13.1, -4.7] },
  ],
  'coastal-modern': [
    { id: 'kitchen', room: 'kitchen', view: 'kitchen', at: [1.55, -6.85], look: [-0.3, -9.45], image: 'coastal-kitchen.webp', time: 'day' },
    { id: 'great-room', room: 'living', view: 'living', at: [-1.92, -3.05], look: [0.65, 0.6], time: 'day' },
    { id: 'primary-suite', room: 'primary', view: 'primary', at: [-6.35, -6.63], look: [-8.5, -8.7], time: 'day' },
  ],
  'woodland-modern': [
    { id: 'great-room', room: 'great', view: 'great', at: [2.59, 0.65], look: [-1.8, -7.15] },
    { id: 'kitchen', room: 'kitchen', view: 'kitchen', at: [2.55, -4.95], look: [-0.65, -9.1] },
    { id: 'primary-suite', room: 'primary', view: 'primary', at: [-11.82, -0.78], look: [-9.3, -3.42] },
  ],
  'aspen-custom': [
    { id: 'great-room', room: 'great', view: 'great' },
    { id: 'rear-deck', deck: 'rear-deck', view: 'deckwalk', look: [0.75, -16] },
    { id: 'lower-suite', room: 'bed5', view: 'lower-west', look: [10.5, -6.25] },
  ],
  'modern-farmhouse': [
    { id: 'great-room', room: 'great', view: 'great', at: [2.15, -0.55], look: [-0.75, -5.6] },
    { id: 'kitchen', room: 'kitchen', view: 'kitchen', at: [3.95, -4.7], look: [5.25, -8.8] },
    { id: 'primary-suite', room: 'primary', view: 'primary', at: [-8.04, -6.45], look: [-9.1, -9.2] },
  ],
}

// Ordered paths through the plan. Use the nearest end of each path for the
// arrow in that direction. Interior door references use the wall and opening.
const routes = {
  'cedar-ridge': [
    ['great-room', 'kitchen', [[-3, -5.1]]],
    ['great-room', 'primary-suite', ['w-great-east', 'w-east-wing']],
  ],
  'coastal-modern': [
    ['kitchen', 'great-room', [[1.85, -5.1], [1.83, -3.6]]],
    ['great-room', 'primary-suite', ['c-beds-great', ['c-hall-n', 2.1]]],
  ],
  'woodland-modern': [
    ['great-room', 'kitchen', [[1.45, -4.5]]],
    ['great-room', 'primary-suite', [[-3.2, -0.72], 'w-primary']],
  ],
  'aspen-custom': [
    ['great-room', 'rear-deck', ['great-slider-open']],
    // Leave through the west hall and take the stairs beside the deck to the suite slider.
    ['great-room', 'lower-suite', [[5.99, 3.9], { stair: 'walkout-1' }, 'walkout-1-slider-open']],
  ],
  'modern-farmhouse': [
    ['great-room', 'kitchen', [[2.65, -5.55], [3.4, -4.8]]],
    ['great-room', 'primary-suite', ['f-west', ['f-hall-n', 2]]],
  ],
}

const heading = ([x, z], [tx, tz]) => Math.atan2(tx - x, tz - z)
const wrap = yaw => Math.atan2(Math.sin(yaw), Math.cos(yaw))
const round = value => Math.round(value * 1e6) / 1e6

function routePoint(plan, reference) {
  if (typeof reference === 'object' && !Array.isArray(reference)) {
    const stair = plan.stairs.find(s => s.id === reference.stair && s.between)
    if (!stair) throw new Error(`Missing walkout stair ${reference.stair} in ${plan.id}`)
    return stair.from
  }
  if (Array.isArray(reference) && typeof reference[0] === 'number') return reference

  const [id, at] = Array.isArray(reference) ? reference : [reference]
  const openings = plan.openings.filter(o => ['door', 'entry', 'slider'].includes(o.kind) &&
    (o.id === id || (o.wall === id && (at === undefined || o.at === at))))
  if (openings.length !== 1) throw new Error(`Expected one doorway for ${id} in ${plan.id}`)
  const opening = openings[0]
  if (opening.wall) {
    const { a, b } = plan.walls.find(w => w.id === opening.wall)
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const ratio = opening.at / Math.hypot(dx, dz)
    return [a[0] + dx * ratio, a[1] + dz * ratio]
  }
  const [x0, z0, x1, z1] = plan.blocks.find(b => b.id === opening.block).rect
  return {
    n: [x0 + opening.at, z0], s: [x0 + opening.at, z1],
    e: [x1, z0 + opening.at], w: [x0, z0 + opening.at],
  }[opening.side]
}

export function makeTour(plan, studioLink) {
  const stops = compositions[plan.id].map(({ id, room, deck, view, at, look, image, time = 'golden' }) => {
    const camera = plan.views.find(v => v.id === view)
    const caption = plan.tour?.find(step => step.view === view)
    const space = room ? plan.rooms.find(r => r.id === room) : plan.decks.find(d => d.id === deck)
    if (!space || !camera || !caption) throw new Error(`Missing space, view or caption for ${plan.id}/${id}`)
    const [x, z] = at ?? [camera.pos[0], camera.pos[2]]
    const [x0, z0, x1, z1] = space.rect
    if (x <= x0 || x >= x1 || z <= z0 || z >= z1) throw new Error(`Camera outside ${plan.id}/${id}`)
    const floor = deck ? space.height : plan.floorY + (plan.levels?.find(level => level.id === space.level)?.offset ?? 0)
    const stop = {
      id, room, deck, name: caption.title, caption: caption.caption,
      position: [x, floor + eyeHeight, z].map(round),
      heading: round(heading([x, z], look ?? [camera.target[0], camera.target[2]])),
      fov: camera.fov ?? 63, time, image: image ?? `${plan.id}-${id}.webp`, links: [],
    }
    return { ...stop, studio: studioLink(plan, stop) }
  })
  for (const [a, b, path] of routes[plan.id]) {
    const waypoints = path.map(reference => routePoint(plan, reference))
    for (const [from, to, point] of [[a, b, waypoints[0]], [b, a, waypoints.at(-1)]]) {
      const stop = stops.find(s => s.id === from)
      const [x, , z] = stop.position
      const distance = Math.hypot(point[0] - x, point[1] - z)
      stop.links.push({
        to, via: point.map(round),
        yaw: round(wrap(stop.heading - heading([x, z], point))),
        pitch: round(Math.atan2(-0.45, distance)),
      })
    }
  }
  return { id: plan.id, name: plan.name, stops }
}

async function loadTours() {
  const vite = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, ws: false },
  })
  try {
    const { PLANS } = await vite.ssrLoadModule('/src/plans/index.ts')
    const { photoStudioLink } = await vite.ssrLoadModule('/src/ui/phototour/studioLink.ts')
    return PLANS.map(plan => makeTour(plan, photoStudioLink))
  } finally {
    await vite.close()
  }
}

async function writeManifest(tours) {
  const files = new Set(await readdir(directory))
  for (const tour of tours) for (const stop of tour.stops) {
    stop.rendered = false
    if (!files.has(stop.image)) continue
    const { width, height, format } = await sharp(join(directory, stop.image)).metadata()
    if (format !== 'webp' || `${width}x${height}` !== size) {
      throw new Error(`${stop.image} must be a ${size} WebP`)
    }
    stop.rendered = true
  }
  const temporary = join(directory, `.manifest-${process.pid}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify({ homes: tours }, null, 2) + '\n')
    await rename(temporary, join(directory, 'manifest.json'))
  } finally {
    await rm(temporary, { force: true })
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      render: { type: 'boolean' }, force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      stop: { type: 'string', multiple: true }, samples: { type: 'string' }, threads: { type: 'string' },
    },
  })
  if (values.help) {
    console.log('Usage: node tools/cycles/panos.mjs [plan-id ...] [--render [--stop STOP-ID] [--samples N] [--threads N] [--force]]')
    console.log('Writes the manifest for all homes. With --render, renders missing images for the selected plans and stops.')
    console.log('Preview defaults to http://localhost:4206/. Set BASE to use another preview.')
    return
  }
  if (!values.render && (values.force || values.stop || values.samples || values.threads)) {
    throw new Error('--force, --stop, --samples and --threads require --render')
  }
  for (const flag of ['samples', 'threads']) {
    if (values[flag] !== undefined && !/^[1-9]\d*$/.test(values[flag])) throw new Error(`--${flag} must be a positive integer`)
  }
  const tours = await loadTours()
  for (const id of positionals) if (!tours.some(tour => tour.id === id)) throw new Error(`Unknown plan: ${id}`)
  const selected = tours.filter(tour => !positionals.length || positionals.includes(tour.id))
  const jobs = selected.flatMap(tour => tour.stops.map(stop => ({ plan: tour.id, stop })))
  for (const id of values.stop ?? []) if (!jobs.some(job => job.stop.id === id)) throw new Error(`Unknown stop in selected plans: ${id}`)
  await mkdir(directory, { recursive: true })
  const existing = (await readdir(directory)).filter(file => file.endsWith('.webp'))
  const expected = tours.flatMap(tour => tour.stops.map(stop => stop.image))
  if (new Set([...existing, ...expected]).size > 15) throw new Error('The photo tour has a 15-panorama budget')

  await writeManifest(tours)
  if (!values.render) return
  const { renderCycles } = await import('./render.mjs')
  const base = new URL(process.env.BASE ?? 'http://localhost:4206/')
  for (const { plan, stop } of jobs) {
    if ((values.stop && !values.stop.includes(stop.id)) || (stop.rendered && !values.force)) continue
    const [x, y, z] = stop.position
    const target = [x + Math.sin(stop.heading), y, z + Math.cos(stop.heading)]
    await mkdir(renderScratch, { recursive: true })
    const scratch = await mkdtemp(join(renderScratch, 'cycles-pano-'))
    const output = join(scratch, stop.image)
    console.log(`Rendering ${plan}/${stop.id}`)
    try {
      await renderCycles({
        base, plan, output, pano: true, size, time: stop.time, samples: values.samples, threads: values.threads,
        pose: { mode: 'walk', pos: stop.position, target, fov: stop.fov },
      })
      await rename(output, join(directory, stop.image))
      await writeManifest(tours)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
