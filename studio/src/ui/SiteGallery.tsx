import { lazy, memo, Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Icon } from './icons'
import type { GalleryImage } from './galleryShots'
import { imageSrc } from './site/galleryCatalog'
import { imageDimensions } from './site/galleryPresentation'
import { revealOnScroll } from './site/siteMotion'

const GalleryLightbox = lazy(() => import('./site/GalleryLightbox').then(module => ({ default: module.GalleryLightbox })))
const GalleryPhotoTiles = lazy(() => import('./phototour/GalleryPhotoTiles'))

export function BrowseImage({ src, alt, shot, onError }: {
  src: string
  alt: string
  shot?: GalleryImage
  onError?: () => void
}) {
  const ref = useRef<HTMLImageElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setNear(true)
      observer.disconnect()
    }, { rootMargin: '200px 0px' })
    observer.observe(ref.current!)
    return () => observer.disconnect()
  }, [])
  return <img ref={ref} src={near ? src : undefined} {...imageDimensions(shot)} alt={alt} decoding="async" onError={onError} />
}

export function SiteDialog({ className, label, onClose, children }: {
  className: string
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </dialog>
  )
}

export const GalleryGrid = memo(function GalleryGrid({ visible, onDesign, showHome = true }: {
  visible: GalleryImage[]
  onDesign: (event: MouseEvent<HTMLAnchorElement>) => void
  showHome?: boolean
}) {
  const [current, setCurrent] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const shots = visible.filter(shot => !missing.includes(shot.id))
  const index = shots.findIndex(shot => shot.id === current)
  const photoPlans = new Set(visible.filter(shot => shot.kind === 'interior').map(shot => shot.plan))

  return (
    <>
      <div className="site-gallery-grid">
        {!!photoPlans.size && <Suspense><GalleryPhotoTiles plans={photoPlans} showHome={showHome} /></Suspense>}
        {shots.map(shot => (
          <button className="site-gallery-item" type="button" key={shot.id} ref={revealOnScroll} aria-haspopup="dialog" onClick={event => {
            event.currentTarget.focus({ preventScroll: true })
            setCurrent(shot.id)
          }}>
            <span className="site-gallery-media">
              <BrowseImage src={imageSrc(shot.id)} alt="" shot={shot} onError={() => setMissing(ids => [...ids, shot.id])} />
              <span className="site-gallery-expand"><Icon.expand /></span>
            </span>
            <span className="site-gallery-caption">
              <span>{showHome && `${shot.home} · `}{shot.light}</span>
              <strong>{shot.space}</strong>
              <span className="site-gallery-material">{shot.style}</span>
            </span>
          </button>
        ))}
      </div>
      {index >= 0 && (
        <Suspense fallback={<span className="site-sr-only" role="status">Opening the render gallery…</span>}>
          <GalleryLightbox
            visible={shots}
            index={index}
            onIndex={i => setCurrent(shots[i].id)}
            onClose={() => setCurrent(null)}
            onDesign={onDesign}
          />
        </Suspense>
      )}
    </>
  )
})
