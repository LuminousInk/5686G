import gallery from '../../../public/gallery/gallery.json'
import type { GalleryImage } from '../galleryShots'

export const { homes, comparisons } = gallery
export const images = gallery.images.filter((image): image is GalleryImage => image.kind === 'exterior' || image.kind === 'interior')
export const imageSrc = (id: string) => `./gallery/${id}.webp`
