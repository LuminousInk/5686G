import { describe, expect, it } from 'vitest'
import { TIME_PRESETS } from '../engine/env/environment'
import { neighbours } from '../engine/house/massing'
import { ZONES } from '../engine/materials/catalog'
import { PLANS, planById } from '../plans'
import catalog from '../../public/gallery/gallery.json'
import { GALLERY_SHOTS, galleryView } from './galleryShots'
import { isStudioRoute } from './routes'
import { aspenCustom } from '../plans/aspenCustom'
import { planProblems } from '../plans/validate'
import { feetInches, planGeometry } from './FloorPlan'
import { MIN_BLOCK, moveBlockEdge } from './planEdits'
import { decodeDesign, encodeDesign, getState, type AppState } from './store'

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
})

describe('website entry points', () => {
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

  it('matches each published caption and share code to its camera and design', () => {
    expect(catalog.homes.map(home => home.id)).toEqual(PLANS.map(plan => plan.id))
    expect(catalog.images.map(image => image.id)).toEqual(GALLERY_SHOTS.map(shot => shot.id))
    for (const [i, image] of catalog.images.entries()) {
      const plan = planById(image.plan)!
      const shot = GALLERY_SHOTS[i]
      const view = galleryView(plan, image.id)!
      const decoded = decodeDesign(image.share)!
      expect(isStudioRoute(image.share, '')).toBe(true)
      expect(decoded).toMatchObject({ planId: plan.id, viewId: view.id, time: shot.time ?? 'golden' })
      expect(decoded.finishes![plan.id]).toEqual({ ...plan.finishes, ...shot.finishes })
      expect(view.pos[1]).toEqual(view.target[1])
      expect(image.kind).toBe(view.kind === 'walk' ? 'interior' : 'exterior')
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
