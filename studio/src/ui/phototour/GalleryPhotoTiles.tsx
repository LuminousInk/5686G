import { Icon } from '../icons'
import { photoRoute } from '../routes'
import { revealOnScroll } from '../site/siteMotion'
import { photoHomes, photoSrc } from './manifest'

export default function GalleryPhotoTiles({ plans, showHome }: { plans: ReadonlySet<string>; showHome: boolean }) {
  return photoHomes.filter(home => plans.has(home.id)).map(home => {
    const stop = home.stops.find(candidate => candidate.rendered)
    if (!stop) return null
    return (
      <a className="site-gallery-item" key={home.id} ref={revealOnScroll} href={photoRoute(home.id)}>
        <span className="site-gallery-media">
          <img src={photoSrc(stop)} alt="" width={2560} height={1440} style={{ aspectRatio: '16 / 9', objectFit: 'cover' }} loading="lazy" decoding="async" />
          <span className="site-gallery-expand"><Icon.aperture /></span>
        </span>
        <span className="site-gallery-caption">
          <span>{showHome && `${home.name} · `}360° photo tour</span>
          <strong>{stop.name}</strong>
        </span>
      </a>
    )
  })
}
