import { framePoint } from '../engine/house/levels'
import type { Block, HomePlan, InteriorWall, Opening, Rect, RoomDef, RoomType, Side } from '../engine/house/types'

const ft = (feet: number, inches = 0) => (feet + inches / 12) * 0.3048
const floorY = ft(1)
const drop = ft(9, 2)

// Trace A101 with the west/arrival façade at the top, then rotate the sheet into world coordinates below.
// Register A102 on the two stairs and set out the primary grid from the dimension strings on both sheets.
const scale = ft(111, 4) / (1447 - 461)
const x = (u: number) => (u - 820) * scale
const z = (v: number) => (560 - v) * scale
const rect = (left: number, top: number, right: number, bottom: number): Rect => [x(left), z(bottom), x(right), z(top)]
const main = 'main'
const lower = 'lower'
const aduFrame = 'adu'
const metal = { zone: 'panel', kind: 'panel' } as const
// The warm, vertically seamed flexible-stone facing uses the existing wood-look finish material.
const warm = { zone: 'cedar', kind: 'boards' } as const

const west = rect(461, 295, 646, 656)
const great = rect(646, 295, 990, 568)
const foyer = rect(726, 208, 990, 295)
const east = rect(990, 382, 1176, 743)
const garage = rect(999, 189, 1447, 382)
const deck = [great[0], great[1] - ft(30, 6), great[0] + ft(38, 9), great[1]] satisfies Rect

const lowerWest = rect(374, 557, 647, 743)
lowerWest[2] = lowerWest[0] + ft(30, 10)
lowerWest[1] = lowerWest[3] - ft(21)
const lowerEast: Rect = [
  lowerWest[2] + ft(13, 9), z(645) - ft(21),
  lowerWest[2] + ft(13, 9) + ft(30, 10), z(645),
]

const aduX = x(323)
const aduZ = z(390)
const adu: Block = {
  id: aduFrame, yaw: 20 * Math.PI / 180,
  rect: [aduX - ft(21) / 2, aduZ - ft(30, 10) / 2, aduX + ft(21) / 2, aduZ + ft(30, 10) / 2],
  cladding: { default: warm },
  roof: { type: 'gable', ridgeAxis: 'x', eave: ft(14, 0) - 0.19, ridge: ft(14, 3) - 0.19, thickness: 0.19, overhang: 0.065 },
  ceiling: 'vaulted',
}
const [ax0, az0, ax1, az1] = adu.rect
const aduBathX = ax0 + ft(9, 8)
const aduBedZ = az0 + ft(10)
// Leave usable depth for the bath and the kitchenette across the passage.
const aduBathZ = aduBedZ + ft(7, 4)

const blocks: Block[] = [
  {
    id: 'bedroom-wing', rect: west, cladding: { default: metal },
    roof: { type: 'gable', ridgeAxis: 'x', eave: ft(14) - 0.19, ridge: ft(14, 3) - 0.19, thickness: 0.19, overhang: { n: 0.17, s: 0.06, w: 0.06, e: 0 } },
    ceiling: 'vaulted',
  },
  {
    id: 'great-room', rect: great, cladding: { default: metal, n: warm },
    roof: { type: 'shed', rises: 's', low: ft(15, 1) - 0.19, high: ft(15, 7) - 0.19, thickness: 0.19, overhang: { n: 0.29, s: 0.06, e: 0, w: 0 } },
    ceiling: 'vaulted',
  },
  {
    id: 'entry-wing', rect: foyer, cladding: { default: metal },
    roof: { type: 'shed', rises: 'n', low: ft(15, 3) - 0.19, high: ft(15, 7) - 0.19, thickness: 0.19, overhang: { s: 0.06, w: 0.06, n: 0, e: 0 } },
    ceiling: ft(9),
  },
  {
    id: 'office-wing', rect: east, cladding: { default: metal },
    roof: { type: 'gable', ridgeAxis: 'x', eave: ft(14) - 0.19, ridge: ft(14, 3) - 0.19, thickness: 0.19, overhang: { n: 0.17, s: 0, w: 0, e: 0.06 } },
    ceiling: 'vaulted',
  },
  {
    id: 'garage', rect: garage, cladding: { default: warm },
    roof: { type: 'shed', rises: 's', low: ft(12, 8) - 0.19, high: ft(13) - 0.19, thickness: 0.19, overhang: { n: 0.2, s: 0.07, w: 0, e: 0.07 } },
    ceiling: 'vaulted', utility: true,
  },
  {
    id: 'garage-jog', rect: rect(990, 208, 999, 382), cladding: { default: warm },
    roof: { type: 'shed', rises: 's', low: ft(12, 8) - 0.19, high: ft(13) - 0.19 - ft(0, 4) * 19 / 193, thickness: 0.19, overhang: 0 },
    ceiling: 'vaulted', utility: true,
  },
  adu,
  ...[lowerWest, lowerEast].map((r, i): Block => ({
    id: `walkout-${i + 1}`, rect: r, level: lower, cladding: { default: metal },
    roof: { type: 'flat', height: drop - ft(0, 8) - 0.14, overhang: 0.07, thickness: 0.14 },
  })),
]

