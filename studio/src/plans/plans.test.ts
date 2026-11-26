import { describe, expect, it } from 'vitest'
import { PLANS } from './index'
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
})
