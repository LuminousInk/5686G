import { describe, expect, it } from 'vitest'
import { adjacentImage, imageDimensions, swipeDirection } from './galleryPresentation'

describe('gallery presentation', () => {
  it('reserves the original frame for existing shots and supports panorama metadata', () => {
    expect(imageDimensions()).toEqual({ width: 1600, height: 900 })
    expect(imageDimensions({ width: 4096, height: 2048 })).toEqual({ width: 4096, height: 2048 })
    expect(imageDimensions({ width: 4096 })).toEqual({ width: 1600, height: 900 })
    expect(imageDimensions({ width: 4096, height: 0 })).toEqual({ width: 1600, height: 900 })
  })

  it('wraps image navigation within the visible gallery', () => {
    expect(adjacentImage(0, 5, -1)).toBe(4)
    expect(adjacentImage(4, 5, 1)).toBe(0)
    expect(adjacentImage(0, 1, 1)).toBe(0)
  })

  it('recognizes a deliberate horizontal swipe in either direction', () => {
    const start = { x: 100, y: 100 }
    expect(swipeDirection(start, { x: 25, y: 115 })).toBe(1)
    expect(swipeDirection(start, { x: 175, y: 115 })).toBe(-1)
    expect(swipeDirection(start, { x: 70, y: 101 })).toBe(0)
    expect(swipeDirection(start, { x: 30, y: 160 })).toBe(0)
  })
})