const w = (id: string, u: number, v: number, u2: number, v2: number, level = main): InteriorWall =>
  ({ id, a: [x(u), z(v)], b: [x(u2), z(v2)], level })
const walls: InteriorWall[] = [
  w('laundry', 795, 208, 795, 300),
  w('powder-left', 870, 209, 870, 263), w('powder-right', 918, 209, 918, 263), w('powder-door', 870, 260, 918, 260),
  w('coat', 868, 302, 990, 302),
  w('bedroom-3-south', 461, 418, 601, 418), w('bath-2-left', 581, 295, 581, 378), w('bath-2-door', 581, 378, 646, 378),
  w('bedroom-2-east', 601, 418, 601, 515), w('bedroom-2-south', 461, 514, 601, 514),
  w('west-hall-south', 601, 546, 601, 656), w('west-hall-front', 644, 474, 644, 567), w('west-hall-north', 644, 295, 644, 421),
  w('primary-door', 601, 514, 601, 546), w('primary-closet-bath', 508, 514, 508, 656), w('primary-wet-wall', 461, 575, 508, 575),
  w('office-door', 1037, 382, 1037, 568), w('gym-door', 1037, 568, 1037, 743), w('office-gym', 1037, 564, 1176, 564),
  w('garage-great', 990, 295, 990, 382), w('garage-foyer', 990, 208, 990, 295),
  w('garage-office', 1037, 382, 1176, 382),
  { id: 'adu-bath-north', frame: aduFrame, a: [ax0, aduBathZ], b: [aduBathX, aduBathZ] },
  { id: 'adu-bath-east', frame: aduFrame, a: [aduBathX, aduBathZ], b: [aduBathX, aduBedZ] },
  { id: 'adu-bed', frame: aduFrame, a: [ax0, aduBedZ], b: [ax1, aduBedZ] },
]
const room = (id: string, name: string, type: RoomType, r: Rect, level = main, frame?: string): RoomDef =>
  ({ id, name, type, rect: r, level, frame, floor: type === 'bath' || type === 'powder' ? 'tile' : undefined })
