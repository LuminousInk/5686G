import type { GalleryImage } from '../galleryShots'

export function imageDimensions(shot?: Pick<GalleryImage, 'width' | 'height'>) {
  const { width = 0, height = 0 } = shot ?? {}
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : { width: 1600, height: 900 }
}

export function adjacentImage(index: number, count: number, direction: -1 | 1) {
  return (index + direction + count) % count
}

type Position = { x: number; y: number }

export function swipeDirection(start: Position, end: Position): -1 | 0 | 1 {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0
  return dx < 0 ? 1 : -1
}
