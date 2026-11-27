import manifest from '../../../public/pano/manifest.json'

export interface PhotoLink {
  to: string
  via: number[]
  /** Photo Sphere Viewer angles in radians, relative to the panorama center. */
  yaw: number
  pitch: number
}

export interface PhotoStop {
  id: string
  room?: string
  deck?: string
  name: string
  caption: string
  /** X, Y, Z in plan metres. Heading is measured from +Z toward +X in radians. */
  position: number[]
  heading: number
  fov: number
  time: string
  image: string
  studio: string
  rendered: boolean
  links: PhotoLink[]
}

export interface PhotoHome {
  id: string
  name: string
  stops: PhotoStop[]
}

export const photoHomes: PhotoHome[] = manifest.homes

export const photoHome = (id: string) => photoHomes.find(home => home.id === id)
export const photoSrc = (stop: PhotoStop) => `./pano/${stop.image}`

export function renderedStops(home: PhotoHome) {
  const rendered = home.stops.filter(stop => stop.rendered)
  const ids = new Set(rendered.map(stop => stop.id))
  return rendered.map(stop => ({ ...stop, links: stop.links.filter(link => ids.has(link.to)) }))
}