const rooms: RoomDef[] = [
  room('great', 'Great room', 'living', rect(775, 302, 990, 566)),
  room('kitchen', 'Kitchen', 'kitchen', rect(644, 295, 782, 474)),
  room('dining', 'Dining', 'dining', rect(648, 474, 787, 566)),
  room('entry', 'Foyer', 'entry', rect(797, 208, 869, 295)),
  room('laundry', 'Laundry', 'laundry', rect(726, 208, 795, 295)),
  room('powder', 'Powder room', 'powder', rect(870, 208, 918, 260)),
  room('coat', 'Coat closet', 'closet', rect(918, 208, 990, 295)),
  room('garage', '4-car garage', 'garage', garage),
  room('office', 'Office', 'office', rect(1037, 382, 1176, 564)),
  room('gym', 'Gym', 'gym', rect(1037, 564, 1176, 743)),
  room('east-hall', 'East stair hall', 'hall', rect(990, 568, 1037, 645)),
  room('west-hall', 'West stair hall', 'hall', rect(601, 418, 646, 558)),
  room('bed3', 'Bedroom 3', 'bedroom', rect(461, 295, 581, 418)),
  room('bath2', 'Bathroom 2', 'bath', rect(581, 295, 646, 378)),
  room('bed2', 'Bedroom 2', 'bedroom', rect(461, 418, 601, 514)),
  room('primary', 'Primary bedroom', 'primary', rect(508, 514, 601, 656)),
  room('primary-closet', 'Primary closet', 'closet', rect(461, 514, 508, 575)),
  room('primary-bath', 'Primary bath', 'bath', rect(461, 575, 508, 656)),
  room('adu', 'ADU living', 'living', [ax0, aduBathZ, ax1, az1], main, aduFrame),
  room('adu-kitchen', 'ADU kitchenette', 'kitchen', [ax1 - ft(7), aduBedZ, ax1, aduBathZ], main, aduFrame),
  room('adu-bath', 'Bathroom 3', 'bath', [ax0, aduBedZ, aduBathX, aduBathZ], main, aduFrame),
  room('adubed', 'Bedroom 4', 'bedroom', [ax0, az0, ax1, aduBedZ], main, aduFrame),
]

function exterior(block: string, side: Side, center: number, width: number, height: number, kind: Opening['kind'] = 'fixed', sill = 0, detail: Partial<Opening> = {}): Opening {
  const r = blocks.find(b => b.id === block)!.rect
  return { block, side, at: center - r[side === 'n' || side === 's' ? 0 : 1], width, height, kind, sill, ...detail }
}
const opening = (wall: string, center: number, width = 0.9, id = wall): Opening =>
  ({ id, wall, at: center, width, height: ft(7), kind: 'door' })
const at = (wall: string, u: number, v: number, width = 0.9, id = wall) => {
  const a = walls.find(p => p.id === wall)!.a
  return opening(wall, Math.hypot(x(u) - a[0], z(v) - a[1]), width, id)
}
const tall = ft(11)
const sill = ft(1, 4)
const transom = ft(7, 6)
const openings: Opening[] = [
  exterior('entry-wing', 's', x(847), ft(3, 3), ft(8), 'entry', 0, { id: 'front-entry' }),
  ...[1048, 1135, 1222, 1309].map((u, i) => exterior('garage', 's', x(u), ft(9), ft(7, 6), 'garage', 0, { id: `garage-bay-${i + 1}` })),
  exterior('garage', 'n', x(1223), ft(6, 6), ft(10, 7), 'fixed', sill, { panes: 2, transom }),
  exterior('garage', 'n', x(1311), ft(6, 6), ft(10, 7), 'fixed', sill, { panes: 2, transom }),
  exterior('bedroom-wing', 's', x(510), ft(6, 6), ft(5, 6), 'window', ft(3), { panes: 2 }),
  exterior('bedroom-wing', 'w', z(447), ft(3, 3), ft(5, 6), 'window', ft(3)),
  ...[524, 582].map(u => exterior('bedroom-wing', 'n', x(u), ft(3, 1), tall, 'fixed', sill, { transom })),
  exterior('great-room', 'n', x(686), ft(6, 4), tall, 'fixed', sill, { panes: 2, transom }),
  exterior('great-room', 'n', x(819), ft(16, 4), ft(11, 10), 'slider', 0, { id: 'great-slider-open', slide: 'center', transom: ft(8, 5) }),
  exterior('great-room', 'n', x(949), ft(6, 4), tall, 'fixed', sill, { panes: 2, transom }),
  exterior('office-wing', 'e', z(434), ft(6, 4), tall, 'fixed', sill, { panes: 2, transom }),
  exterior('office-wing', 'e', z(694), ft(6, 4), tall, 'fixed', sill, { panes: 2, transom }),
  exterior('office-wing', 'n', x(1053), ft(3, 1), tall, 'fixed', sill, { transom }),
  exterior('office-wing', 'n', x(1127), ft(6, 5), tall, 'fixed', sill, { panes: 2, transom }),
  exterior(aduFrame, 's', ax0 + ft(13, 2), ft(3, 3), ft(8), 'entry', 0, { id: 'adu-entry' }),
  exterior(aduFrame, 'n', ax0 + ft(15, 4), ft(6, 4), tall, 'fixed', sill, { panes: 2, transom }),
  exterior(aduFrame, 'w', az0 + ft(5, 4), ft(6, 4), ft(5, 6), 'window', ft(3), { panes: 2 }),
  at('laundry', 795, 279), at('powder-door', 894, 260, 0.8),
  at('bedroom-3-south', 586, 418), at('bath-2-door', 622, 378),
  at('bedroom-2-east', 601, 496), at('primary-door', 601, 530),
  at('primary-closet-bath', 508, 542, 0.76, 'primary-closet-door'), at('primary-closet-bath', 508, 603, 0.76, 'primary-bath-door'),
  at('office-door', 1037, 478), at('gym-door', 1037, 583),
  opening('adu-bath-east', 0.45, 0.79), opening('adu-bed', ax1 - ax0 - ft(8, 8), 0.9),
]

