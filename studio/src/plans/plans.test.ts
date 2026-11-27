import { describe, expect, it } from 'vitest'
import { PLANS } from './index'
import { aspenCustom } from './aspenCustom'
import { planProblems } from './validate'

describe('home plans', () => {
  it('have unique ids', () => {
    expect(new Set(PLANS.map(p => p.id)).size).toBe(PLANS.length)
  })

  for (const plan of PLANS) {
    it(`${plan.name}: every opening is built, volumes do not overlap, rooms sit inside`, () => {
      expect(planProblems(plan)).toEqual([])
    })
  }

  it('rejects overlapping blocks on the same level, incorrect room levels and stair rises', () => {
    const plan = structuredClone(aspenCustom)
    plan.blocks.find(b => b.id === 'walkout-1')!.level = 'main'
    plan.rooms.find(r => r.id === 'bed5')!.level = 'unknown'
    plan.stairs[0].rise -= 0.2
    expect(planProblems(plan)).toEqual(expect.arrayContaining([
      expect.stringContaining('overlap'),
      '"bed5" has an unknown level',
      'stair "walkout-1" rise does not match its levels',
    ]))
  })

  it('reports overlapping façade openings before they can close a glazed passage', () => {
    const plan = structuredClone(aspenCustom)
    const slider = plan.openings.find(o => o.id === 'great-slider-open')!
    const window = plan.openings.find(o => o.block === slider.block && o.side === slider.side && o.kind === 'fixed')!
    slider.at = window.at
    expect(planProblems(plan)).toContainEqual(expect.stringContaining('overlaps great-slider-open'))
  })
})
