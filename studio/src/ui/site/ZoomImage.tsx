import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react'
import { Button } from 'react-aria-components/Button'
import type OpenSeadragon from 'openseadragon'
import { imageDimensions, swipeDirection } from './galleryPresentation'
import type { GalleryImage } from '../galleryShots'
import { useReducedMotion } from './siteMotion'
import { imageSrc } from './galleryCatalog'

export function ZoomImage({ shot, onStep }: { shot: GalleryImage; onStep: (direction: -1 | 1) => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const element = useRef<HTMLDivElement>(null)
  const viewer = useRef<OpenSeadragon.Viewer | null>(null)
  const touch = useRef<{ id: number; x: number; y: number } | null>(null)
  const [loaded, setLoaded] = useState<string>()
  const [failed, setFailed] = useState<string>()
  const reduced = useReducedMotion()
  const src = imageSrc(shot.id)
  const ready = loaded === src
  const unavailable = failed === src
  const alt = `${shot.home}, ${shot.space}`

  useEffect(() => {
    const host = element.current
    if (!host) return
    let active = true
    let instance: OpenSeadragon.Viewer | undefined
    touch.current = null
    setLoaded(undefined)
    setFailed(undefined)

    const fail = () => {
      if (active) setFailed(src)
    }
    import('openseadragon').then(({ default: OpenSeadragon }) => {
      if (!active) return
      instance = OpenSeadragon({
        element: host,
        drawer: ['canvas', 'html'],
        showNavigationControl: false,
        showSequenceControl: false,
        keyboardNavEnabled: false,
        tabIndex: -1,
        loadTilesWithAjax: false,
        animationTime: reduced ? 0 : .28,
        blendTime: 0,
        visibilityRatio: 1,
        minZoomImageRatio: 1,
        maxZoomPixelRatio: 2,
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
        gestureSettingsTouch: { flickEnabled: false, dblClickDragToZoom: false },
      })
      viewer.current = instance
      instance.addOnceHandler('tile-drawn', () => {
        if (active) setLoaded(src)
      })
      instance.addOnceHandler('open-failed', fail)
      instance.addHandler('canvas-drag', event => {
        const viewport = viewer.current?.viewport
        if (event.pointerType === 'touch' && viewport && viewport.getZoom() <= viewport.getHomeZoom() * 1.02) {
          event.preventDefaultAction = true
        }
      })
      instance.open({ tileSource: new OpenSeadragon.ImageTileSource({ url: src, buildPyramid: false }) })
    }).catch(fail)

    return () => {
      active = false
      viewer.current = null
      if (host.contains(document.activeElement)) stage.current?.focus({ preventScroll: true })
      instance?.destroy()
    }
  }, [reduced, src])

  const startSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const viewport = viewer.current?.viewport
    const finger = event.touches[0]
    touch.current = event.touches.length === 1 && viewport && viewport.getZoom() <= viewport.getHomeZoom() * 1.02
      ? { id: finger.identifier, x: finger.clientX, y: finger.clientY }
      : null
  }

  const endSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const start = touch.current
    touch.current = null
    if (!start || event.touches.length) return
    const finger = Array.from(event.changedTouches).find(point => point.identifier === start.id)
    if (!finger) return
    const direction = swipeDirection(start, { x: finger.clientX, y: finger.clientY })
    if (direction) {
      event.currentTarget.focus({ preventScroll: true })
      onStep(direction)
    }
  }

  const zoom = (factor: number) => {
    if (!ready) return
    const viewport = viewer.current?.viewport
    viewport?.zoomBy(factor, undefined, reduced).applyConstraints(reduced)
  }

  const panWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = { ArrowLeft: [-44, 0], ArrowRight: [44, 0], ArrowUp: [0, -44], ArrowDown: [0, 44] }[event.key]
    if (!event.shiftKey || !direction || !ready) return
    const viewport = viewer.current?.viewport
    if (!viewport) return
    event.preventDefault()
    const pixels = viewport.getContainerSize().clone()
    pixels.x = direction[0]
    pixels.y = direction[1]
    const delta = viewport.deltaPointsFromPixels(pixels)
    viewport.panBy(delta, reduced).applyConstraints(reduced)
  }

  return (
    <div className="site-lightbox-stage">
      <div
        ref={stage}
        className="site-lightbox-image"
        role="group"
        aria-label={ready ? `${alt}. Use Shift and the arrow keys to pan a zoomed image.` : alt}
        tabIndex={ready ? 0 : -1}
        onKeyDown={panWithKeys}
        onTouchStartCapture={startSwipe}
        onTouchEndCapture={endSwipe}
        onTouchCancel={() => { touch.current = null }}
      >
        <div ref={element} className="site-zoom-canvas" aria-hidden="true" hidden={unavailable} />
        {unavailable && <img src={src} {...imageDimensions(shot)} alt={alt} />}
        {!ready && !unavailable && <span className="site-image-message" role="status">Loading render…</span>}
      </div>
      {!unavailable && <div className="site-zoom-tools" role="group" aria-label="Image zoom">
        <Button className="site-square" aria-label="Zoom out" aria-disabled={!ready} onPress={() => zoom(1 / 1.5)}>−</Button>
        <Button className="site-square site-fit" aria-label="Fit image" aria-disabled={!ready} onPress={() => {
          if (ready) viewer.current?.viewport.goHome(reduced)
        }}>Fit</Button>
        <Button className="site-square" aria-label="Zoom in" aria-disabled={!ready} onPress={() => zoom(1.5)}>+</Button>
      </div>}
    </div>
  )
}
