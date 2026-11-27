import { readdirSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { makeTour } from '../../../tools/cycles/panos.mjs'
import { levelFloor } from '../../engine/house/levels'
import { PLANS } from '../../plans'
import { isStudioRoute, photoFromRoute, photoRoute } from '../routes'
import { decodeDesign } from '../store'
import { photoHome, photoHomes, photoSrc, renderedStops, type PhotoHome, type PhotoStop } from './manifest'
import { photoStudioLink } from './studioLink'

describe('photo tour routes', () => {
  it('resolves plain photo hashes for all five plans, including coming-soon homes', () => {
    for (const plan of PLANS) {
      const hash = photoRoute(plan.id)
      expect(photoFromRoute(hash)).toBe(plan)
      expect(isStudioRoute(hash, '?plan=cedar-ridge')).toBe(false)
    }
    expect(photoFromRoute('#photo-other')).toBeUndefined()
    expect(photoFromRoute('#tour-cedar-ridge')).toBeUndefined()
  })
})

describe('Cycles tour manifest', () => {
  it('has three connected stops per plan with current plan captions and eye-height poses', () => {
    expect(photoHomes.map(home => home.id)).toEqual(PLANS.map(plan => plan.id))
    for (const plan of PLANS) {
      const home = photoHome(plan.id)!
      const generated: Omit<PhotoHome, 'stops'> & { stops: Omit<PhotoStop, 'rendered'>[] } = makeTour(plan, photoStudioLink)
      expect(home.stops).toHaveLength(3)
      expect(home).toEqual({
        ...generated,
        stops: generated.stops.map((stop, i) => ({ ...stop, rendered: home.stops[i].rendered })),
      })
      const seen = new Set<string>()
      const queue = [home.stops[0].id]
      while (queue.length) {
        const id = queue.shift()!
        if (seen.has(id)) continue
        seen.add(id)
        const stop = home.stops.find(candidate => candidate.id === id)!
        queue.push(...stop.links.map(link => link.to))
      }
      expect(seen.size).toBe(3)
      for (const stop of home.stops) {
        const room = plan.rooms.find(candidate => candidate.id === stop.room)
        const deck = plan.decks.find(candidate => candidate.id === stop.deck)
        expect(stop.position[1]).toBeCloseTo((deck?.height ?? levelFloor(plan, room?.level)) + 1.55, 5)
        expect(plan.tour?.some(step => step.title === stop.name && step.caption === stop.caption)).toBe(true)
        for (const link of stop.links) {
          expect(home.stops.find(candidate => candidate.id === link.to)?.links.some(reverse => reverse.to === stop.id)).toBe(true)
          const [x, , z] = stop.position
          const [dx, dz] = [link.via[0] - x, link.via[1] - z]
          const heading = stop.heading - link.yaw
          expect(Math.sin(heading)).toBeCloseTo(dx / Math.hypot(dx, dz), 5)
          expect(Math.cos(heading)).toBeCloseTo(dz / Math.hypot(dx, dz), 5)
        }
      }
    }
  })

  it('advertises only rendered 2560 × 1280 WebPs and respects the file budget', async () => {
    const imageDir = new URL('../../../public/pano/', import.meta.url)
    const files = readdirSync(imageDir).filter(file => file.endsWith('.webp'))
    const expected = photoHomes.flatMap(home => home.stops.map(stop => stop.image))
    expect(expected).toHaveLength(15)
    expect(new Set(expected).size).toBe(15)
    const rendered = photoHomes.flatMap(home => renderedStops(home))
    expect(rendered.map(stop => stop.image).sort()).toEqual(files.sort())
    await Promise.all(rendered.map(async stop => {
      expect(photoSrc(stop)).toMatch(/^\.\/pano\/[a-z0-9-]+\.webp$/)
      const image = await sharp(new URL(stop.image, imageDir).pathname).metadata()
      expect([image.format, image.width, image.height]).toEqual(['webp', 2560, 1280])
    }))
  })

  it('removes links to missing images without dropping independently rendered stops', () => {
    const home = photoHome('cedar-ridge')!
    const rendered = renderedStops({
      ...home,
      stops: home.stops.map(stop => ({ ...stop, rendered: stop.id !== 'great-room' })),
    })
    expect(rendered.map(stop => stop.id)).toEqual(['kitchen', 'primary-suite'])
    expect(rendered.every(stop => stop.links.length === 0)).toBe(true)
  })

  it('hands each camera position and preset to the existing 3D share route', () => {
    for (const plan of PLANS) for (const stop of photoHome(plan.id)!.stops) {
      const hash = stop.studio
      expect(isStudioRoute(hash, '')).toBe(true)
      const design = decodeDesign(hash)!
      expect(design.planId).toBe(plan.id)
      expect(design.time).toBe(stop.time)
      expect(design.viewId).toBe(null)
      expect(design.finishes?.[plan.id]).toEqual(plan.finishes)
      expect(design.pose?.mode).toBe('walk')
      expect(design.pose?.pos).toEqual(stop.position.map(value => Math.round(value * 1000) / 1000))
      expect(design.pose?.fov).toBe(stop.fov)
    }
  })
})