const stairs = [lowerWest, lowerEast].map((r, i): HomePlan['stairs'][number] => {
  const id = `walkout-${i + 1}`
  const bathX = r[0] + ft(10, 5)
  const wcX = bathX - ft(4, 6)
  const wcZ = r[3] - ft(5, 6)
  const midLow = r[1] + ft(5, 6)
  const midHigh = midLow + ft(4, 7)
  walls.push(
    { id: `${id}-bath-front`, level: lower, a: [bathX, r[3]], b: [bathX, midHigh] },
    { id: `${id}-bath-rear`, level: lower, a: [bathX, midLow], b: [bathX, r[1]] },
    { id: `${id}-wc-side`, level: lower, a: [wcX, r[3]], b: [wcX, wcZ] },
    { id: `${id}-wc`, level: lower, a: [wcX, wcZ], b: [bathX, wcZ] },
  )
  rooms.push(
    room(`bed${i + 5}`, `Bedroom ${i + 5}`, 'bedroom', [bathX, r[1], r[2], r[3]], lower),
    { ...room(`bath${i + 5}`, `Suite ${i + 5} bath`, 'bath', [r[0], r[1], bathX, wcZ], lower), furnish: { bath: 'vanity' } },
    { ...room(`shower${i + 5}`, `Suite ${i + 5} shower`, 'bath', [r[0], wcZ, wcX, r[3]], lower), furnish: { bath: 'shower' } },
    { ...room(`wc${i + 1}`, `WC ${i + 1}`, 'powder', [wcX, wcZ, bathX, r[3]], lower), furnish: { bath: 'toilet' } },
  )
  openings.push(
    opening(`${id}-wc`, ft(2, 3), ft(2, 6)),
    exterior(id, 'n', r[0] + ft(5, 7), ft(6, 4), ft(5, 7), 'fixed', sill, { panes: 2 }),
    exterior(id, 'n', r[0] + ft(15, 5), ft(6, 4), ft(7), 'slider', 0, { id: `${id}-slider-open`, slide: 'right' }),
    exterior(id, 'n', r[0] + ft(25, 4), ft(6, 4), ft(5, 7), 'fixed', sill, { panes: 2 }),
    exterior(id, 'e', r[1] + ft(4), ft(3, 1), ft(5, 7), 'fixed', sill),
  )
  if (i === 0) openings.push(exterior(id, 'w', r[1] + ft(4), ft(3, 1), ft(5, 7), 'fixed', sill))
  return {
    id, from: [x(i === 0 ? 621 : 1015), z(i === 0 ? 568 : 652)], dir: 'n',
    width: ft(3, 11), rise: drop, steps: 15, going: ft(0, 9.4),
    rails: ['left', 'right'], between: { upper: main, lower },
  }
})

const [aduViewX, aduViewZ] = framePoint(adu, ax1 - 1, az0 + 1)
const [aduTargetX, aduTargetZ] = framePoint(adu, aduX - 1, az0 + 2)
const lowerY = floorY - drop

