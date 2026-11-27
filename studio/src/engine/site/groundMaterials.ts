import * as THREE from 'three'
import type { Rect } from '../house/types'
import type { Hillside } from './hillside'
import { coastalHaze, type CoastalSky } from './ocean'

const scans = {
  grass: 'withered_grass',
  soil: 'forest_ground_04',
  gravel: 'gravelly_sand',
  rock: 'coast_sand_rocks_02',
  bark: 'wood_chip_path',
  lawn: 'Grass001',
}

type Scan = { color: THREE.Texture; normal: THREE.Texture }
export type CoastalMaps = Record<keyof typeof scans, Scan>

export async function loadCoastalMaps(low: boolean): Promise<CoastalMaps> {
  const loader = new THREE.TextureLoader()
  const res = low ? '512' : '1k'
  const load = async (id: string, suffix: string) => {
    const map = await loader.loadAsync(`./assets/tex/${id}_${res}_${suffix}.webp`)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.colorSpace = suffix === 'd' ? THREE.SRGBColorSpace : THREE.NoColorSpace
    map.anisotropy = low ? 2 : 4
    return map
  }
  const entries = await Promise.all(Object.entries(scans).map(async ([kind, id]) => {
    const [color, normal] = await Promise.all([load(id, 'd'), load(id, kind === 'soil' ? 'n' : 'nr')])
    return [kind, { color, normal }]
  }))
  return Object.fromEntries(entries) as CoastalMaps
}

export function disposeCoastalMaps(maps: CoastalMaps | null) {
  if (!maps) return
  const textures = new Set(Object.values(maps).flatMap(scan => Object.values(scan)))
  textures.forEach(texture => texture.dispose())
}

export function scanMaterial(scan: Scan, color: THREE.ColorRepresentation, strength: number) {
  const material = new THREE.MeshStandardMaterial({
    color, map: scan.color, normalMap: scan.normal, roughnessMap: scan.normal,
    roughness: 1, normalScale: new THREE.Vector2(strength, strength),
  })
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
      'float roughnessFactor = max(0.64, texture2D(roughnessMap, vRoughnessMapUv).a);')
  }
  material.customProgramCacheKey = () => 'coast-packed-roughness'
  return material
}

const noise = /* glsl */`
  float groundHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1099, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float groundNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f *= f * (3.0 - 2.0 * f);
    return mix(mix(groundHash(i), groundHash(i + vec2(1, 0)), f.x),
      mix(groundHash(i + vec2(0, 1)), groundHash(i + vec2(1)), f.x), f.y);
  }
`

