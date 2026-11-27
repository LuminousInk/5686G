import * as THREE from 'three'
import { V3 } from './geo'
import { vanityVessel } from './interior/bathParts'
import { domeShade, kitchenPendant, ovalTub, plumbingArc } from './interior/catalogFixtures'
import { INTERIOR_STYLES } from './interior/catalogStyle'
import { barStool, bookStack, diningChair, diningTable, floorLamp, linenBench, nightstand, Piece, platformBed, sideboard, tableLamp } from './interior/modern'
import type { MaterialLibrary } from './materials/library'
import { rng } from './materials/textures'

type Library = MaterialLibrary
type Point = [number, number, number]

function upholstered(lib: Library, width: number, depth: number, finish: THREE.Material, seats: number, chaise = false) {
  const p = new Piece()
  const arm = seats === 1 ? 0.095 : 0.18
  const loungeWidth = chaise ? width * 0.31 : 0
  const front = depth / 2
  const back = -front
  const seatFront = front - (chaise ? 0.73 : 0)
  const seatDepth = seatFront - back - 0.2
  const seatWidth = (width - arm * 2) / seats
  const base = lib.darkWood
  const footX = width / 2 - 0.125
  for (const x of [-footX, footX]) {
    const z = x > 0 && chaise ? front : seatFront
    for (const footZ of [back + 0.125, z - 0.115])
      p.cylinder(base, 0.027, 0.021, 0.105, x, 0.0525, footZ, false, 10)
  }
  p.box(finish, width, 0.22, seatFront - back, 0, 0.212, (back + seatFront) / 2, 0.052, 1)
  if (chaise)
    p.box(finish, loungeWidth, 0.22, front - seatFront + 0.15, (width - loungeWidth) / 2, 0.212, (front + seatFront - 0.15) / 2, 0.052, 1)
  p.box(finish, width - 0.10, 0.47, 0.17, 0, 0.476, back + 0.085, 0.055, 1)
  for (const x of [-width / 2 + arm / 2, width / 2 - arm / 2])
    p.box(finish, arm, 0.35, seatFront - back, x, 0.40, (back + seatFront) / 2, 0.039, 1)
  for (let i = 0; i < seats; i++) {
    const x = -width / 2 + arm + (i + 0.5) * seatWidth
    const extension = chaise && i === seats - 1 ? front - seatFront : 0
    p.box(finish, seatWidth - 0.012, 0.133, seatDepth + extension, x, 0.393, back + 0.20 + (seatDepth + extension) / 2, 0.054, 1)
    p.box(finish, seatWidth - 0.013, 0.364, 0.174, x, 0.616, back + 0.185, 0.074, 1)
  }
  return p.build('upholstery')
}

function loungeChair(lib: Library, upholsteredSeat: THREE.Material) {
  const p = new Piece()
  for (const x of [-0.35, 0.35]) {
    for (const z of [-0.29, 0.26])
      p.leg(lib.darkWood, V3(x, 0.44, z), V3(x * 1.06, 0.016, z * 1.16), 0.033)
    p.box(lib.darkWood, 0.043, 0.041, 0.58, x, 0.56, -0.06, 0.013, 1)
    p.slab(lib.darkWood, 0.035, 0.048, 0.63, x, 0.34, -0.005)
  }
  p.box(upholsteredSeat, 0.69, 0.13, 0.64, 0, 0.402, 0.01, 0.054, 1)
  p.tiltBack(upholsteredSeat, 0.65, 0.37, 0.126, V3(0, 0.431, -0.22), 0.21, 0.060)
  return p.build('lounge chair')
}

function darkHeadboardBed(lib: Library) {
  const group = platformBed(lib, 1.91, 2.05, 1.04)
  const headboard = new Piece()
  headboard.box(lib.darkWood, 2.025, 1.04, 0.092, 0, 0.52, -1.13, 0.028, 1)
  group.add(headboard.build('walnut headboard'))
  return group
}

