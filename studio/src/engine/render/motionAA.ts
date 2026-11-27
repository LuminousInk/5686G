import * as THREE from 'three'

// The history target stores exposed HDR in RGB and view-space distance in alpha.
// Keeping distance in the existing half-float target avoids a separate depth history.
export const motionResolveFragment = /* glsl */ `
  uniform sampler2D tCurrent, tHistory;
  uniform highp sampler2D tDepth;
  uniform mat4 reproject;
  uniform vec2 texel;
  uniform vec2 clipPlanes;
  uniform float exposure, exposureRatio;
  uniform bool hasHistory;
  varying vec2 vUv;

  vec3 currentColor(vec2 uv) {
    return min(texture2D(tCurrent, uv).rgb * exposure, vec3(64.0));
  }

  void main() {
    vec3 color = currentColor(vUv);
    float depth = texture2D(tDepth, vUv).r;
    float near = clipPlanes.x, far = clipPlanes.y;
    float distance = near * far / mix(far, near, depth);
    if (hasHistory && depth < 1.0) {
      vec4 previous = reproject * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec2 uv = previous.xy / max(previous.w, 0.00001) * 0.5 + 0.5;
      if (previous.w > 0.0 && all(greaterThanEqual(uv, texel * 0.5))
          && all(lessThanEqual(uv, 1.0 - texel * 0.5))) {
        // Recover positive view-space distance from clip coordinates for the previous depth test.
        float previousDistance = previous.w * distance;
        float oldDistance = texelFetch(tHistory, ivec2(uv / texel), 0).a;
        if (oldDistance < far && abs(oldDistance - previousDistance) < max(0.025, previousDistance * 0.012)) {
          vec3 a = currentColor(vUv + vec2(texel.x, 0.0));
          vec3 b = currentColor(vUv - vec2(texel.x, 0.0));
          vec3 c = currentColor(vUv + vec2(0.0, texel.y));
          vec3 d = currentColor(vUv - vec2(0.0, texel.y));
          vec3 lo = min(color, min(min(a, b), min(c, d)));
          vec3 hi = max(color, max(max(a, b), max(c, d)));
          vec3 history = clamp(texture2D(tHistory, uv).rgb * exposureRatio, lo, hi);
          float travel = length((uv - vUv) / texel);
          color = mix(color, history, mix(0.64, 0.24, smoothstep(1.0, 16.0, travel)));
        }
      }
    }
    gl_FragColor = vec4(color, depth == 1.0 ? far : distance);
  }
`

/** Transforms the current jittered clip coordinates into the previous jittered clip space. */
export class MotionHistory {
  private previousViewProjection = new THREE.Matrix4()
  private previousExposure = 1
  private valid = false
  private sample = 0

  get hasHistory() { return this.valid }

  /** Halton 2,3 sequence, excluding the origin. */
  nextSample() {
    this.sample = this.sample % 8 + 1
    return this.sample
  }

  reset() {
    this.valid = false
    this.sample = 0
  }

  update(camera: THREE.PerspectiveCamera, exposure: number, reproject: THREE.Matrix4) {
    reproject.copy(this.previousViewProjection).multiply(camera.matrixWorld).multiply(camera.projectionMatrixInverse)
    this.previousViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const exposureRatio = exposure / this.previousExposure
    this.previousExposure = exposure
    this.valid = true
    return exposureRatio
  }
}
