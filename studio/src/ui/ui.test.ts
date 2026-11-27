import { describe, expect, it, vi } from 'vitest'
import type { WebGLRenderer } from 'three'
import { TIME_PRESETS } from '../engine/env/environment'
import { neighbours } from '../engine/house/massing'
import { ZONES } from '../engine/materials/catalog'
import { AssetPriority, AssetQueue, TextureBank } from '../engine/materials/textures'
import { modelsForEntry } from '../engine/models'
import { PLANS, planById } from '../plans'
import catalog from '../../public/gallery/gallery.json'
import { availableComparisons, GALLERY_SHOTS, galleryView, type GalleryImage } from './galleryShots'
import { homeFromRoute, homeRoute, isStudioRoute, tourFromRoute, tourRoute } from './routes'
import { aspenCustom } from '../plans/aspenCustom'
import { planProblems } from '../plans/validate'
import { feetInches, planGeometry } from './FloorPlan'
import { MIN_BLOCK, moveBlockEdge } from './planEdits'
import { decodeDesign, encodeDesign, getState, type AppState } from './store'
import { decodePose, encodePose } from './sharePose'
import type { CameraPose } from '../engine/nav/pose'

describe('share codes', () => {
  it('round-trip the plan, the light and every finish option', () => {
    for (const plan of PLANS)
      for (const t of TIME_PRESETS)
        for (const z of plan.zones)
          for (const o of ZONES[z].options) {
            const s: AppState = {
              ...getState(),
              planId: plan.id,
              time: t.id,
              finishes: { ...getState().finishes, [plan.id]: { ...plan.finishes, [z]: o.id } },
            }
            const code = encodeDesign(s)
            // artifact hosts only pass a plain #name hash
            expect(code).toMatch(/^[a-z0-9-]+$/)
            const back = decodeDesign(`#${code}`)!
            expect(back.planId).toBe(plan.id)
            expect(back.time).toBe(t.id)
            expect(back.finishes![plan.id][z]).toBe(o.id)
          }
  })

  it('keeps legacy codes valid and rejects a view from another home', () => {
    const code = encodeDesign({ ...getState(), viewId: null })
    expect(decodeDesign(`#${code}`)).toMatchObject({ planId: 'cedar-ridge', viewId: null })
    expect(decodeDesign(`#${code}-v-living`)).toMatchObject({ viewId: 'living' })
    expect(decodeDesign(`#${code}-v-aspen-lower-suite`)).toMatchObject({ viewId: null })
  })

  it('ignores hashes that are not share codes', () => {
    for (const h of ['', '#', '#hero', '#c-', '#c-99-0', '#c-0-x']) expect(decodeDesign(h)).toBeNull()
  })

  it.each(['walk', 'orbit', 'dollhouse'] as const)('keeps the exact spot in a plain hash for %s mode', mode => {
    const pose: CameraPose = { mode, pos: [-9.3102, -1.231, 0.0009], target: [5.6121, 2.1, -43.232], fov: 62.153 }
    const code = encodeDesign({ ...getState(), planId: 'aspen-custom', time: 'dusk', viewId: null, pose })
    expect(code).toMatch(/^[a-z0-9-]+$/)
    expect(isStudioRoute('#' + code, '')).toBe(true)
    expect(decodeDesign('#' + code)).toMatchObject({
      planId: 'aspen-custom', time: 'dusk', viewId: null,
      pose: { mode, pos: [-9.31, -1.231, 0.001], target: [5.612, 2.1, -43.232], fov: 62.15 },
    })
  })

  it('drops unusable poses and keeps the rest of a legacy design', () => {
    const pose: CameraPose = { mode: 'walk', pos: [1, 2, 3], target: [1, 2, 3], fov: 60 }
    expect(encodePose(pose)).toBeUndefined()
    expect(encodePose({ ...pose, pos: [0, 0, 0], fov: Infinity })).toBeUndefined()
    for (const bad of ['a-0-0-0-1-2-3-700', 'w-0-0-0-1-2-3', 'w-0-0-0-0-0-0-700', 'o-zzzzz-0-0-1-2-3-700']) {
      expect(decodePose(bad)).toBeUndefined()
      expect(decodeDesign(`#c-0-0-p-${bad}`)).toMatchObject({ planId: 'cedar-ridge', pose: undefined })
    }
  })
})

