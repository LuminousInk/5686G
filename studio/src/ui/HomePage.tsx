import { memo, useId, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { levelId } from '../engine/house/levels'
import type { HomePlan } from '../engine/house/types'
import { ZONES } from '../engine/materials/catalog'
import { feetInches, FloorPlan } from './FloorPlan'
import { Icon } from './icons'
import { GalleryGrid } from './SiteGallery'
import { images, imageSrc } from './site/galleryCatalog'
import { designerRoute, photoRoute, tourRoute } from './routes'
import { photoHome } from './phototour/manifest'
import { imageDimensions } from './site/galleryPresentation'
import { enterPage, revealOnScroll } from './site/siteMotion'

const descriptions: Record<string, string> = {
  'cedar-ridge': 'Natural cedar, charcoal steel and a solar roof frame a single-level home built around its garden. The great room opens to a terraced patio and rock garden, with the kitchen and dining room at one end and a quieter primary suite at the other.',
  'coastal-modern': 'Chalk siding and a cedar-clad great room give this compact, single-level plan a warm center. Clerestory windows bring light into the living space, which runs from the entry terrace through dining to the kitchen. Three bedrooms sit together in the quieter wing.',
  'woodland-modern': 'A cedar gable and glazed entry bring light into the great room between two charcoal wings. The dining room and office sit near the primary suite, while the other bedrooms and garage share the opposite wing.',
  'aspen-custom': 'The main-level great room opens onto a 1,181 sq ft deck above two walkout suites. An angled accessory dwelling gives guests their own space, while three bedrooms and a four-car garage complete the main house.',
  'modern-farmhouse': 'Steep gables, white board and batten, and black windows frame a deep front porch. Inside, the foyer leads into a central great room and dining bay, with four bedrooms and an attached garage on the same level.',
}

function HomeFacts({ facts }: { facts: HomePlan['facts'] }) {
  const list = [
    ['Living area', `${facts.area.toLocaleString('en-US')} sq ft`],
    ['Beds', facts.beds],
    ['Baths', facts.baths],
    ['Levels', facts.stories],
    ['Garage', facts.garage ? `${facts.garage.toLocaleString('en-US')} sq ft` : 'None shown'],
  ]
  return (
    <dl className="site-home-facts">
      {list.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  )
}

const HomeFloorPlan = memo(function HomeFloorPlan({ plan }: { plan: HomePlan }) {
  const [level, setLevel] = useState(() => levelId(plan))
  const [selected, setSelected] = useState('')
  const pickerId = useId()
  const rooms = plan.rooms.filter(room => levelId(plan, room.level) === level)
  const room = rooms.find(candidate => candidate.id === selected)

  return (
    <section className="site-wrap site-section" aria-labelledby="home-plan-title">
      <div className="site-section-head" ref={revealOnScroll}>
        <h2 id="home-plan-title">Floor plan</h2>
        <p>Select a room to see its dimensions.</p>
      </div>
      <div className="site-plan">
        <FloorPlan
          plan={plan}
          onRoom={setSelected}
          selected={selected}
          onLevelChange={next => {
            if (level === next) return
            setLevel(next)
            setSelected('')
          }}
        />
        <div className="site-plan-room">
          <div className="site-room-picker">
            <label htmlFor={pickerId}>Room</label>
            <select id={pickerId} value={selected} onChange={event => setSelected(event.target.value)}>
              <option value="">Choose a room</option>
              {rooms.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <p role="status">{room && `${room.name} · ${feetInches(room.rect[2] - room.rect[0])} × ${feetInches(room.rect[3] - room.rect[1])}`}</p>
        </div>
      </div>
    </section>
  )
})

const FinishOptions = memo(function FinishOptions({ plan }: { plan: HomePlan }) {
  return (
    <section className="site-wrap site-section" aria-labelledby="finishes-title">
      <div className="site-section-head" ref={revealOnScroll}>
        <h2 id="finishes-title">Finish options</h2>
        <p>The marked swatches show the home’s standard finishes.</p>
      </div>
      <div className="site-finish-zones">
        {plan.zones.map(id => {
          const zone = ZONES[id]
          return (
            <div className="site-finish-zone" key={id}>
              <h3>{zone.label}</h3>
              <ul className="site-swatches">
                {zone.options.map(option => (
                  <li key={option.id} className={option.id === plan.finishes[id] ? 'site-default-finish' : undefined}>
                    <span className="site-swatch-color" style={{ background: option.swatch }} aria-hidden="true" />
                    <span>{option.name}</span>
                    {option.id === plan.finishes[id] && <small>Standard</small>}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
})

export function HomePage({ plan, walkThrough, onDesign }: {
  plan: HomePlan
  walkThrough: ReactNode
  onDesign: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const shots = useMemo(() => images.filter(image => image.plan === plan.id), [plan.id])
  const hero = shots.find(image => image.id === `${plan.id}-golden`)
  const hasPhotos = photoHome(plan.id)?.stops.some(stop => stop.rendered)
  return (
    <>
      <section className="site-home-feature" aria-labelledby="site-title">
        <div className="site-wrap site-home-heading">
          <a className="site-breadcrumb" href="#homes"><Icon.left /> All homes</a>
          <div className="site-home-title-row" ref={enterPage}>
            <div>
              <p className="site-kicker">{plan.style}</p>
              <h1 id="site-title">{plan.name}</h1>
            </div>
            <div className="site-home-ctas">
              {walkThrough}
              {hasPhotos && <a className="site-cta site-tour-cta" href={photoRoute(plan.id)}>
                <Icon.aperture /> 360° photo tour
              </a>}
              <a className="site-cta site-tour-cta" href={designerRoute(plan.id)} onClick={onDesign}>
                Design your own <Icon.diagonal />
              </a>
              {!!plan.tour?.length && <a className="site-cta site-tour-cta" href={tourRoute(plan.id)} onClick={onDesign}>
                <Icon.play /> Take the tour
              </a>}
            </div>
          </div>
        </div>
        <figure className="site-wrap site-home-render">
          <img
            {...imageDimensions(hero)}
            src={hero ? imageSrc(hero.id) : `./thumbs/${plan.id}.webp`}
            alt={hero ? `${plan.name}, ${hero.space.toLowerCase()} in ${hero.light.toLowerCase()}` : `${plan.name} exterior`}
            fetchPriority="high"
          />
          {hero && <figcaption>{hero.space} · {hero.light}</figcaption>}
        </figure>
        <div className="site-wrap site-home-intro">
          <p className="site-home-description">{descriptions[plan.id] ?? plan.tagline}</p>
          <HomeFacts facts={plan.facts} />
        </div>
      </section>
      <HomeFloorPlan plan={plan} />
      <section className="site-wrap site-section" aria-labelledby="home-gallery-title">
        <div className="site-section-head" ref={revealOnScroll}>
          <h2 id="home-gallery-title">Gallery</h2>
        </div>
        <GalleryGrid visible={shots} onDesign={onDesign} showHome={false} />
      </section>
      <FinishOptions plan={plan} />
    </>
  )
}