const drawingPlan: HomePlan = {
  id: 'aspen-custom',
  name: 'Aspen Custom',
  style: 'Mountain Modern',
  tagline: 'Two walkout suites, an angled ADU and a 1,181 sq ft deck.',
  facts: { area: 4375, main: 2781, adu: 526, lower: 1068, deck: 1181, garage: 1056, total: 6612, beds: 6, baths: 5.5, stories: 2, width: 142.17, depth: 74.67 },
  floorY,
  levels: [{ id: main, label: 'Main level', offset: 0 }, { id: lower, label: 'Lower level', offset: -drop }],
  sunAzimuth: 148,
  blocks, walls, openings, rooms, stairs,
  decks: [{ id: 'rear-deck', rect: deck, height: floorY, boardsAlong: 'z', rails: ['n', 'w', 'e'], railHeight: ft(3, 7), supportY: -drop - 0.12, spa: rect(890, 739, 964, 806) }],
  porches: [
    { id: 'entry-canopy', rect: rect(823, 184, 871, 208), height: floorY + ft(8, 7), roofThickness: 0.17, posts: [], rises: 'n' },
    { id: 'adu-canopy', frame: aduFrame, rect: [ax0 + ft(10), az1, ax0 + ft(16, 4), az1 + ft(2, 9)], height: floorY + ft(8, 7), roofThickness: 0.17, posts: [], rises: 'n' },
  ],
  terraces: [
    { id: 'entry-stoop', rect: rect(818, 154, 878, 208), kind: 'pavers', height: floorY - 0.04 },
    { id: 'adu-stoop', frame: aduFrame, rect: [ax0 + ft(9, 10), az1, ax0 + ft(16, 7), az1 + ft(6, 4)], kind: 'pavers', height: floorY - 0.04 },
    { id: 'drive', rect: rect(997, 14, 1447, 189), kind: 'concrete', height: 0.06 },
    ...[lowerWest, lowerEast].map((r, i): HomePlan['terraces'][number] => ({
      id: `walkout-landing-${i + 1}`, rect: [r[0], r[1] - 1.7, r[2], r[1]], kind: 'concrete',
      height: lowerY - 0.04, supportY: -drop - 0.02,
    })),
  ],
  landscape: {
    site: { downhill: 180, grade: 0.135, walkout: { side: 'n', drop }, oceanDistance: 236 },
    trees: [
      { x: -26, z: 13, s: 1.2, kind: 'pine' }, { x: 25, z: 8, s: 1.3, kind: 'pine' },
      { x: 32, z: -3, s: 1.1, kind: 'aspen' }, { x: -30, z: -8, s: 1.3, kind: 'pine' },
      { x: 31, z: -19, s: 1.4, kind: 'pine' },
    ],
    lounge: [{ x: x(909), z: z(650), rot: Math.PI }],
    dining: [{ x: x(711), z: z(678), rot: Math.PI / 2 }],
    clear: [deck, lowerWest, lowerEast],
  },
  views: [
    { id: 'hero', label: 'Walkout · east', kind: 'orbit', pos: [17, 3.5, -42], target: [-1, 0.6, -2], fov: 42 },
    { id: 'front', label: 'Arrival', kind: 'orbit', pos: [-11, 4.8, 39], target: [-0.5, 1.8, 5.4], fov: 48 },
    { id: 'deck', label: 'Walkout · west', kind: 'orbit', pos: [-25, 5.4, -40], target: [-2, 0.6, -2.3], fov: 43 },
    { id: 'aerial', label: 'Aerial', kind: 'orbit', pos: [11, 33, -38], target: [-1, 1, 0], fov: 47 },
    { id: 'entry', label: 'Foyer', kind: 'walk', pos: [x(841), floorY + 1.62, z(232)], target: [x(844), floorY + 1.35, z(488)], room: 'entry' },
    { id: 'great', label: 'Great room', kind: 'walk', pos: [x(862), floorY + 1.62, z(367)], target: [x(808), floorY + 1.24, z(580)], fov: 67, room: 'great' },
    { id: 'deckwalk', label: 'On the deck', kind: 'walk', pos: [x(826), floorY + 1.62, z(783)], target: [x(814), floorY + 1.4, z(507)], fov: 62 },
    { id: 'lower-west', label: 'Lower suite 5', kind: 'walk', pos: [lowerWest[2] - 0.82, lowerY + 1.62, lowerWest[1] + 1.35], target: [lowerWest[0] + 2.2, lowerY + 1.25, lowerWest[3] - 0.65], fov: 66, room: 'bed5' },
    { id: 'lower-east', label: 'Lower suite 6', kind: 'walk', pos: [lowerEast[2] - 0.82, lowerY + 1.62, lowerEast[1] + 1.35], target: [lowerEast[0] + 2.2, lowerY + 1.25, lowerEast[3] - 0.65], fov: 66, room: 'bed6' },
    { id: 'adu-bedroom', label: 'ADU bedroom', kind: 'walk', pos: [aduViewX, floorY + 1.62, aduViewZ], target: [aduTargetX, floorY + 1.25, aduTargetZ], fov: 64, room: 'adubed' },
  ],
  finishes: { cedar: 'natural-cedar', panel: 'charcoal', roof: 'charcoal', trim: 'black', door: 'black', deck: 'charcoal', palette: 'light', walls: 'greige' },
  zones: ['cedar', 'panel', 'roof', 'trim', 'door', 'deck', 'palette', 'walls'],
}

