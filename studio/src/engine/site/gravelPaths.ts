import * as THREE from 'three'
import type { LandscapeSpec } from '../house/types'
import type { MaterialLibrary } from '../materials/library'
import { surface, type Hillside } from './hillside'

export function buildGravelPaths(paths: NonNullable<LandscapeSpec['paths']>, hill: Hillside, lib: MaterialLibrary) {
  const scan = lib.pebbles
  const material = new THREE.MeshStandardMaterial({
    color: '#b6a58a', vertexColors: true, roughness: 0.96, normalMap: scan.normalMap, normalScale: new THREE.Vector2(0.48, 0.48),
  })
  material.onBeforeCompile = shader => {
    shader.uniforms.gravel = { value: scan.map }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGravel;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGravel = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D gravel; varying vec2 vGravel;')
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        vec3 grain = texture2D(gravel, vGravel).rgb;
        diffuseColor.rgb *= 0.62 + dot(grain, vec3(0.7, 1.0, 0.3));
      `)
  }
  material.customProgramCacheKey = () => 'decomposed-granite'
  const positions: number[] = []
  const colors: number[] = []
  const uv: number[] = []
  const triangles: number[] = []
  for (const path of paths) {
    const points = path.pts.map(([x, z]) => new THREE.Vector2(x, z))
      .filter((p, i, all) => !i || p.distanceToSquared(all[i - 1]) > 0.0001)
    const offsets = points.map((p, i) => {
      const incoming = p.clone().sub(points[Math.max(i - 1, 0)]).normalize()
      const outgoing = points[Math.min(i + 1, points.length - 1)].clone().sub(p).normalize()
      const tangent = incoming.add(outgoing).normalize()
      return new THREE.Vector2(-tangent.y, tangent.x)
        .multiplyScalar(path.width * 0.5 / Math.max(0.7, tangent.dot(outgoing)))
    })
    let previous: number | undefined
    for (let i = 1; i < points.length; i++) {
      const steps = Math.ceil(points[i - 1].distanceTo(points[i]) * 6)
      for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
        const t = j / steps
        const center = points[i - 1].clone().lerp(points[i], t)
        const width = offsets[i - 1].clone().lerp(offsets[i], t)
        const row = positions.length / 3
        for (const side of [-1, -0.83, 0.83, 1]) {
          const [x, z] = center.clone().addScaledVector(width, side)
          const edge = Math.abs(side) > 0.9
          // The thin compacted course is raised at the center and feathered into the surrounding soil.
          positions.push(x, hill.heightAt(x, z) + (edge ? 0.017 : 0.043), z)
          uv.push(x * 4.8, z * 4.8)
          const tone = edge ? 0.56 : 0.88 + 0.1 * Math.cos(x * 1.9 + z * 0.42)
          colors.push(tone, tone, tone)
        }
        if (previous !== undefined) {
          for (let k = 0; k < 3; k++) {
            const a = previous + k
            const b = row + k
            triangles.push(a, a + 1, b + 1, a, b + 1, b)
          }
        }
        previous = row
      }
    }
  }
  const mesh = surface(positions, uv, triangles, material, 'Decomposed granite paths')
  mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return mesh
}
