import { useRef, useState } from 'react'

/** Thumb joystick for walking on touch screens: drag up to walk forward, sideways to step aside. */
export function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false })
  const id = useRef<number | null>(null)
  const R = 46
  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect()
    let x = e.clientX - (r.left + r.width / 2)
    let y = e.clientY - (r.top + r.height / 2)
    const d = Math.hypot(x, y)
    if (d > R) {
      x = (x / d) * R
      y = (y / d) * R
    }
    setKnob({ x, y, active: true })
    // gentle response curve near the centre
    const nx = x / R
    const ny = -y / R
    const k = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.4)
    onMove(k(nx), k(ny))
  }
  return (
    <div
      ref={base}
      className={`joystick ${knob.active ? 'is-active' : ''}`}
      onPointerDown={e => {
        e.stopPropagation()
        id.current = e.pointerId
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        update(e)
      }}
      onPointerMove={e => {
        if (id.current === e.pointerId) update(e)
      }}
      onPointerUp={e => {
        if (id.current !== e.pointerId) return
        id.current = null
        setKnob({ x: 0, y: 0, active: false })
        onMove(0, 0)
      }}
      onPointerCancel={() => {
        id.current = null
        setKnob({ x: 0, y: 0, active: false })
        onMove(0, 0)
      }}
      aria-label="Walk joystick"
      role="slider"
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  )
}
