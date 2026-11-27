import { useEffect, useRef, useState } from 'react'
import { animate } from 'motion/mini'
import { imageSrc } from './galleryCatalog'
import type { GalleryImage } from '../galleryShots'
import { useReducedMotion } from './siteMotion'

export function HeroRenders({ shots, loading }: { shots: GalleryImage[]; loading: boolean }) {
  const [current, setCurrent] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const incoming = useRef<HTMLImageElement>(null)
  const reduced = useReducedMotion()
  const shot = shots[current]

  useEffect(() => {
    if (!loading || reduced || next !== null || shots.length < 2) return
    const timer = window.setTimeout(() => setNext((current + 1) % shots.length), 4200)
    return () => window.clearTimeout(timer)
  }, [current, loading, next, reduced, shots.length])

  useEffect(() => {
    const image = incoming.current
    if (next === null || !image) return
    if (reduced) {
      setNext(null)
      return
    }
    let active = true
    let fade: ReturnType<typeof animate> | undefined
    image.decode().then(async () => {
      if (!active) return
      if (typeof image.animate === 'function') {
        fade = animate(image, { opacity: [0, 1] }, { duration: .9, ease: 'easeInOut' })
        await fade.finished
      }
      if (active) {
        setCurrent(next)
        setNext(null)
      }
    }, () => {
      if (active) setNext(null)
    })
    return () => {
      active = false
      fade?.cancel()
    }
  }, [next, reduced])

  return (
    <>
      <div className="site-hero-media">
        {[current, ...(next === null ? [] : [next])].map(index => {
          const render = shots[index]
          const pending = index !== current
          return <img
            key={render?.id ?? 'hero'}
            ref={pending ? incoming : undefined}
            className={pending ? 'site-hero-img site-hero-incoming' : 'site-hero-img'}
            src={render ? imageSrc(render.id) : './thumbs/cedar-ridge.webp'}
            alt={pending ? '' : render ? `${render.home}, ${render.space.toLowerCase()} in ${render.light.toLowerCase()}` : 'Cedar Ridge exterior'}
            fetchPriority={pending ? 'low' : 'high'}
            decoding="async"
          />
        })}
      </div>
      <p className="site-hero-caption">{shot?.home ?? 'Cedar Ridge'} <span>·</span> {shot?.light ?? 'Golden hour'}</p>
    </>
  )
}