function dresser(lib: Library) {
  const p = new Piece()
  p.slabFromBase(lib.darkWood, 0, 0, 0, 0.70, 0.067, 0.41)
  p.box(lib.cabinet, 0.78, 0.982, 0.46, 0, 0.558, 0, 0.008, 1)
  for (let i = 0; i < 4; i++) {
    const y = 0.19 + i * 0.238
    p.box(lib.darkWood, 0.765, 0.231, 0.025, 0, y, 0.234, 0.004, 1)
    p.box(lib.bronze, 0.111, 0.013, 0.016, 0, y + 0.055, 0.25, 0.004, 1)
  }
  return p.build('four-drawer chest')
}

function coffeeTable(lib: Library) {
  const p = new Piece()
  p.cylinder(lib.darkWood, 0.225, 0.245, 0.31, 0, 0.155, 0, false, 24)
  p.cylinder(lib.cabinet, 0.41, 0.415, 0.035, 0, 0.3275, 0, false, 40)
  return p.build('round pedestal table')
}

function lathe(profile: readonly [number, number][], segments = 24) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments)
}

function vessel(lib: Library, bowl: boolean) {
  const p = new Piece()
  if (bowl) {
    p.add(lib.darkWood, lathe([
      [0, 0], [0.066, 0], [0.091, 0.018], [0.12, 0.050], [0.122, 0.057],
      [0.114, 0.059], [0.104, 0.043], [0.071, 0.014], [0, 0.012],
    ], 28))
  } else {
    p.add(lib.ceramic, lathe([
      [0, 0], [0.048, 0], [0.066, 0.024], [0.073, 0.079], [0.057, 0.15],
      [0.035, 0.194], [0.035, 0.215], [0.029, 0.215], [0.028, 0.19], [0, 0.15],
    ]))
  }
  return p.build(bowl ? 'turned bowl' : 'ceramic vase')
}

function rod(p: Piece, mat: THREE.Material, from: Point, to: Point, radius: number, tip = radius) {
  const a = V3(...from), b = V3(...to)
  const axis = b.clone().sub(a)
  const geometry = new THREE.CylinderGeometry(tip, radius, axis.length(), 8)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), axis.normalize()))
  geometry.translate(...a.lerp(b, 0.5).toArray())
  p.add(mat, geometry)
}

function deskLamp(lib: Library) {
  const p = new Piece()
  const metal = lib.blackMetal
  p.cylinder(metal, 0.075, 0.08, 0.016, 0, 0.008, -0.06)
  rod(p, metal, [0, 0.016, -0.06], [0, 0.33, -0.092], 0.010)
  rod(p, metal, [0, 0.33, -0.092], [0, 0.37, 0.065], 0.010)
  p.cylinder(metal, 0.033, 0.092, 0.079, 0, 0.345, 0.077)
  p.cylinder(lib.diffuser, 0.084, 0.082, 0.006, 0, 0.307, 0.077)
  return p.build('task lamp')
}

function fridge(lib: Library) {
  const p = new Piece()
  const brushedSteel = lib.appliance.clone()
  brushedSteel.roughnessMap = null
  brushedSteel.roughness = 0.48
  brushedSteel.metalness = 0.65
  p.box(lib.blackMetal, 0.819, 1.80, 0.744, 0, 0.90, -0.025, 0.013, 1)
  for (const x of [-0.2075, 0.2075]) {
    p.box(brushedSteel, 0.407, 1.197, 0.033, x, 1.192, 0.36, 0.008, 1)
    p.box(lib.appliance, 0.020, 0.59, 0.026, Math.sign(x) * 0.052, 1.11, 0.388, 0.007, 1)
  }
  p.box(brushedSteel, 0.822, 0.539, 0.033, 0, 0.321, 0.36, 0.008, 1)
  p.box(lib.appliance, 0.69, 0.020, 0.026, 0, 0.535, 0.388, 0.007, 1)
  return p.build('French-door refrigerator')
}