// In world space both sheet axes are reversed. z() above has already reversed the drawing's vertical axis.
const worldRect = ([x0, z0, x1, z1]: Rect): Rect => [-x1, z0, -x0, z1]
const worldPoint = ([x, z]: [number, number]): [number, number] => [-x, z]
const worldView = ([x, y, z]: [number, number, number]): [number, number, number] => [-x, y, z]
const worldSide = (side: Side): Side => side === 'e' ? 'w' : side === 'w' ? 'e' : side
const worldSides = <T>(sides: Partial<Record<Side, T>>) => ({ ...sides, e: sides.w, w: sides.e })

export const aspenCustom: HomePlan = {
  ...drawingPlan,
  sunAzimuth: -drawingPlan.sunAzimuth!,
  blocks: blocks.map(b => {
    const r = b.roof
    const overhang = typeof r.overhang === 'object' ? worldSides(r.overhang) : r.overhang
    const roof = r.type === 'shed' ? { ...r, rises: worldSide(r.rises), overhang } : { ...r, overhang }
    return { ...b, rect: worldRect(b.rect), yaw: b.yaw && -b.yaw, roof, cladding: { ...worldSides(b.cladding), default: b.cladding.default } }
  }),
  walls: walls.map(w => ({ ...w, a: worldPoint(w.a), b: worldPoint(w.b) })),
  rooms: rooms.map(r => ({ ...r, rect: worldRect(r.rect) })),
  openings: openings.map(o => {
    if (!o.block || !o.side) return o
    const [x0, , x1] = blocks.find(b => b.id === o.block)!.rect
    return { ...o, side: worldSide(o.side), at: o.side === 'n' || o.side === 's' ? x1 - x0 - o.at : o.at }
  }),
  stairs: stairs.map(s => ({ ...s, from: worldPoint(s.from), dir: worldSide(s.dir) })),
  decks: drawingPlan.decks.map(d => ({ ...d, rect: worldRect(d.rect), spa: d.spa && worldRect(d.spa), rails: d.rails?.map(worldSide) })),
  porches: drawingPlan.porches.map(p => ({ ...p, rect: worldRect(p.rect), posts: p.posts.map(worldPoint) })),
  terraces: drawingPlan.terraces.map(t => ({ ...t, rect: worldRect(t.rect) })),
  landscape: {
    ...drawingPlan.landscape,
    trees: drawingPlan.landscape.trees?.map(t => ({ ...t, x: -t.x })),
    lounge: drawingPlan.landscape.lounge?.map(p => ({ ...p, x: -p.x, rot: -p.rot })),
    dining: drawingPlan.landscape.dining?.map(p => ({ ...p, x: -p.x, rot: -p.rot })),
    clear: drawingPlan.landscape.clear?.map(worldRect),
  },
  views: drawingPlan.views.map(v => ({ ...v, pos: worldView(v.pos), target: worldView(v.target) })),
}