export function canyonMaterial(hill: Hillside, sky: CoastalSky, maps: CoastalMaps, lawn: Rect | undefined, low: boolean) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 })
  material.onBeforeCompile = shader => {
    shader.uniforms.coastSeaLevel = { value: hill.oceanDistance === undefined ? -1e5 : hill.seaLevel }
    shader.uniforms.lawnBounds = { value: new THREE.Vector4(...(lawn ?? [1e5, 1e5, -1e5, -1e5])) }
    shader.uniforms.groundOrigin = { value: new THREE.Vector2(hill.cx, hill.cz) }
    shader.uniforms.groundBearing = { value: new THREE.Vector2(hill.dx, hill.dz) }
    for (const kind of Object.keys(scans) as (keyof CoastalMaps)[]) {
      shader.uniforms[`${kind}Color`] = { value: maps[kind].color }
      shader.uniforms[`${kind}Detail`] = { value: maps[kind].normal }
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 groundCover; attribute float curvature; varying vec4 vGroundCover; varying vec3 vGroundNormal; varying float vCurvature;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGroundCover = groundCover; vGroundNormal = normal; vCurvature = curvature;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec4 vGroundCover;
        varying vec3 vGroundNormal;
        varying float vCurvature;
        uniform float coastSeaLevel;
        uniform vec4 lawnBounds;
        uniform vec2 groundOrigin, groundBearing;
        uniform sampler2D grassColor, soilColor, gravelColor, rockColor, barkColor, lawnColor;
        uniform sampler2D grassDetail, soilDetail, gravelDetail, rockDetail, barkDetail, lawnDetail;
        ${noise}
      `)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        if (vCoastalWorld.y < coastSeaLevel - 0.025) discard;
        vec2 p = vCoastalWorld.xz;
        float range = distance(vCoastalWorld, cameraPosition);
        float slope = 1.0 - normalize(vGroundNormal).y;
        float broad = groundNoise(p * 0.045);
        float spread = groundNoise(p * 0.17 + broad * 3.0);
        float mottling = groundNoise(p * 0.83);
        float highGround = smoothstep(0.5, 34.0, vCoastalWorld.y);
        float scrub = smoothstep(0.30, 0.72, vGroundCover.z * 0.77 + spread * 0.25 + mottling * 0.17);
        float brushDensity = smoothstep(0.26, 0.69, vGroundCover.z * 0.65 + broad * 0.24 + spread * 0.38);
        float concave = max(0.0, vCurvature);
        float convex = max(0.0, -vCurvature);
        float ridge = smoothstep(0.045, 0.29, slope + 0.08 * broad + 0.13 * vGroundCover.w + convex * 0.17);
        float stone = ridge * smoothstep(0.33, 0.73, spread * 0.58 + mottling * 0.24 + highGround * 0.17 + vGroundCover.w * 0.3);
        float edgeNoise = (mottling - 0.5) * 0.28;
        float barkWeight = smoothstep(0.19, 0.78, vGroundCover.x + edgeNoise);
        float gravelWeight = max(vGroundCover.y, smoothstep(0.48, 0.81, vGroundCover.w + spread * 0.26 + concave * 0.51) * (1.0 - stone) * 0.61);
        float hills = (1.0 - barkWeight) * (1.0 - gravelWeight);
        float wGrass = hills * (1.0 - stone) * (1.0 - scrub);
        float wSoil = hills * (1.0 - stone) * scrub;
        float wRock = hills * stone;
        float wGravel = gravelWeight * (1.0 - barkWeight);
        // Warped world coordinates break alignment of the scan's repeats across the lot.
        vec2 warp = vec2(groundNoise(p * 0.11), groundNoise(p * 0.14 + 31.0)) - 0.5;
        vec2 ground = p + warp * 1.32;
        vec2 grassUV = ground * 0.65;
        vec2 soilUV = vec2(ground.x - ground.y, ground.x + ground.y) * 0.56;
        vec2 rockUV = ground * 0.24 + vCoastalWorld.y * vec2(0.04, 0.18);
        vec2 gravelUV = ground * 2.7;
        vec2 barkUV = ground * 1.02;
        vec2 lawnUV = ground * 0.94;
        vec2 local = p - groundOrigin;
        local = vec2(dot(local, vec2(groundBearing.y, -groundBearing.x)), dot(local, groundBearing));
        vec2 turfEdge = min(local - lawnBounds.xy, lawnBounds.zw - local);
        float lawnWeight = smoothstep(0.01, 0.13, min(turfEdge.x, turfEdge.y) + edgeNoise * 0.72);
        vec2 uvDx = dFdx(ground), uvDy = dFdy(ground);
        vec2 rockDx = dFdx(rockUV), rockDy = dFdy(rockUV);
        vec3 dry = vec3(0.33, 0.265, 0.159);
        vec3 soil = vec3(0.15, 0.145, 0.079);
        vec3 rock = vec3(0.22, 0.18, 0.121);
        vec3 gravel = vec3(0.40, 0.29, 0.17);
        vec3 bark = vec3(0.148, 0.102, 0.062);
        vec3 lawnSample = vec3(0.14, 0.22, 0.087);
        // Past this range the scan texels are subpixel. Keep the nonrepeating mounds and
        // drainage masks there, while walking views get the full material scans.
        float scanned = 1.0 - smoothstep(70.0, 140.0, range);
        if (scanned > 0.0) {
          vec2 soilDx = vec2(uvDx.x - uvDx.y, uvDx.x + uvDx.y) * 0.56;
          vec2 soilDy = vec2(uvDy.x - uvDy.y, uvDy.x + uvDy.y) * 0.56;
          if (wGrass > 0.008) dry = mix(dry, textureGrad(grassColor, grassUV, uvDx * 0.65, uvDy * 0.65).rgb * vec3(1.13, 1.09, 0.93), scanned);
          if (wSoil > 0.008) soil = mix(soil, textureGrad(soilColor, soilUV, soilDx, soilDy).rgb * vec3(0.83, 1.07, 0.78), scanned);
          if (wRock > 0.008) rock = mix(rock, textureGrad(rockColor, rockUV, rockDx, rockDy).rgb * vec3(2.42, 2.08, 2.04), scanned);
          if (wGravel > 0.008) gravel = mix(gravel, textureGrad(gravelColor, gravelUV, uvDx * 2.7, uvDy * 2.7).rgb * vec3(1.40, 1.38, 1.37), scanned);
          if (barkWeight > 0.008) bark = mix(bark, textureGrad(barkColor, barkUV, uvDx * 1.02, uvDy * 1.02).rgb * vec3(0.72, 0.83, 1.10), scanned);
          if (lawnWeight > 0.008) lawnSample = mix(lawnSample, textureGrad(lawnColor, lawnUV, uvDx * 0.94, uvDy * 0.94).rgb, scanned);
        }
        float crowns = groundNoise(p * 0.40 + warp) * 0.66 + groundNoise(p * 1.47) * 0.34;
        float shrubMounds = smoothstep(0.45, 0.68, crowns + brushDensity * 0.17) * brushDensity;
        vec3 sage = mix(vec3(0.097, 0.11, 0.065), vec3(0.17, 0.18, 0.108), mottling);
        float wet = 1.0 - smoothstep(0.10, 0.9, vCoastalWorld.y - coastSeaLevel);
        vec3 groundColor = dry * wGrass + soil * wSoil + rock * wRock +
          gravel * wGravel * (1.0 - wet * vGroundCover.y * 0.36) + bark * barkWeight;
        groundColor *= mix(0.72, 1.15, broad * 0.47 + spread * 0.53);
        float wild = smoothstep(3.0, 26.0, range) * hills * (1.0 - stone);
        groundColor = mix(groundColor, sage, shrubMounds * wild * 0.82);
        // Keep the broad drainage and hillside hues legible when the scans reach their last mip.
        groundColor = mix(groundColor, vColor.rgb, smoothstep(44.0, 200.0, range) * hills * 0.43);
        // Fine grit has contrast close up, while the scans and broad cover carry the hills.
        if (range < 16.0) {
          float specks = (groundNoise(p * 27.0) - 0.5) * (1.0 - smoothstep(5.0, 16.0, range));
          groundColor *= 1.0 + specks * 0.22;
        }
        diffuseColor.rgb = mix(groundColor, lawnSample * (0.79 + 0.30 * mottling), lawnWeight);
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.96;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        float detailFade = 1.0 - smoothstep(${low ? '11.0, 30.0' : '19.0, 52.0'}, range);
        if (detailFade > 0.0) {
          vec4 detail = vec4(0.5, 0.5, 1.0, 0.96);
          ${low ? /* glsl */`
            float strongest = max(max(wGrass, wSoil), max(max(wRock, wGravel), barkWeight));
            if (strongest == wGrass) detail = textureGrad(grassDetail, grassUV, uvDx * 0.65, uvDy * 0.65);
            else if (strongest == wRock) detail = textureGrad(rockDetail, rockUV, rockDx, rockDy);
            else if (strongest == wGravel) detail = textureGrad(gravelDetail, gravelUV, uvDx * 2.7, uvDy * 2.7);
            else if (strongest == barkWeight) detail = textureGrad(barkDetail, barkUV, uvDx * 1.02, uvDy * 1.02);
            else detail = vec4(textureGrad(soilDetail, ground * 0.78, uvDx * 0.78, uvDy * 0.78).rgb, 0.96);
            detail.rgb = mix(vec3(0.5, 0.5, 1.0), detail.rgb, smoothstep(0.32, 0.72, strongest));
          ` : /* glsl */`
            detail = textureGrad(grassDetail, grassUV, uvDx * 0.65, uvDy * 0.65) * wGrass +
              textureGrad(rockDetail, rockUV, rockDx, rockDy) * wRock +
              textureGrad(gravelDetail, gravelUV, uvDx * 2.7, uvDy * 2.7) * wGravel +
              textureGrad(barkDetail, barkUV, uvDx * 1.02, uvDy * 1.02) * barkWeight +
              vec4(textureGrad(soilDetail, ground * 0.78, uvDx * 0.78, uvDy * 0.78).rgb, 0.96) * wSoil;
          `}
          if (lawnWeight > 0.008) detail = mix(detail,
            textureGrad(lawnDetail, lawnUV, uvDx * 0.94, uvDy * 0.94), lawnWeight);
          vec2 bump = (detail.rg * 2.0 - 1.0) * detailFade * 0.84;
          vec3 oriented = mat3(viewMatrix) * vec3(bump.x, 0.0, bump.y);
          normal = normalize(normal + oriented - normal * dot(normal, oriented));
          roughnessFactor = mix(roughnessFactor, max(0.66, detail.a), detailFade);
        }
      `)
  }
  return coastalHaze(material, sky, low ? 'coastal-splat-low' : 'coastal-splat')
}
