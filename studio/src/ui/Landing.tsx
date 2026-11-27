import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
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

function StyleGallery({ onDesign }: { onDesign: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [filter, setFilter] = useState('all')
  const [index, setIndex] = useState<number | null>(null)
  const visible = filter === 'all' ? images : images.filter(image => image.kind === filter || image.plan === filter)

  return (
    <section className="site-wrap site-section" id="gallery" aria-labelledby="gallery-title">
      <div className="site-section-head">
        <div>
          <p className="site-kicker">Materials &amp; light</p>
          <h2 id="gallery-title">Style gallery</h2>
        </div>
        <p>See how cedar, stone and painted finishes change from daylight to dusk.</p>
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
              <img src={imageSrc(shot.id)} width="1600" height="900" alt="" loading="lazy" decoding="async" />
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
}

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
  const openDesign = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      onDesign(event.currentTarget.hash)
    }
  }
  const closeCredits = () => { location.replace(anchor.current || '#home') }
  const status = progress ? `Loading the 3D studio… ${progress}%` : 'Explore in 3D'
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
              <p className="site-kicker">Pacific Northwest homes</p>
              <h1 id="site-title">Cuby Studio</h1>
              <p className="site-pitch">Photoreal, real-time walkthroughs of Cuby homes, on any phone.</p>
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

        <section className="site-wrap site-section" id="homes" aria-labelledby="homes-title">
          <div className="site-section-head">
            <div>
              <h2 id="homes-title">Explore the homes</h2>
            </div>
            <p>Five plans with distinct materials, layouts and ways of living.</p>
          </div>
          <div className="site-homes">
            {homes.map(plan => {
              const exterior = images.find(image => image.id === `${plan.id}-golden`)
              const walk = images.find(image => image.plan === plan.id && image.kind === 'interior')
              return (
                <article className="site-home-card" key={plan.id}>
                  <img src={exterior ? imageSrc(exterior.id) : `./thumbs/${plan.id}.webp`} width="1600" height="900" alt={`${plan.name} exterior`} loading="lazy" decoding="async" />
                  <div className="site-home-copy">
                    <p className="site-home-style">{plan.style}</p>
                    <h3>{plan.name}</h3>
                    <p className="site-facts">{plan.area.toLocaleString('en-US')} sq ft <span>·</span> {plan.beds} beds <span>·</span> {plan.baths} baths</p>
                    <a className="site-text-link" href={walk?.share ?? '#studio'} onClick={openDesign} aria-label={`Walk through ${plan.name}`}>Walk through <Icon.arrow /></a>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <StyleGallery onDesign={openDesign} />

        <section className="site-method" aria-labelledby="method-title">
          <div className="site-wrap">
            <h2 id="method-title">How it works</h2>
            <div className="site-method-grid">
              <div><Icon.sun /><h3>Baked path-traced lighting</h3><p>Light bounces through rooms and softens into shadows, baked in advance for smooth walkthroughs.</p></div>
              <div><Icon.palette /><h3>Real materials</h3><p>Scanned textures at real-world scale show the grain of cedar, stone and timber.</p></div>
              <div><Icon.plans /><h3>Any device</h3><p>Walk, look around and change finishes in your browser, on a phone, tablet or desktop.</p></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-wrap site-footer">
        <Wordmark />
        <a href="#credits">Credits</a>
      </footer>
      {pending && (
        <div className="site-opening">
          <div role="status">
            <strong>{error ? 'The studio could not load' : 'Opening the 3D studio'}</strong>
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
