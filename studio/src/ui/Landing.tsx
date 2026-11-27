import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import gallery from '../../public/gallery/gallery.json'
import { Credits } from './Credits'
import { Icon } from './icons'
import type { GalleryImage } from './galleryShots'

const { homes } = gallery
const images = gallery.images.filter((image): image is GalleryImage => image.kind === 'exterior' || image.kind === 'interior')
const filters = [
  { id: 'all', label: 'All' },
  { id: 'exterior', label: 'Exteriors' },
  { id: 'interior', label: 'Interiors' },
  ...homes.map(plan => ({ id: plan.id, label: plan.name })),
]
const imageSrc = (id: string) => `./gallery/${id}.webp`

function BrowseImage({ src, alt }: { src: string; alt: string }) {
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
  return <img ref={ref} src={near ? src : undefined} width="1600" height="900" alt={alt} decoding="async" />
}

function SiteDialog({ className, label, onClose, children }: {
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

const StyleGallery = memo(function StyleGallery({ onDesign }: { onDesign: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [filter, setFilter] = useState('all')
  const [index, setIndex] = useState<number | null>(null)
  const visible = filter === 'all' ? images : images.filter(image => image.kind === filter || image.plan === filter)

  return (
    <section className="site-wrap site-section" id="gallery" aria-labelledby="gallery-title">
      <div className="site-section-head">
        <div>
          <h2 id="gallery-title">Style gallery</h2>
        </div>
        <p>Compare cedar, stone and paint in daylight and at dusk.</p>
      </div>
      <div className="site-filters" role="group" aria-label="Filter renders">
        {filters.map(option => (
          <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      <div className="site-gallery-grid">
        {visible.map((shot, i) => (
          <button className="site-gallery-item" type="button" key={shot.id} onClick={() => setIndex(i)}>
            <div className="site-gallery-media">
              <BrowseImage src={imageSrc(shot.id)} alt="" />
              <span className="site-gallery-expand"><Icon.expand /></span>
            </div>
            <span className="site-gallery-title"><strong>{shot.space}</strong><span>{shot.light}</span></span>
            <span className="site-gallery-meta">{shot.home} · {shot.style}</span>
          </button>
        ))}
      </div>
      {index !== null && <Lightbox visible={visible} index={index} onIndex={setIndex} onClose={() => setIndex(null)} onDesign={onDesign} />}
    </section>
  )
})

const Homes = memo(function Homes({ onDesign }: { onDesign: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <section className="site-wrap site-section" id="homes" aria-labelledby="homes-title">
      <div className="site-section-head">
        <h2 id="homes-title">The homes</h2>
        <p>Cuby’s Woodland, Coastal and Desert Modern lines, alongside Cedar Ridge and Aspen Custom.</p>
      </div>
      <div className="site-homes">
        {homes.map(plan => {
          const exterior = images.find(image => image.id === `${plan.id}-golden`)
          const walk = images.find(image => image.plan === plan.id && image.kind === 'interior')
          return (
            <article className="site-home-card" key={plan.id}>
              <BrowseImage src={exterior ? imageSrc(exterior.id) : `./thumbs/${plan.id}.webp`} alt={`${plan.name} exterior`} />
              <div className="site-home-copy">
                <p className="site-home-style">{plan.style}</p>
                <h3>{plan.name}</h3>
                <p className="site-facts">{plan.area.toLocaleString('en-US')} sq ft <span>·</span> {plan.beds} beds <span>·</span> {plan.baths} baths</p>
                <a className="site-text-link" href={walk?.share ?? '#studio'} onClick={onDesign} aria-label={`Walk through ${plan.name}`}>Walk through <Icon.arrow /></a>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
})

function Wordmark() {
  return (
    <a className="site-wordmark" href="#home">
      <img src="./cuby.svg" alt="" width="28" height="28" /> Cuby Studio
    </a>
  )
}

export function Landing({ hash, progress, ready, pending, error, onRetry, onDesign }: {
  hash: string
  progress: number
  ready: boolean
  pending: boolean
  error: boolean
  onRetry: () => void
  onDesign: (hash: string) => void
}) {
  const credits = hash === '#credits'
  const anchor = useRef<string | null>(null)
  const openDesign = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      onDesign(event.currentTarget.hash)
    }
  }, [onDesign])
  const closeCredits = () => { location.replace(anchor.current || '#home') }
  const status = progress ? `Preparing the studio · ${progress}%` : 'Explore in 3D'
  const hero = images.find(image => image.id === 'cedar-ridge-golden')

  useLayoutEffect(() => {
    if (['', '#home', '#homes', '#gallery'].includes(hash) && anchor.current !== hash) {
      anchor.current = hash
      document.getElementById(hash.slice(1) || 'home')?.scrollIntoView()
    }
  }, [hash])

  return (
    <div className="site" id="home">
      <header className="site-header">
        <div className="site-wrap site-header-inner">
          <Wordmark />
          <nav aria-label="Main navigation">
            <a href="#homes">Homes</a>
            <a href="#gallery">Gallery</a>
          </nav>
          <a href="#studio" className="site-header-cta">{ready ? 'Enter the studio' : 'Explore in 3D'} <Icon.diagonal /></a>
        </div>
      </header>

      <main>
        <section className="site-hero" aria-labelledby="site-title">
          <img className="site-hero-img" src={hero ? imageSrc(hero.id) : './thumbs/cedar-ridge.webp'} alt="Cedar Ridge in golden-hour light, viewed across the garden" fetchPriority="high" />
          <div className="site-wrap site-hero-inner">
            <div>
              <p className="site-kicker">Pacific Palisades</p>
              <h1 id="site-title">Cuby Studio</h1>
              <p className="site-pitch">Five homes on coastal hillsides with ocean views.</p>
              {error ? (
                <button type="button" className="site-cta" onClick={onRetry}>Retry studio load <Icon.diagonal /></button>
              ) : (
                <a href="#studio" className={`site-cta site-hero-cta ${ready ? 'site-ready' : ''}`}>
                  <span>{ready ? 'Enter the studio' : status}</span><Icon.diagonal />
                  {!ready && <span className="site-cta-progress" style={{ width: `${progress}%` }} aria-hidden="true" />}
                </a>
              )}
              <span className="site-sr-only" role="status">{ready ? 'The 3D studio is ready.' : ''}</span>
            </div>
            <p className="site-hero-caption">Cedar Ridge <span>·</span> Golden hour</p>
          </div>
        </section>

        <Homes onDesign={openDesign} />
        <StyleGallery onDesign={openDesign} />
      </main>

      <footer className="site-wrap site-footer">
        <Wordmark />
        <a href="#credits">Credits</a>
      </footer>
      {pending && (
        <div className="site-opening">
          <div role="status">
            <strong>{error ? 'The studio could not load' : 'Opening the studio'}</strong>
            {!error && <progress value={progress} max="100" aria-label="Studio loading progress" />}
          </div>
          {error && <button type="button" className="site-text-link" onClick={onRetry}>Retry</button>}
          <a className="site-square" href={anchor.current || '#home'} aria-label="Keep browsing"><Icon.close /></a>
        </div>
      )}
      {credits && (
        <SiteDialog className="site-credits" label="Credits" onClose={closeCredits}>
          <div className="site-credits-body">
            <div className="site-lightbox-bar">
              <h2>Credits</h2>
              <button type="button" className="site-square" aria-label="Close credits" onClick={closeCredits}><Icon.close /></button>
            </div>
            <Credits />
          </div>
        </SiteDialog>
      )}
    </div>
  )
}