function toilet(lib: Library) {
  const p = new Piece()
  const china = lib.porcelain
  p.box(china, 0.385, 0.734, 0.20, 0, 0.367, -0.24, 0.060, 1)
  p.cylinder(lib.appliance, 0.022, 0.022, 0.004, 0, 0.735, -0.24, false, 16)
  p.box(china, 0.229, 0.28, 0.37, 0, 0.14, 0.01, 0.047, 1)
  p.add(china, lathe([
    [0, 0.14], [0.55, 0.14], [0.75, 0.19], [0.96, 0.29], [1, 0.38], [0.99, 0.412],
    [0.83, 0.419], [0.77, 0.388], [0.62, 0.31], [0.40, 0.26], [0, 0.258],
  ], 32).scale(0.195, 1, 0.27).translate(0, 0, 0.073))
  p.add(china, lathe([
    [0.83, 0.416], [0.973, 0.417], [0.98, 0.431], [0.952, 0.439],
    [0.846, 0.439], [0.82, 0.428], [0.83, 0.416],
  ], 32).scale(0.195, 1, 0.27).translate(0, 0, 0.073))
  return p.build('ceramic toilet')
}

function shower(lib: Library) {
  const p = new Piece()
  const metal = lib.blackMetal
  rod(p, metal, [0, 0.06, 0], [0, 1.13, 0], 0.014)
  rod(p, metal, [0, 1.13, 0], [0, 1.13, 0.32], 0.014)
  p.cylinder(metal, 0.114, 0.114, 0.023, 0, 1.11, 0.30, false, 24)
  p.box(metal, 0.126, 0.12, 0.052, 0, 0.06, -0.015, 0.01, 1)
  p.box(metal, 0.105, 0.019, 0.032, 0, 0.052, 0.02, 0.005, 1)
  return p.build('rain shower fixture')
}

function officeDesk(lib: Library) {
  const p = new Piece()
  p.box(lib.cabinet, 1.36, 0.036, 0.61, 0, 0.742, 0, 0.005, 1)
  p.slabFromBase(lib.cabinet, -0.63, 0, 0, 0.036, 0.724, 0.60)
  p.slabFromBase(lib.cabinet, 0.48, 0, -0.01, 0.39, 0.724, 0.58)
  for (const y of [0.29, 0.49, 0.68]) {
    p.slab(lib.darkWood, 0.37, 0.003, 0.007, 0.48, y, 0.283)
    p.slab(lib.fixtureMetal, 0.16, 0.009, 0.018, 0.48, y - 0.032, 0.289)
  }
  return p.build('oak desk')
}

function builtInOven(lib: Library) {
  const p = new Piece()
  p.box(lib.blackMetal, 0.58, 0.596, 0.53, 0, 0.298, -0.015, 0.009, 1)
  p.box(lib.fixtureMetal, 0.576, 0.065, 0.03, 0, 0.557, 0.263, 0.005, 1)
  p.box(lib.tvGlass, 0.51, 0.40, 0.02, 0, 0.253, 0.264, 0.009, 1)
  p.box(lib.fixtureMetal, 0.47, 0.018, 0.03, 0, 0.459, 0.289, 0.007, 1)
  return p.build('built-in oven')
}

function frontLoader(lib: Library) {
  const p = new Piece()
  p.box(lib.porcelain, 0.65, 0.89, 0.60, 0, 0.445, 0, 0.02, 1)
  for (const [material, radius, z] of [[lib.appliance, 0.235, 0.304], [lib.tvGlass, 0.181, 0.32]] as const) {
    const disk = new THREE.CylinderGeometry(radius, radius, 0.025, 32)
    p.add(material, disk.rotateX(Math.PI / 2).translate(0, 0.435, z))
  }
  p.box(lib.blackMetal, 0.14, 0.034, 0.014, 0.168, 0.819, 0.3, 0.005, 1)
  return p.build('front-loading washer')
}

