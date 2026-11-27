import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import gallery from '../../public/gallery/gallery.json'
import { Icon } from './icons'
import type { GalleryImage } from './galleryShots'

export const { homes } = gallery
export const images = gallery.images.filter((image): image is GalleryImage => image.kind === 'exterior' || image.kind === 'interior')
export const imageSrc = (id: string) => `./gallery/${id}.webp`

export function BrowseImage({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) {
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
  return <img ref={ref} src={near ? src : undefined} width="1600" height="900" alt={alt} decoding="async" onError={onError} />
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

function Lightbox({ visible, index, onIndex, onClose, onDesign }: {
  visible: GalleryImage[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  onDesign: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const shot = visible[index]
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const step = (direction: number) => onIndex((index + direction + visible.length) % visible.length)

  return (
    <SiteDialog className="site-lightbox" label="Render gallery" onClose={onClose}>
      <div
        className="site-lightbox-body"
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            step(event.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
      >
        <div className="site-lightbox-bar">
          <p>{index + 1} / {visible.length}</p>
          <button type="button" className="site-square" aria-label="Close lightbox" onClick={onClose}>
            <Icon.close />
          </button>
        </div>
        <div
          className="site-lightbox-image"
          onPointerDown={event => {
            if (event.pointerType !== 'touch' || !event.isPrimary) return
            touchStart.current = { x: event.clientX, y: event.clientY }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerCancel={() => { touchStart.current = null }}
          onPointerUp={event => {
            const start = touchStart.current
            touchStart.current = null
            if (!start) return
            const dx = event.clientX - start.x
            const dy = event.clientY - start.y
            if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1)
          }}
        >
          <img src={imageSrc(shot.id)} width="1600" height="900" alt={`${shot.home}, ${shot.space}`} draggable={false} />
        </div>
        <div className="site-lightbox-caption">
          <div aria-live="polite">
            <h2>{shot.space}</h2>
            <p>{shot.home} · {shot.light}</p>
            <p>{shot.style}</p>
          </div>
          <div className="site-lightbox-actions">
            {visible.length > 1 && (
              <div className="site-lightbox-arrows">
                <button type="button" className="site-square" aria-label="Previous render" onClick={() => step(-1)}><Icon.left /></button>
                <button type="button" className="site-square" aria-label="Next render" onClick={() => step(1)}><Icon.right /></button>
              </div>
            )}
            <a className="site-cta" href={shot.share} onClick={event => {
              onDesign(event)
              onClose()
            }}>Open in 3D <Icon.diagonal /></a>
          </div>
        </div>
      </div>
    </SiteDialog>
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

  return (
    <>
      <div className="site-gallery-grid">
        {shots.map(shot => (
          <button className="site-gallery-item" type="button" key={shot.id} onClick={() => setCurrent(shot.id)}>
            <span className="site-gallery-media">
              <BrowseImage src={imageSrc(shot.id)} alt="" onError={() => setMissing(ids => [...ids, shot.id])} />
              <span className="site-gallery-expand"><Icon.expand /></span>
              <span className="site-gallery-caption">
                <strong>{shot.space}</strong>
                <span>{showHome && `${shot.home} · `}{shot.light}</span>
                <span className="site-gallery-material">{shot.style}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      {index >= 0 && (
        <Lightbox
          visible={shots}
          index={index}
          onIndex={i => setCurrent(shots[i].id)}
          onClose={() => setCurrent(null)}
          onDesign={onDesign}
        />
      )}
    </>
  )
})
