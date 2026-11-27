import { useEffect, useRef } from 'react'
import { animate } from 'motion/mini'
import { useReducedMotion } from './siteMotion'

export function StudioProgress({ value, ready }: { value: number; ready: boolean }) {
  const fill = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const bar = fill.current
    if (!bar) return
    const transform = `scaleX(${(ready ? 100 : value) / 100})`
    if (reduced || typeof bar.animate !== 'function') {
      bar.style.transform = transform
      return
    }
    const animation = animate(bar, { transform }, { duration: .45, ease: 'easeOut' })
    return () => animation.stop()
  }, [ready, reduced, value])

  return (
    <div className="site-studio-progress">
      <div className="site-progress-label" aria-hidden="true">
        <span>{ready ? 'Studio ready' : 'Preparing the 3D studio'}</span>
        <span>{ready ? '100' : value}%</span>
      </div>
      <div
        className="site-progress-track"
        role={ready ? undefined : 'progressbar'}
        aria-label={ready ? undefined : 'Preparing the 3D studio'}
        aria-valuenow={ready ? undefined : value}
        aria-hidden={ready || undefined}
      ><span ref={fill} /></div>
    </div>
  )
}