function linearPendant(lib: Library) {
  const p = new Piece()
  p.box(lib.cabinet, 1.38, 0.053, 0.066, 0, 0.029, 0, 0.012, 1)
  p.box(lib.diffuser, 1.31, 0.009, 0.039, 0, 0.004, 0, 0.003, 1)
  for (const x of [-0.11, 0.11]) p.cylinder(lib.blackMetal, 0.004, 0.004, 0.68, x, 0.37, 0, false, 8)
  p.box(lib.cabinet, 0.28, 0.026, 0.081, 0, 0.734, 0, 0.006, 1)
  return p.build('linear pendant')
}

function backedStool(lib: Library) {
  const p = new Piece()
  for (const x of [-0.15, 0.15]) {
    p.leg(lib.cabinet, V3(x, 0.61, -0.12), V3(1.16 * x, 0, -0.17), 0.03)
    p.leg(lib.cabinet, V3(x, 0.61, 0.12), V3(1.16 * x, 0, 0.17), 0.03)
  }
  p.box(lib.fixtureMetal, 0.36, 0.012, 0.019, 0, 0.25, 0.12, 0.004, 1)
  p.box(lib.fabric2, 0.39, 0.048, 0.40, 0, 0.626, 0, 0.017, 1)
  p.tiltBack(lib.fabric2, 0.37, 0.28, 0.04, V3(0, 0.65, -0.149), 0.15, 0.02)
  return p.build('upholstered counter stool')
}

function treadmill(lib: Library) {
  const p = new Piece()
  p.box(lib.blackMetal, 0.74, 0.12, 1.59, 0, 0.08, 0, 0.023, 1)
  p.box(lib.fabric2, 0.54, 0.022, 1.34, 0, 0.15, -0.03, 0.008, 1)
  for (const x of [-0.31, 0.31]) {
    rod(p, lib.appliance, [x, 0.12, 0.55], [x, 1.13, 0.45], 0.028)
    rod(p, lib.blackMetal, [x, 1.01, 0.54], [x, 1.01, 0.12], 0.021)
  }
  p.box(lib.blackMetal, 0.61, 0.14, 0.28, 0, 1.20, 0.48, 0.031, 1)
  p.box(lib.tvGlass, 0.28, 0.012, 0.13, 0, 1.275, 0.45, 0.006, 1)
  return p.build('treadmill')
}

function sofaCushion(lib: Library) {
  const p = new Piece()
  p.tiltBack(lib.oliveLinen, 0.36, 0.32, 0.19, V3(0, 0, 0), 0.20, 0.08)
  return p.build('linen pillow')
}