describe('website entry points', () => {
  it('resolves each tour from a plain plan hash and includes all the planned spaces', () => {
    for (const plan of PLANS) {
      const hash = tourRoute(plan.id)
      expect(isStudioRoute(hash, '')).toBe(true)
      expect(tourFromRoute(hash)).toBe(plan)
      const stops = plan.tour!
      const views = stops.map(stop => plan.views.find(view => view.id === stop.view)!)
      expect(views.every(Boolean)).toBe(true)
      expect(views[0].kind).toBe('orbit')
      expect(views.at(-1)?.id).toBe('ocean')
      expect(views.some(view => plan.rooms.some(room => room.id === view.room && room.type === 'kitchen'))).toBe(true)
      expect(views.some(view => plan.rooms.some(room => room.id === view.room && room.type === 'primary'))).toBe(true)
      if (plan.id === 'aspen-custom') expect(views.some(view => plan.rooms.some(room => room.id === view.room && room.level === 'lower'))).toBe(true)
    }
    expect(isStudioRoute('#tour-unknown', '')).toBe(false)
    expect(isStudioRoute('#tour-cedar-ridge?time=day', '')).toBe(false)
  })
  it('opens the landing without a hash and uses only plain studio hashes', () => {
    for (const hash of ['', '#home', '#gallery', '#/studio', '#studio?view=great']) {
      expect(isStudioRoute(hash, '')).toBe(false)
    }
    for (const hash of ['#studio', '#c-0-1', '#c-0-0-1-v-cedar-great-room']) {
      expect(isStudioRoute(hash, '')).toBe(true)
    }
    expect(isStudioRoute('', '?plan=cedar-ridge&ui=0')).toBe(true)
    expect(isStudioRoute('#home', '?plan=cedar-ridge')).toBe(false)
  })

  it('resolves a plain hash for every home with a walkthrough from its gallery', () => {
    for (const plan of PLANS) {
      const hash = homeRoute(plan.id)
      expect(hash).toMatch(/^#home-[a-z-]+$/)
      expect(homeFromRoute(hash)).toBe(plan)
      expect(isStudioRoute(hash, '?plan=cedar-ridge')).toBe(false)
      const walk = catalog.images.find(image => image.plan === plan.id && image.kind === 'interior')
      expect(decodeDesign(walk!.share)?.planId).toBe(plan.id)
      expect(galleryView(plan, decodeDesign(walk!.share)!.viewId!)?.kind).toBe('walk')
    }
    for (const hash of ['#home', '#home-unknown', '#/home-cedar-ridge', '#home-cedar-ridge?view=great']) {
      expect(homeFromRoute(hash)).toBeUndefined()
    }
  })

  it('matches each published caption and share code to its camera and design', () => {
    expect(catalog.homes).toEqual(PLANS.map(({ id, name, style, facts: { area, beds, baths } }) => ({
      id, name, style, area, beds, baths,
    })))
    const shotIds = GALLERY_SHOTS.map(shot => shot.id)
    expect(catalog.images.filter(image => shotIds.includes(image.id)).map(image => image.id)).toEqual(shotIds)
    for (const image of catalog.images) {
      const plan = planById(image.plan)!
      const decoded = decodeDesign(image.share)!
      const view = galleryView(plan, decoded.viewId!)!
      const shot = GALLERY_SHOTS.find(shot => shot.id === image.id)
      expect(isStudioRoute(image.share, '')).toBe(true)
      expect(decoded.planId).toBe(plan.id)
      if (shot) {
        expect(decoded).toMatchObject({ viewId: shot.id, time: shot.time ?? 'golden' })
        expect(decoded.finishes![plan.id]).toEqual({ ...plan.finishes, ...shot.finishes })
      } else {
        expect(catalog.comparisons.some(pair => pair.after === image.id && pair.before === view.id)).toBe(true)
      }
      expect(view.pos[1]).toEqual(view.target[1])
      expect(image.kind).toBe(view.kind === 'walk' ? 'interior' : 'exterior')
    }
  })

  it('shows ready comparisons and skips pairs with a missing image', () => {
    const published = catalog.images.filter((image): image is GalleryImage => image.kind === 'exterior' || image.kind === 'interior')
    const pairs = availableComparisons(catalog.comparisons, published, new Set())
    expect(pairs.length).toBeGreaterThanOrEqual(3)
    expect(pairs.map(({ after }) => after.id)).toEqual(
      catalog.comparisons.filter(pair => published.some(image => image.id === pair.after)).map(pair => pair.after),
    )
    const [first, ...rest] = pairs
    expect(availableComparisons(catalog.comparisons, published, new Set([first.after.id]))).toEqual(rest)
    expect(availableComparisons(catalog.comparisons, [], new Set())).toEqual([])
    for (const { before, after } of pairs) {
      const plan = planById(before.plan)!
      const firstDesign = decodeDesign(before.share)!
      const secondDesign = decodeDesign(after.share)!
      const { pos, target, fov } = galleryView(plan, firstDesign.viewId!)!
      expect(galleryView(plan, secondDesign.viewId!)).toMatchObject({ pos, target, fov })
      expect([firstDesign.time, firstDesign.finishes]).not.toEqual([secondDesign.time, secondDesign.finishes])
    }
  })
})

describe('studio preload', () => {
  it('bounds concurrency, gives shell and entry assets precedence, and keeps going after a failure', async () => {
    const queue = new AssetQueue(2)
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = queue.run(AssetPriority.rest, () => {
      started.push('first')
      return gate
    })
    const second = queue.run(AssetPriority.rest, () => {
      started.push('second')
      return gate
    })
    const enqueue = (id: string, priority: number) => queue.run(priority, async () => {
      started.push(id)
      if (id === 'view') throw new Error(id)
    })
    const rest = enqueue('rest', AssetPriority.rest)
    const view = expect(enqueue('view', AssetPriority.view)).rejects.toThrow('view')
    const shell = enqueue('shell', AssetPriority.shell)
    await Promise.resolve()
    expect(started).toEqual(['first', 'second'])
    release()
    await Promise.all([first, second, shell, view, rest])
    expect(started).toEqual(['first', 'second', 'shell', 'view', 'rest'])
  })

  it('favors furnishings for the opening room or shared rooms behind exterior glazing', () => {
    const plan = planById('cedar-ridge')!
    const entry = modelsForEntry(plan, plan.views[0])
    const suite = modelsForEntry(plan, plan.views.find(view => view.id === 'primary'))
    expect(entry.has('sofa_beige')).toBe(true)
    expect(entry.has('bed_dark_headboard')).toBe(false)
    expect(suite.has('bed_dark_headboard')).toBe(true)
    expect(suite.has('fridge_steel')).toBe(false)
  })

  it('shares a decoded image between scaled materials and skips unused linen albedo', async () => {
    const request = vi.fn(async () => new Response(new Blob()))
    const bitmap = { width: 32, height: 32 }
    const decode = vi.fn(async () => bitmap)
    vi.stubGlobal('fetch', request)
    vi.stubGlobal('createImageBitmap', decode)
    try {
      const renderer = { capabilities: { getMaxAnisotropy: () => 4 } } as WebGLRenderer
      const bank = new TextureBank(renderer, '512')
      const first = bank.scaled('rough_linen')
      const second = bank.scaled('rough_linen', 2)
      await bank.ready()
      expect(first.map).toBeNull()
      expect(first.normalMap.source).toBe(second.normalMap.source)
      expect(second.normalMap.image).toBe(bitmap)
      expect(second.normalMap.repeat.x).toBe(first.normalMap.repeat.x / 2)
      expect(request).toHaveBeenCalledTimes(2)
      expect(decode).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ imageOrientation: 'flipY' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('floor plan', () => {
  it('writes metres as feet and inches', () => {
    expect(feetInches(3.048)).toBe("10'")
    expect(feetInches(1)).toBe(`3'3"`)
    expect(feetInches(3.81)).toBe(`12'6"`)
  })

  it('draws walls, windows and doors for every plan', () => {
    for (const plan of PLANS) {
      const g = planGeometry(plan)
      expect(g.bounds.every(Number.isFinite)).toBe(true)
      expect(g.exterior.length).toBeGreaterThan(3)
      expect(g.windows.length).toBeGreaterThan(0)
      expect(g.doors.length).toBeGreaterThan(0)
    }
  })

  it('draws the angled ADU on the main plan and the two separate suites below', () => {
    const main = planGeometry(aspenCustom, 'main')
    const lower = planGeometry(aspenCustom, 'lower')
    expect(main.exterior.some(([x, z, a, b]) => Math.abs(x - a) > 0.1 && Math.abs(z - b) > 0.1)).toBe(true)
    expect(lower.exterior).toHaveLength(8)
    expect(lower.doors).toHaveLength(4)
    expect(lower.bounds[3]).toBeLessThan(main.bounds[3])
  })
})

describe('editor: moving a volume edge', () => {
  const plan = PLANS[0]
  // two volumes joined along an east/west line
  const pair = plan.blocks
    .map(b => ({ b, n: neighbours(b, 'e', plan.blocks)[0]?.block }))
    .find(p => p.n && Math.abs(p.n.rect[0] - p.b.rect[2]) < 1e-3)!

  it('finds joined volumes in the hero plan', () => {
    expect(pair).toBeTruthy()
  })

  it('carries the joined volume, rooms and wall ends along', () => {
    const line = pair.b.rect[2]
    const moved = moveBlockEdge(plan, pair.b.id, 'e', line - 0.5)
    expect(moved.blocks.find(x => x.id === pair.b.id)!.rect[2]).toBeCloseTo(line - 0.5)
    expect(moved.blocks.find(x => x.id === pair.n!.id)!.rect[0]).toBeCloseTo(line - 0.5)
    for (const r of moved.rooms) for (const k of [0, 2]) expect(Math.abs(r.rect[k] - line)).toBeGreaterThan(0.02)
    for (const w of moved.walls) for (const p of [w.a, w.b]) expect(Math.abs(p[0] - line)).toBeGreaterThan(0.02)
  })

  it('keeps windows where they were on the volume that grows', () => {
    const line = pair.b.rect[2]
    const moved = moveBlockEdge(plan, pair.b.id, 'e', line - 0.5)
    const before = plan.openings.filter(o => o.block === pair.n!.id && (o.side === 'n' || o.side === 's'))
    const after = moved.openings.filter(o => o.block === pair.n!.id && (o.side === 'n' || o.side === 's'))
    expect(after.length).toBe(before.length)
    const nAfter = moved.blocks.find(x => x.id === pair.n!.id)!
    after.forEach((o, i) => expect(nAfter.rect[0] + o.at).toBeCloseTo(pair.n!.rect[0] + before[i].at))
  })

  it('leaves a plan that still builds every opening', () => {
    expect(planProblems(moveBlockEdge(plan, pair.b.id, 'e', pair.b.rect[2] - 0.5))).toEqual([])
  })

  it(`never makes a volume thinner than ${MIN_BLOCK} m`, () => {
    const moved = moveBlockEdge(plan, pair.b.id, 'e', pair.b.rect[0] + 0.3)
    const b = moved.blocks.find(x => x.id === pair.b.id)!
    expect(b.rect[2] - b.rect[0]).toBeCloseTo(MIN_BLOCK)
  })

  it('does not touch the original plan, and returns it when nothing moves', () => {
    const snapshot = JSON.stringify(plan)
    moveBlockEdge(plan, pair.b.id, 'e', pair.b.rect[2] + 1)
    expect(JSON.stringify(plan)).toBe(snapshot)
    expect(moveBlockEdge(plan, pair.b.id, 'e', pair.b.rect[2])).toBe(plan)
  })
})
