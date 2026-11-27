import { memo, useState, type CSSProperties } from 'react'
import { availableComparisons } from './galleryShots'
import { Icon } from './icons'
import { BrowseImage } from './SiteGallery'
import { comparisons, images, imageSrc } from './site/galleryCatalog'
import { FilterChips } from './site/FilterChips'
import { imageDimensions } from './site/galleryPresentation'
import { revealOnScroll } from './site/siteMotion'

export const StyleComparison = memo(function StyleComparison() {
  const [choice, setChoice] = useState('')
  const [missing, setMissing] = useState<Set<string>>(() => new Set())
  const pairs = availableComparisons(comparisons, images, missing)
  const pair = pairs.find(candidate => candidate.before.id === choice) ?? pairs[0]
  const unavailable = (id: string) => setMissing(previous => new Set(previous).add(id))

  return (
    <section className="site-wrap site-section" id="compare" tabIndex={-1} aria-labelledby="comparison-title">
      <div className="site-section-head" ref={revealOnScroll}>
        <h2 id="comparison-title">Compare styles</h2>
        {pair && <p>Drag the slider to see how finishes and light change the same view.</p>}
      </div>
      {pair ? (
        <>
          <FilterChips
            label="Choose a home to compare"
            options={pairs.map(({ before }) => ({ id: before.id, label: before.home }))}
            selected={pair.before.id}
            onSelect={setChoice}
          />
          <ComparisonSlider key={pair.before.id} pair={pair} unavailable={unavailable} />
        </>
      ) : (
        <p className="site-muted" role="status">Comparisons are unavailable. Browse the <a className="site-inline-link" href="#gallery">style gallery</a> for more views.</p>
      )}
    </section>
  )
})

function ComparisonSlider({ pair, unavailable }: {
  pair: ReturnType<typeof availableComparisons>[number]
  unavailable: (id: string) => void
}) {
  const [split, setSplit] = useState(50)
  const { before, after, beforeLabel, afterLabel } = pair
  const { width, height } = imageDimensions(before)

  return (
    <figure className="site-comparison">
      <div className="site-comparison-stage" style={{ '--split': `${split}%`, aspectRatio: `${width} / ${height}` } as CSSProperties}>
        <BrowseImage src={imageSrc(after.id)} shot={after} alt={`${after.home}, ${after.space}, ${afterLabel}`} onError={() => unavailable(after.id)} />
        <div className="site-comparison-before">
          <BrowseImage src={imageSrc(before.id)} shot={before} alt={`${before.home}, ${before.space}, ${beforeLabel}`} onError={() => unavailable(before.id)} />
        </div>
        <div className="site-comparison-divider" aria-hidden="true">
          <span><Icon.left /><Icon.right /></span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={split}
          aria-label={`Compare ${beforeLabel} and ${afterLabel}`}
          aria-valuetext={`${beforeLabel} ${split}%, ${afterLabel} ${100 - split}%`}
          onChange={event => setSplit(event.currentTarget.valueAsNumber)}
        />
      </div>
      <figcaption className="site-comparison-labels">
        <span><small>Before</small>{beforeLabel}</span>
        <span><small>After</small>{afterLabel}</span>
      </figcaption>
    </figure>
  )
}
