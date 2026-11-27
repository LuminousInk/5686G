import * as THREE from 'three'
import manifest from '../../../public/assets/art/manifest.json'
import type { MaterialLibrary } from '../materials/library'
import { decor, Piece } from './modern'

type Artwork = keyof typeof manifest

const LANDSCAPES: Artwork[] = ['tuscany', 'trysts', 'marsh', 'wheat', 'mist', 'deauville']
const COASTAL: Artwork[] = ['sainte-adresse', 'marseille', 'deauville', 'southampton', 'imagiri', 'mist']
const SMALL_PRINTS: Artwork[] = ['poppies', 'flower-clouds', 'imagiri', 'southampton']

/** One material and one decoded texture per print, shared across all levels of a home. */
export class RoomArt {
  private prints = new Map<Artwork, THREE.MeshStandardMaterial>()
  private pending: Promise<void>[] = []
  private disposed = false

  frame(lib: MaterialLibrary, plan: string, seed: number, w: number, h: number, small: boolean) {
    const coastal = plan === 'coastal-modern'
    const selection = small ? SMALL_PRINTS : coastal ? COASTAL : LANDSCAPES
    const id = selection[Math.abs(seed) % selection.length]
    const aspect = manifest[id].width / manifest[id].height
    const margin = Math.min(w, h) * 0.085
    // Preserve the original image aspect ratio and size the frame around its mat.
    const printW = Math.min(w - 2 * margin, (h - 2 * margin) * aspect)
    const printH = printW / aspect
    const p = new Piece()
    p.slab(coastal || seed % 3 === 0 ? lib.blackMetal : lib.cabinet, printW + 2 * margin, printH + 2 * margin, 0.024, 0, 0, 0)
    p.slab(lib.artMat, printW + 2 * margin - 0.025, printH + 2 * margin - 0.025, 0.002, 0, 0, 0.013)
    const frame = decor(p.build('framed-art'))
    const print = new THREE.Mesh(new THREE.PlaneGeometry(printW, printH), this.material(id))
    print.position.z = 0.015
    frame.add(print)
    return frame
  }

  ready() {
    return Promise.all(this.pending)
  }

  private material(id: Artwork) {
    const cached = this.prints.get(id)
    if (cached) return cached
    const material = new THREE.MeshStandardMaterial({
      color: '#efe8dc', roughness: 0.89, emissive: '#ffffff', emissiveIntensity: 0.22,
    })
    const load = async () => {
      const url = `${import.meta.env.BASE_URL}assets/art/${id}.webp`
      const texture = await new THREE.TextureLoader().loadAsync(url).catch(() => fallbackPrint(id))
      if (this.disposed) {
        texture.dispose()
        return
      }
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      material.map = material.emissiveMap = texture
      material.needsUpdate = true
    }
    if (typeof Image === 'undefined') {
      material.map = material.emissiveMap = fallbackPrint(id)
    } else {
      this.pending.push(load())
    }
    this.prints.set(id, material)
    return material
  }

  dispose() {
    this.disposed = true
    for (const material of this.prints.values()) {
      material.map?.dispose()
      material.dispose()
    }
    this.prints.clear()
  }
}

/** Muted cut-paper hills keep a print readable if its bundled image fails to load. */
function fallbackPrint(id: Artwork) {
  const { width, height } = manifest[id]
  const w = Math.max(1, Math.round(width / 4))
  const h = Math.max(1, Math.round(height / 4))
  const pixels = new Uint8Array(w * h * 4)
  const colors = [[94, 99, 83], [156, 127, 99], [181, 159, 126], [213, 193, 165], [226, 215, 190]]
  const phase = id.length * 0.3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      const ridge = colors.findIndex((_, i) => v < (i + 1) * 0.19 + Math.sin(u * (5 + i) + phase * (1 + i)) * 0.06)
      const grain = ((x * 13 ^ y * 31) % 7) - 3
      const [r, g, b] = colors[ridge < 0 ? colors.length - 1 : ridge]
      pixels.set([r + grain, g + grain, b + grain, 255], (y * w + x) * 4)
    }
  }
  const texture = new THREE.DataTexture(pixels, w, h)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}
