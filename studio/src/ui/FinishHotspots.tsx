import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Engine } from '../engine/Engine'
import { ZONES } from '../engine/materials/catalog'
import { HotspotSurfaces, MAX_HOTSPOTS, type HotspotAnchor } from './hotspotSurfaces'
import { ZoneSwatches } from './Panels'
import { Icon } from './icons'
import { useStore } from './store'

const STORAGE_KEY = 'cuby-studio-finish-hotspots'

export function useFinishHotspots() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'on' } catch { return false }
  })
  return [enabled, () => {
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'off' : 'on') } catch { /* Storage is optional. */ }
    setEnabled(!enabled)
  }] as const
}

const label = ({ key, zone }: HotspotAnchor) => key === 'cabinet' ? 'Cabinet finish' : key === 'floor' ? 'Floor finish' : ZONES[zone].label

export function FinishHotspots({ engine, isMoving, onFinish, onCustomize }: {
  engine: Engine
  isMoving: () => boolean
  onFinish: (zone: string, opt: string) => void
  onCustomize: (zone: string) => void
}) {
  const layer = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const picker = useRef<HTMLDivElement>(null)
  const anchors = useRef<HotspotAnchor[]>([])
  const selected = useRef<number>(null)
  const [open, setOpen] = useState<number | null>(null)
  const finishes = useStore(s => s.finishes[s.planId])

  useEffect(() => {
    const container = layer.current!
    const { camera } = engine
    let surfaces: HotspotSurfaces | undefined
    let house: Engine['house']
    let seenHouse: Engine['house']
    let moving = false
    let timer = 0
    let width = container.clientWidth
    let height = container.clientHeight
    const pos = new THREE.Vector3(Infinity)
    const rotation = new THREE.Quaternion()
    let fov = 0

    const scan = () => {
      if (!engine.house || !width || !height || isMoving()) return
      camera.clearViewOffset()
      camera.updateMatrixWorld()
      if (house !== engine.house) {
        house = engine.house
        surfaces = new HotspotSurfaces(engine)
      }
      anchors.current = surfaces!.scan(camera, house.plan.zones, width, height)
      for (const [i, anchor] of anchors.current.entries()) {
        const button = buttons.current[i]!
        button.style.transform = `translate3d(${anchor.x}px, ${anchor.y}px, 0)`
        button.style.opacity = String(anchor.opacity)
        button.setAttribute('aria-label', label(anchor))
        button.title = label(anchor)
        button.hidden = false
      }
    }

    const refresh = () => {
      window.clearTimeout(timer)
      if (anchors.current.length) {
        for (const button of buttons.current) if (button) button.hidden = true
        anchors.current = []
      }
      if (selected.current !== null) {
        selected.current = null
        setOpen(null)
      }
      if (!moving) timer = window.setTimeout(scan, 180)
    }

    const update = () => {
      const nowMoving = isMoving()
      if (seenHouse === engine.house && moving === nowMoving && pos.distanceToSquared(camera.position) < 0.000001 &&
          Math.abs(rotation.dot(camera.quaternion)) > 0.99999995 && Math.abs(fov - camera.fov) < 0.015) return
      moving = nowMoving
      seenHouse = engine.house
      pos.copy(camera.position)
      rotation.copy(camera.quaternion)
      fov = camera.fov
      refresh()
    }
    const resize = new ResizeObserver(() => {
      width = container.clientWidth
      height = container.clientHeight
      refresh()
    })
    resize.observe(container)
    const unsubscribe = engine.addHook(update)
    update()
    return () => {
      resize.disconnect()
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [engine, isMoving])

  useEffect(() => {
    if (open !== null) picker.current?.focus({ preventScroll: true })
  }, [open])

  const choose = (i: number | null, restoreFocus = false) => {
    if (restoreFocus && selected.current !== null) buttons.current[selected.current]?.focus({ preventScroll: true })
    selected.current = i
    setOpen(i)
  }
  const anchor = open === null ? undefined : anchors.current[open]
  const width = layer.current?.clientWidth ?? 0
  const height = layer.current?.clientHeight ?? 0
  const pickerWidth = Math.min(265, width - 24)
  const option = anchor && ZONES[anchor.zone].options.find(option => option.id === finishes[anchor.zone])
  return (
    <div className="hotspot-layer" ref={layer}>
      {Array.from({ length: MAX_HOTSPOTS }, (_, i) => (
        <button key={i} ref={node => { buttons.current[i] = node }} type="button" className="hotspot-pin"
          hidden aria-expanded={open === i} onClick={() => choose(open === i ? null : i)}><span aria-hidden="true">+</span></button>
      ))}
      {anchor && (
        <div className="hotspot-picker glass" role="dialog" aria-label={label(anchor)} tabIndex={-1} ref={picker}
          style={{
            width: pickerWidth,
            left: THREE.MathUtils.clamp(anchor.x - pickerWidth / 2, 12, width - pickerWidth - 12),
            ...(anchor.y > height / 2 ? { bottom: height - anchor.y + 24 } : { top: anchor.y + 24 }),
          }}
          onKeyDown={e => { if (e.key === 'Escape') choose(null, true) }}>
          <div className="hotspot-heading">
            <div><h2>{label(anchor)}</h2><p>{option?.name}</p></div>
            <button type="button" className="icon-btn" aria-label="Close finish picker" onClick={() => choose(null, true)}><Icon.close /></button>
          </div>
          <ZoneSwatches id={anchor.zone} onFinish={onFinish} compact />
          <button type="button" className="hotspot-customize" onClick={() => onCustomize(anchor.zone)}>Open Customize <Icon.diagonal /></button>
        </div>
      )}
    </div>
  )
}
