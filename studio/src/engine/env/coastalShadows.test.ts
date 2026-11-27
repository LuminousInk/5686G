import { Box3, Matrix4, Vector2, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { coastalShadowRegion, motionShadowBounds } from './environment'

it('includes more of the yard on desktop in a single fitted shadow map', () => {
  const house = new Box3(new Vector3(-23, -4, -20), new Vector3(23, 9, 20))
  expect(coastalShadowRegion(house, 'low')).toEqual(house)
  const medium = coastalShadowRegion(house, 'medium')
  const high = coastalShadowRegion(house, 'high')
  expect(high.containsBox(medium)).toBe(true)
  expect(high.min.y).toBe(house.min.y)
  expect(high.max.y).toBe(house.max.y)

  const eye = new Vector3(50, 40, 100)
  const view = new Matrix4().lookAt(eye, high.getCenter(new Vector3()), new Vector3(0, 1, 0))
    .setPosition(eye).invert()
  const bounds = motionShadowBounds(high, view, new Vector2(4096, 4096))
  const receivers = high.clone().applyMatrix4(view)
  expect(bounds.x).toBeLessThan(receivers.min.x)
  expect(bounds.y).toBeGreaterThan(receivers.max.x)
  expect(bounds.z).toBeLessThan(receivers.min.y)
  expect(bounds.w).toBeGreaterThan(receivers.max.y)
  expect(bounds.w - bounds.z).toBeLessThan(house.getSize(new Vector3()).length())
})
