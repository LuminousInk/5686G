import { describe, expect, it } from 'vitest'
import { cedarRidge } from '../../plans/cedarRidge'
import { coastalModern } from '../../plans/coastalModern'
import { selectProbeRooms } from './roomProbes'

describe('room probe budget', () => {
  it('prioritises living, kitchen, primary and primary bath on phones', () => {
    expect(selectProbeRooms(cedarRidge, 4).map(v => v.room.id)).toEqual(['great', 'kitchen', 'primary', 'pbath'])
    expect(selectProbeRooms(coastalModern, 4).map(v => v.room.id)).toEqual(['living', 'kitchen', 'primary', 'pbath'])
  })
})
