import { memo, useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { Credits } from './Credits'
import { HomePage } from './HomePage'
import { Icon } from './icons'
import { designerRoute, homeFromRoute, homeRoute, PRESENTATION_ROUTE } from './routes'
import { BrowseImage, GalleryGrid, homes, images, imageSrc, SiteDialog } from './SiteGallery'
import { StyleComparison } from './StyleComparison'

const filters = [
  { id: 'all', label: 'All' },
  { id: 'exterior', label: 'Exteriors' },
  { id: 'interior', label: 'Interiors' },
  ...homes.map(plan => ({ id: plan.id, label: plan.name })),
]
const landingAnchors = ['', '#home', '#homes', '#compare', '#gallery']

const StyleGallery = memo(function StyleGallery({ onDesign }: { onDesign: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [filter, setFilter] = useState('all')
  const visible = filter === 'all' ? images : images.filter(image => image.kind === filter || image.plan === filter)

  return (
    <section className="site-wrap site-section" id="gallery" aria-labelledby="gallery-title">
      <div className="site-section-head">
        <h2 id="gallery-title">Style gallery</h2>
        <p>Explore elevations, rooms and finishes across all five homes.</p>
      </div>
      <div className="site-filters" role="group" aria-label="Filter renders">
        {filters.map(option => (
          <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      <GalleryGrid visible={visible} onDesign={onDesign} />
    </section>
  )
})

const Homes = memo(function Homes() {
  return (
    <section className="site-wrap site-section" id="homes" aria-labelledby="homes-title">
      <div className="site-section-head">
        <h2 id="homes-title">The homes</h2>
        <p>Explore floor plans, interiors and finish options for each home.</p>
      </div>
      <div className="site-homes">
        {homes.map(plan => {
          const exterior = images.find(image => image.id === `${plan.id}-golden`)
          return (
            <article className="site-home-card" key={plan.id}>
              <BrowseImage src={exterior ? imageSrc(exterior.id) : `./thumbs/${plan.id}.webp`} alt={`${plan.name} exterior`} />
              <div className="site-home-copy">
                <p className="site-home-style">{plan.style}</p>
                <h3>{plan.name}</h3>
                <p className="site-facts">{plan.area.toLocaleString('en-US')} sq ft <span>·</span> {plan.beds} beds <span>·</span> {plan.baths} baths</p>
                <a className="site-text-link" href={homeRoute(plan.id)} aria-label={`Explore ${plan.name}`}>Explore home <Icon.arrow /></a>
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
      <img src="./cuby.png" alt="" width="28" height="28" /> Cuby Studio
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
  const home = homeFromRoute(hash)
  const browsing = home || landingAnchors.includes(hash)
  const page = browsing ? home : homeFromRoute(anchor.current ?? '')
  const openDesign = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      onDesign(event.currentTarget.hash)
    }
  }, [onDesign])
  const closeCredits = () => { location.replace(anchor.current || '#home') }
  const status = progress ? `Preparing the studio · ${progress}%` : 'Explore in 3D'
  const hero = images.find(image => image.id === 'cedar-ridge-golden')
  const walk = page && images.find(image => image.plan === page.id && image.kind === 'interior')

  useLayoutEffect(() => {
    if (browsing && anchor.current !== hash) {
      anchor.current = hash
      document.getElementById(home ? 'home' : hash.slice(1) || 'home')?.scrollIntoView()
    }
  }, [browsing, hash, home])

  return (
    <div className="site" id="home">
      <header className="site-header">
        <div className="site-wrap site-header-inner">
          <Wordmark />
          <nav aria-label="Main navigation">
            <a href="#homes">Homes</a>
            <a href="#compare">Compare</a>
            <a href="#gallery">Gallery</a>
          </nav>
          <a href={PRESENTATION_ROUTE} className="site-header-cta" onClick={openDesign}>{ready ? 'Enter the studio' : 'Explore in 3D'} <Icon.diagonal /></a>
        </div>
      </header>

      <main>
        {page ? (
          <HomePage
            key={page.id}
            plan={page}
            onDesign={openDesign}
            walkThrough={error ? (
              <button type="button" className="site-cta site-walk-cta" onClick={onRetry}>Retry studio load <Icon.diagonal /></button>
            ) : (
              <a href={walk?.share ?? PRESENTATION_ROUTE} className="site-cta site-walk-cta" onClick={openDesign}>
                <span>{ready ? 'Walk through' : `Loading the 3D studio… ${progress}%`}</span><Icon.diagonal />
                {!ready && <span className="site-cta-progress" style={{ width: `${progress}%` }} aria-hidden="true" />}
              </a>
            )}
          />
        ) : <>
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
                  <a href={PRESENTATION_ROUTE} onClick={openDesign} className={`site-cta site-hero-cta ${ready ? 'site-ready' : ''}`}>
                    <span>{ready ? 'Enter the studio' : status}</span><Icon.diagonal />
                    {!ready && <span className="site-cta-progress" style={{ width: `${progress}%` }} aria-hidden="true" />}
                  </a>
                )}
                <a href={designerRoute()} className="site-cta site-tour-cta" onClick={openDesign}>
                  Design your own <Icon.diagonal />
                </a>
              </div>
              <p className="site-hero-caption">Cedar Ridge <span>·</span> Golden hour</p>
            </div>
          </section>

          <Homes />
          <StyleComparison />
          <StyleGallery onDesign={openDesign} />
        </>}
        <span className="site-sr-only" role="status">{ready ? 'The 3D studio is ready.' : ''}</span>
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
