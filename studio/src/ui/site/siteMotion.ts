import { useEffect, useState } from 'react'
import { animate } from 'motion/mini'

const motionPreference = '(prefers-reduced-motion: reduce)'
const motionAllowed = () => !matchMedia(motionPreference).matches && typeof Element.prototype.animate === 'function'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia(motionPreference).matches)
  useEffect(() => {
    const media = matchMedia(motionPreference)
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

export function enterPage(element: HTMLElement | null) {
  if (!element || !motionAllowed()) return
  const animation = animate(element, { opacity: [.8, 1], transform: ['translateY(6px)', 'translateY(0)'] }, {
    duration: .42, ease: 'easeOut',
  })
  return () => animation.cancel()
}

let observer: IntersectionObserver | undefined
export function revealOnScroll(element: HTMLElement | null) {
  if (!element || !motionAllowed() || typeof IntersectionObserver === 'undefined') return
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      observer?.unobserve(entry.target)
      if (!motionAllowed() || entry.target.matches(':focus-within')) continue
      animate(entry.target, { opacity: [.72, 1], transform: ['translateY(12px)', 'translateY(0)'] }, {
        duration: .45, ease: 'easeOut',
      })
    }
  }, { threshold: .08 })
  observer.observe(element)
  return () => observer?.unobserve(element)
}
