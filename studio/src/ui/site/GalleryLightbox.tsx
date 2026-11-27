import { Button, Dialog, Modal, ModalOverlay } from 'react-aria-components/Modal'
import type { MouseEvent } from 'react'
import { Icon } from '../icons'
import type { GalleryImage } from '../galleryShots'
import { adjacentImage } from './galleryPresentation'
import { ZoomImage } from './ZoomImage'

export interface GalleryLightboxProps {
  visible: GalleryImage[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  onDesign: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function GalleryLightbox({ visible, index, onIndex, onClose, onDesign }: GalleryLightboxProps) {
  const shot = visible[index]
  const step = (direction: -1 | 1) => onIndex(adjacentImage(index, visible.length, direction))

  return (
    <ModalOverlay className="site-lightbox-overlay" isOpen onOpenChange={open => { if (!open) onClose() }}>
      <Modal className="site-lightbox">
        <Dialog aria-label="Render gallery" className="site-lightbox-dialog">
          <div className="site-lightbox-body" onKeyDown={event => {
            if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              step(event.key === 'ArrowLeft' ? -1 : 1)
            }
          }}>
            <div className="site-lightbox-bar">
              <p aria-label={`Image ${index + 1} of ${visible.length}`}>{index + 1} / {visible.length}</p>
              <Button className="site-square" aria-label="Close lightbox" onPress={onClose} autoFocus>
                <Icon.close />
              </Button>
            </div>
            <ZoomImage shot={shot} onStep={step} />
            <div className="site-lightbox-caption">
              <div aria-live="polite" aria-atomic="true">
                <p className="site-lightbox-home">{shot.home} <span>·</span> {shot.light}</p>
                <h2>{shot.space}</h2>
                <p>{shot.style}</p>
              </div>
              <div className="site-lightbox-actions">
                {visible.length > 1 && <div className="site-lightbox-arrows" role="group" aria-label="Browse images">
                  <Button className="site-square" aria-label="Previous render" onPress={() => step(-1)}><Icon.left /></Button>
                  <Button className="site-square" aria-label="Next render" onPress={() => step(1)}><Icon.right /></Button>
                </div>}
                <a className="site-cta" href={shot.share} onClick={event => {
                  onDesign(event)
                  if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose()
                }}>Open in 3D <Icon.diagonal /></a>
              </div>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