// Curved tapered surfaces keep clumps recognisable when each mesh is instanced as one plant by the site builder.
function blade(from: THREE.Vector3, to: THREE.Vector3, halfWidth: number, bend: number, segments: number) {
  const side = to.clone().sub(from).cross(V3(0, 1, 0)).normalize()
  const vertices: number[] = []
  const uv: number[] = []
  const indices: number[] = []
  for (let j = 0; j <= segments; j++) {
    const t = j / segments
    const mid = from.clone().lerp(to, t)
    mid.y += bend * Math.sin(Math.PI * t)
    const width = (0.03 + Math.sin(Math.PI * (0.15 + 0.85 * t))) * halfWidth
    for (const sign of [-1, 1]) {
      vertices.push(...mid.clone().addScaledVector(side, sign * width).toArray())
      uv.push((sign + 1) / 2, t)
    }
    if (j < segments) indices.push(2*j, 2*j+1, 2*j+2, 2*j+1, 2*j+3, 2*j+2)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

type PlantForm = 'potted' | 'broadleaf' | 'shrub' | 'fern' | 'grass'

function plant(lib: Library, form: PlantForm, seed: number) {
  const p = new Piece()
  const random = rng(seed)
  const foliage = lib.foliage
  if (form === 'grass') {
    for (let i = 0; i < 33; i++) {
      const a = random() * Math.PI * 2
      const spread = 0.14 + random() * 0.41
      const x = Math.cos(a), z = Math.sin(a)
      p.add(foliage, blade(V3(x * 0.035, 0, z * 0.035), V3(x * spread, 0.19 + random() * 0.39, z * spread), 0.014, 0.10, 5))
    }
    return p.build('ornamental grass')
  }
  const potted = form === 'potted' || form === 'broadleaf'
  const base = potted ? 0.29 : 0
  if (potted) {
    p.add(form === 'potted' ? lib.rustLinen : lib.ceramic, lathe([
      [0, 0], [0.122, 0], [0.176, 0.251], [0.181, 0.285], [0.168, 0.289], [0.159, 0.251], [0, 0.251],
    ]))
    p.cylinder(lib.foliageStem, 0.159, 0.159, 0.012, 0, 0.253, 0)
    rod(p, lib.foliageStem, [0, 0.253, 0], [0, 0.91, 0], 0.014, 0.005)
  }
  const count = potted ? 12 : 15
  for (let i = 0; i < count; i++) {
    const a = 2.399963 * i + seed
    const x = Math.cos(a), z = Math.sin(a)
    const fern = form === 'fern'
    const spread = (potted ? 0.20 : 0.39) + random() * 0.19
    const tipY = base + (potted ? 0.23 + 0.043 * i : (fern ? 0.12 : 0.29) + random() * 0.36)
    const from = V3(0, potted ? tipY - 0.22 : 0, 0)
    const tip = V3(x * spread, tipY, z * spread)
    if (potted) rod(p, lib.foliageStem, from.toArray(), tip.toArray(), 0.005, 0.002)
    const rows = fern ? 7 : 5
    for (let j = 1; j <= rows; j++) {
      const t = j / rows
      const mid = from.clone().lerp(tip, t)
      for (const sign of [-1, 1]) {
        const length = (form === 'broadleaf' ? 0.23 : 0.16) * (1.2 - t * 0.54)
        const end = mid.clone().add(V3((x - sign * z) * length, fern ? 0.03 : 0.04 + random() * 0.1, (z + sign * x) * length))
        p.add(foliage, blade(mid, end, length * (fern ? 0.17 : 0.27), 0.036, 4))
      }
    }
  }
  const group = p.build(form)
  if (form === 'potted') group.scale.set(0.72, 1, 0.72)
  return group
}

function rocks(lib: Library, seed: number, moss: boolean, count: number) {
  const group = new THREE.Group()
  const random = rng(seed)
  for (let i = 0; i < count; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1)
    const pos = g.getAttribute('position')
    const height = 0.22 + random() * 0.25
    const depth = 0.61 + random() * 0.33
    for (let j = 0; j < pos.count; j++) {
      const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j)
      const shape = 0.93 + 0.14 * Math.sin(x * 7 + z * 4 + i + seed) * Math.cos(y * 2 - z * 8)
      pos.setXYZ(j, x * shape, Math.max(-0.54, y * shape) * height, z * shape * depth)
    }
    g.computeVertexNormals()
    const rock = new THREE.Mesh(g, moss ? lib.moss : lib.foundation)
    g.computeBoundingBox()
    rock.position.set((i - (count - 1) / 2) * 2.1, -g.boundingBox!.min.y, 0)
    rock.castShadow = rock.receiveShadow = true
    group.add(rock)
  }
  return group
}

