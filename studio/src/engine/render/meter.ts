import * as THREE from 'three'

/**
 * Camera-style light metering. Reduces the linear HDR frame (before exposure) to a small grid of log luminance, reads
 * it back without stalling the GPU, and turns it into an exposure the way a camera's matrix metering does: a trimmed,
 * center-weighted average that should land a little above middle grey, capped so the brightest large surfaces (white
 * walls, lit ceilings) stay just under white. Windows and sun patches are trimmed off the top and may clip, as they do
 * in interior photography.
 */

const N = 32
// log2 luminance range stored in two 8-bit channels (16-bit precision)
const LO = -20
const SPAN = 32

export interface Metering {
  /** trimmed, center-weighted geometric mean luminance */
  mean: number
  /** luminance of the bright end of the frame (windows and sun patches excluded) */
  high: number
}

const vert = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }'
const frag = `
  uniform sampler2D tMap;
  varying vec2 vUv;
  const float LO = ${LO.toFixed(1)};
  const float SPAN = ${SPAN.toFixed(1)};
  void main(){
    // 4 x 4 taps over this cell's footprint, averaged in log space
    float acc = 0.0;
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
      vec3 c = texture2D(tMap, vUv + o / ${N.toFixed(1)}).rgb;
      float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
      acc += log2(l);
    }
    float v = clamp((acc / 16.0 - LO) / SPAN, 0.0, 1.0) * 255.0;
    float hi = floor(v);
    gl_FragColor = vec4(hi / 255.0, fract(v), 0.0, 1.0);
  }`

export class Meter {
  private rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.UnsignedByteType, depthBuffer: false })
  private mat = new THREE.ShaderMaterial({ uniforms: { tMap: { value: null } }, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false })
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private buf = new Uint8Array(N * N * 4)
  private weights: Float32Array
  private busy = false
  private failed = false
  /** latest reading (null until the first one arrives) */
  last: Metering | null = null
  /** bumped whenever a new reading arrives */
  serial = 0

  constructor() {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat)
    quad.frustumCulled = false
    this.scene.add(quad)
    // center-weighted: the middle of the frame counts about three times as much as the corners
    this.weights = new Float32Array(N * N)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N - 0.5
        const dy = (y + 0.5) / N - 0.5
        this.weights[y * N + x] = 1.2 - 1.6 * (dx * dx + dy * dy)
      }
  }

  get supported() {
    return !this.failed
  }

  /** Meter `tex` (linear HDR). Returns immediately; the reading lands in `last` a frame or two later. */
  measure(renderer: THREE.WebGLRenderer, tex: THREE.Texture) {
    if (this.busy || this.failed || !renderer.capabilities.isWebGL2) return
    const prev = renderer.getRenderTarget()
    this.mat.uniforms.tMap.value = tex
    renderer.setRenderTarget(this.rt)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(prev)
    this.busy = true
    renderer
      .readRenderTargetPixelsAsync(this.rt, 0, 0, N, N, this.buf)
      .then(() => {
        this.last = this.reduce()
        this.serial++
      })
      .catch(() => {
        this.failed = true
      })
      .finally(() => {
        this.busy = false
      })
  }

  private reduce(): Metering {
    const n = N * N
    const logs = new Float32Array(n)
    for (let i = 0; i < n; i++) logs[i] = LO + ((this.buf[i * 4] + this.buf[i * 4 + 1] / 255) / 255) * SPAN
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => logs[a] - logs[b])
    let total = 0
    for (let i = 0; i < n; i++) total += this.weights[i]
    // weighted percentiles
    const at = (p: number) => {
      let acc = 0
      for (const i of order) {
        acc += this.weights[i]
        if (acc >= p * total) return logs[i]
      }
      return logs[order[n - 1]]
    }
    const lo = at(0.04)
    const top = at(0.96)
    let sum = 0
    let w = 0
    for (let i = 0; i < n; i++) {
      if (logs[i] < lo || logs[i] > top) continue
      sum += logs[i] * this.weights[i]
      w += this.weights[i]
    }
    const mean = Math.pow(2, w > 0 ? sum / w : at(0.5))
    return { mean, high: Math.pow(2, at(0.88)) }
  }

  dispose() {
    this.rt.dispose()
    this.mat.dispose()
  }
}

/**
 * Exposure for a reading: the average goes to `key` (a bit above middle grey: interiors are photographed bright), but
 * never so far that the bright end passes `white`.
 */
export function exposureFor(m: Metering, key: number, white = 0.92) {
  return Math.min(key / m.mean, white / m.high)
}
