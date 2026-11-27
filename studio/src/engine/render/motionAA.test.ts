import { Box3, Matrix4, PerspectiveCamera, Vector2, Vector3, Vector4 } from 'three'
import { expect, it } from 'vitest'
import { motionShadowBounds } from '../env/environment'
import { MotionHistory } from './motionAA'

it('reprojects jittered samples into the previous clip space and tracks the exposure ratio', () => {
  const history = new MotionHistory()
  const camera = new PerspectiveCamera(65, 0.6, 0.08, 2000)
  const reproject = new Matrix4()
  camera.setViewOffset(585, 996, 0.2, -0.3, 585, 996)
  camera.position.set(0.1, 2, 4)
  camera.updateMatrixWorld()
  const point = new Vector3(0.7, 1, -2)
  const previous = point.clone().project(camera)
  expect(history.hasHistory).toBe(false)
  history.update(camera, 2, reproject)
  expect(history.hasHistory).toBe(true)

  camera.position.x += 0.12
  camera.lookAt(0, 1, -2)
  camera.setViewOffset(585, 996, -0.3, 0.1, 585, 996)
  camera.updateMatrixWorld()
  expect(history.update(camera, 3, reproject)).toBe(1.5)
  const current = point.clone().project(camera)
  const clip = new Vector4(current.x, current.y, current.z, 1).applyMatrix4(reproject)
  expect(clip.x / clip.w).toBeCloseTo(previous.x, 8)
  expect(clip.y / clip.w).toBeCloseTo(previous.y, 8)
  expect(clip.z / clip.w).toBeCloseTo(previous.z, 8)
  expect(clip.w * -point.clone().applyMatrix4(camera.matrixWorldInverse).z).toBeCloseTo(6, 8)
})

it('restarts the bounded jitter sequence when history is invalidated', () => {
  const history = new MotionHistory()
  const reproject = new Matrix4()
  history.update(new PerspectiveCamera(), 1, reproject)
  expect(Array.from({ length: 9 }, () => history.nextSample())).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1])
  history.reset()
  expect(history.hasHistory).toBe(false)
  expect(history.nextSample()).toBe(1)
})

it('fits the full shadow receiving region and aligns its light-space center to texels', () => {
  const yard = new Box3(new Vector3(-21, -9, -15), new Vector3(19, 13, 24))
  const sunView = new Matrix4().makeRotationY(0.65).setPosition(0.32, -0.17, 12)
  const size = new Vector2(2048, 2048)
  const fit = motionShadowBounds(yard, sunView, size)
  const box = yard.clone().applyMatrix4(sunView)
  expect(fit.x).toBeLessThan(box.min.x)
  expect(fit.y).toBeGreaterThan(box.max.x)
  expect(fit.z).toBeLessThan(box.min.y)
  expect(fit.w).toBeGreaterThan(box.max.y)
  const centerInTexelsX = (fit.x + fit.y) * 0.5 / ((fit.y - fit.x) / size.x)
  const centerInTexelsY = (fit.z + fit.w) * 0.5 / ((fit.w - fit.z) / size.y)
  expect(centerInTexelsX).toBeCloseTo(Math.round(centerInTexelsX), 8)
  expect(centerInTexelsY).toBeCloseTo(Math.round(centerInTexelsY), 8)
})