const designs = {
  SheenChair: lib => loungeChair(lib, lib.rustLinen),
  bar_stool_wood: barStool,
  bath_angelo: ovalTub,
  basin_mixer_dark: lib => plumbingArc(lib, 0.17, 0.14, lib.blackMetal),
  bed_dark_headboard: darkHeadboardBed,
  bed_oak_linen: lib => platformBed(lib, 1.81, 2.05, 1.03),
  bench_upholstered: lib => linenBench(lib, 1.27),
  ceramic_vase_02: lib => vessel(lib, false),
  book_encyclopedia_set_01: lib => bookStack(lib, lib.fabric2, lib.linen),
  coffee_table_round_01: coffeeTable,
  desk_lamp_black: deskLamp,
  desk_wood: officeDesk,
  dining_linear_pendant: linearPendant,
  dining_chair_bentwood: diningChair,
  dining_table_trestle: lib => diningTable(lib, 1.9, 0.92),
  dresser_tall: dresser,
  fern_02: lib => plant(lib, 'fern', 23),
  fridge_steel: fridge,
  floor_lamp_tripod: floorLamp,
  grass_medium_01: lib => plant(lib, 'grass', 35),
  kitchen_faucet: lib => plumbingArc(lib, 0.36, 0.23),
  media_console_oak: lib => sideboard(lib, 1.85),
  modern_arm_chair_01: lib => loungeChair(lib, lib.blackMetal),
  modern_ceiling_lamp_01: lib => kitchenPendant(lib, INTERIOR_STYLES.desert, 0.86),
  modern_wooden_cabinet: lib => sideboard(lib, 1.85),
  namaqualand_boulder_02: lib => rocks(lib, 23, false, 1),
  nightstand_oak: lib => nightstand(lib, 0.47, null),
  oven_built_in: builtInOven,
  pendant_dome: lib => domeShade(lib, INTERIOR_STYLES.woodland),
  potted_plant_01: lib => plant(lib, 'potted', 13),
  potted_plant_02: lib => plant(lib, 'broadleaf', 15),
  potted_plant_04: lib => plant(lib, 'broadleaf', 21),
  rock_07: lib => rocks(lib, 7, false, 1),
  rock_09: lib => rocks(lib, 9, false, 1),
  rock_moss_set_01: lib => rocks(lib, 41, true, 3),
  rock_moss_set_02: lib => rocks(lib, 19, true, 3),
  sectional_grey: lib => upholstered(lib, 3.12, 1.812, lib.fabric, 3, true),
  shower_black: shower,
  shrub_03: lib => plant(lib, 'shrub', 37),
  shrub_04: lib => plant(lib, 'shrub', 69),
  sideboard_midcentury: lib => sideboard(lib, 1.62),
  side_table_01: lib => nightstand(lib, 0.47, null),
  sofa_beige: lib => upholstered(lib, 3.385, 1.104, lib.linen, 3),
  sofa_linen: lib => upholstered(lib, 2.22, 0.87, lib.linen, 2),
  stool_counter_back: backedStool,
  stone_01: lib => rocks(lib, 1, false, 1),
  toilet_modern: toilet,
  treadmill_gym: treadmill,
  table_lamp_white: tableLamp,
  table_lamp_ceramic: tableLamp,
  throw_pillows_01: sofaCushion,
  vessel_sink_white: lib => {
    const group = new THREE.Group()
    group.add(vanityVessel(lib, 0.44, 0.32))
    return group
  },
  washer_front_load: frontLoader,
  wooden_bowl_01: lib => vessel(lib, true),
  wooden_table_02: lib => diningTable(lib, 1.75, 0.85),
} satisfies Record<string, (lib: Library) => THREE.Group>

const sources = new WeakMap<Library, Map<string, THREE.Group>>()

/** Keep the source facing convention so the regular placement code still controls sizing and orientation. */
export function standinModel(lib: Library, id: string, modelYaw: number): THREE.Group {
  let cache = sources.get(lib)
  if (!cache) sources.set(lib, cache = new Map())
  let source = cache.get(id)
  if (!source) {
    if (!Object.hasOwn(designs, id)) throw new Error(`No procedural stand-in for model "${id}"`)
    const design = designs[id as keyof typeof designs](lib)
    design.rotation.y = -modelYaw
    source = new THREE.Group()
    source.name = id
    source.add(design)
    cache.set(id, source)
  }
  return source
}
