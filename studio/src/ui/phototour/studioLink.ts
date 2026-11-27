import type { HomePlan } from '../../engine/house/types'
import { encodeDesign, getState } from '../store'
import type { PhotoStop } from './manifest'

export function photoStudioLink(plan: HomePlan, stop: Pick<PhotoStop, 'position' | 'heading' | 'fov' | 'time'>) {
  const [x, y, z] = stop.position
  return '#' + encodeDesign({
    ...getState(),
    planId: plan.id,
    time: stop.time,
    finishes: { [plan.id]: plan.finishes },
    viewId: null,
    pose: {
      mode: 'walk',
      pos: [x, y, z],
      target: [x + Math.sin(stop.heading), y, z + Math.cos(stop.heading)],
      fov: stop.fov,
    },
  })
}
