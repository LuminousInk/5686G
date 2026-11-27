import { useEffect, useRef, useState } from 'react'

export interface FilterChipsProps {
  label: string
  options: { id: string; label: string }[]
  selected: string
  onSelect: (id: string) => void
}

export function FilterChips(props: FilterChipsProps) {
  const { label, options, selected, onSelect } = props
  const ref = useRef<HTMLDivElement>(null)
  const [enhanced, setEnhanced] = useState<typeof import('./AriaFilterChips')>()
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    let active = true
    const load = () => {
      import('./AriaFilterChips').then(module => {
        if (active) setEnhanced(module)
      }, () => { /* The native group remains available. */ })
    }
    const group = ref.current
    if (!group || typeof IntersectionObserver === 'undefined') {
      load()
      return () => { active = false }
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      load()
    }, { rootMargin: '200px 0px' })
    observer.observe(group)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [])

  if (enhanced && !focused) return <enhanced.AriaFilterChips {...props} />

  return (
    <div
      ref={ref}
      className="site-filters"
      role="group"
      aria-label={label}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      {options.map(option => <button
        key={option.id} type="button" aria-pressed={option.id === selected} onClick={() => onSelect(option.id)}
      >{option.label}</button>)}
    </div>
  )
}
