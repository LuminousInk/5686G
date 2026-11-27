import { describe, expect, it } from 'vitest'
import { ZONES } from './catalog'
import { PLANS } from '../../plans'

const HEX = /^#[0-9A-Fa-f]{6}$/

describe('interior walls finish zone', () => {
  it('is listed last by every plan, with a valid default finish', () => {
    // share codes encode zones by position, so 'walls' must stay appended at the end
    const ids = ZONES.walls.options.map(o => o.id)
    for (const plan of PLANS) {
      expect(plan.zones[plan.zones.length - 1]).toBe('walls')
      expect(ids).toContain(plan.finishes.walls)
    }
  })

  it('has unique option ids and valid colours', () => {
    const zone = ZONES.walls
    expect(zone.label).toBe('Interior walls')
    const ids = zone.options.map(o => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['warm-white', 'greige', 'sage', 'clay', 'fog', 'charcoal', 'limewash'])
    for (const plan of PLANS) {
      const finish = zone.options.find(o => o.id === plan.finishes.walls)
      expect(finish?.params.tex, plan.id).toBe('ambientcg_plaster001')
      expect(finish?.params.roughness, plan.id).toBeGreaterThanOrEqual(0.9)
    }
    for (const o of zone.options) {
      expect(o.swatch).toMatch(HEX)
      expect(o.params.color).toMatch(HEX)
    }
  })
})
