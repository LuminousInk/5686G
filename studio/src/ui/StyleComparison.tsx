import { memo, useState, type CSSProperties } from 'react'
import manifest from '../../public/gallery/gallery.json'
import { availableComparisons } from './galleryShots'
import { Icon } from './icons'
import { BrowseImage, images, imageSrc } from './SiteGallery'

export const StyleComparison = memo(function StyleComparison() {
  const [choice, setChoice] = useState('')
  const [missing, setMissing] = useState<Set<string>>(() => new Set())
  const pairs = availableComparisons(manifest.comparisons, images, missing)
  const pair = pairs.find(candidate => candidate.before.id === choice) ?? pairs[0]
  const unavailable = (id: string) => setMissing(previous => new Set(previous).add(id))

  return (
    <section className="site-wrap site-section" id="compare" aria-labelledby="comparison-title">
      <div className="site-section-head">
        <h2 id="comparison-title">Compare styles</h2>
        {pair && <p>Drag the slider to see how finishes and light change the same view.</p>}
      </div>
      {pair ? (
        <>
          <div className="site-filters" role="group" aria-label="Choose a home to compare">
            {pairs.map(({ before }) => (
              <button key={before.id} type="button" aria-pressed={before.id === pair.before.id} onClick={() => setChoice(before.id)}>
                {before.home}
              </button>
            ))}
          </div>
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

  return (
    <figure className="site-comparison">
      <div className="site-comparison-stage" style={{ '--split': `${split}%` } as CSSProperties}>
        <BrowseImage src={imageSrc(after.id)} alt={`${after.home}, ${after.space}, ${afterLabel}`} onError={() => unavailable(after.id)} />
        <div className="site-comparison-before">
          <BrowseImage src={imageSrc(before.id)} alt={`${before.home}, ${before.space}, ${beforeLabel}`} onError={() => unavailable(before.id)} />
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
