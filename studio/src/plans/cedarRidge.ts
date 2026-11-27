import type { HomePlan } from '../engine/house/types'

/**
 * Cedar Ridge: the hero home (from the reference photo). A tall cedar great-room volume with a solar shed roof,
 * a light metal-panel kitchen/dining block behind a covered porch, a charcoal gable volume and a lower charcoal
 * wing with the primary suite. Raised paver terrace with a rock-garden berm in front.
 */
export const cedarRidge: HomePlan = {
  id: 'cedar-ridge',
  name: 'Cedar Ridge',
  style: 'Modern Woodland',
  tagline: 'Cedar and charcoal steel, a solar roof and a terrace that steps down into a rock garden.',
  facts: { area: 2310, beds: 3, baths: 2.5, stories: 1, width: 82, depth: 41 },
  floorY: 0.7,
  sunAzimuth: -58,
  blocks: [
    {
      id: 'great',
      rect: [-3.0, -9.5, 3.6, 0],
      roof: { type: 'shed', low: 3.25, high: 4.4, rises: 'e', overhang: { s: 0.75, n: 0.6, w: 0.4, e: 0 }, thickness: 0.3, solar: { rows: 2, cols: 7 } },
      cladding: {
        default: { zone: 'cedar', kind: 'boards' },
        w: { zone: 'panel', kind: 'panel' },
        e: { zone: 'panel', kind: 'panel' },
      },
      ceiling: 'vaulted',
      ceilingFinish: 'wood',
    },
    {
      id: 'west',
      rect: [-8.2, -9.5, -3.0, -1.0],
      roof: { type: 'shed', low: 2.75, high: 2.95, rises: 'e', overhang: { s: 0, n: 0.5, w: 0.5, e: 0 }, thickness: 0.28 },
      cladding: { default: { zone: 'panel2', kind: 'panel' } },
      ceiling: 'vaulted',
    },
    {
      id: 'east',
      rect: [3.6, -10.5, 8.4, 0.4],
      roof: { type: 'gable', eave: 4.35, ridge: 5.45, ridgeAxis: 'z', overhang: 0.35, thickness: 0.3 },
      cladding: { default: { zone: 'panel', kind: 'panel' } },
      ceiling: 'vaulted',
    },
    {
      id: 'wing',
      rect: [8.4, -10.5, 15.0, -2.0],
      roof: { type: 'shed', low: 2.85, high: 3.3, rises: 'n', overhang: { s: 0.6, n: 0.4, e: 0.45, w: 0 }, thickness: 0.3 },
      cladding: { default: { zone: 'panel', kind: 'panel' } },
      ceiling: 'vaulted',
    },
  ],
  walls: [
    // great block back: entry | powder | office
    { id: 'w-office-s', a: [-0.2, -6.4], b: [3.6, -6.4] },
    { id: 'w-entry-e', a: [-0.2, -9.5], b: [-0.2, -6.4] },
    { id: 'w-powder-n', a: [-0.2, -7.7], b: [1.3, -7.7] },
    { id: 'w-powder-e', a: [1.3, -9.5], b: [1.3, -7.7] },
    // great | east block (hall door)
    { id: 'w-great-east', a: [3.6, -9.5], b: [3.6, 0] },
    // east block: bedroom 2 / hall / bath 2 / laundry
    { id: 'w-bed2-n', a: [3.6, -4.6], b: [8.4, -4.6] },
    { id: 'w-hall-n', a: [3.6, -6.4], b: [8.4, -6.4] },
    { id: 'w-bath2-e', a: [6.0, -10.5], b: [6.0, -6.4] },
    // east | wing
    { id: 'w-east-wing', a: [8.4, -10.5], b: [8.4, -2.0] },
    // wing: primary bedroom / closet / bath
    { id: 'w-primary-n', a: [8.4, -6.0], b: [15.0, -6.0] },
    { id: 'w-closet-e', a: [11.6, -10.5], b: [11.6, -6.0] },
  ],
  openings: [
    // great room
    { id: 'great-slider-open', block: 'great', side: 's', at: 2.65, width: 2.7, height: 2.45, kind: 'slider' },
    { block: 'great', side: 's', at: 5.55, width: 1.1, height: 2.45, kind: 'fixed' },
    { block: 'great', side: 'n', at: 1.5, width: 1.6, height: 2.4, kind: 'entry' },
    { block: 'great', side: 'n', at: 5.4, width: 1.3, height: 1.4, sill: 0.9, kind: 'window' },
    { block: 'great', side: 'n', at: 3.55, width: 0.6, height: 0.6, sill: 1.6, kind: 'fixed' },
    // west block (dining / kitchen)
    { id: 'dining-slider', block: 'west', side: 's', at: 2.6, width: 3.0, height: 2.3, kind: 'slider' },
    { block: 'west', side: 'w', at: 6.5, width: 2.0, height: 1.5, sill: 0.8, kind: 'window' },
    { block: 'west', side: 'w', at: 2.2, width: 1.2, height: 1.0, sill: 1.05, kind: 'window' },
    { block: 'west', side: 'n', at: 2.6, width: 2.2, height: 1.0, sill: 1.05, kind: 'window', panes: 2 },
    // east block
    { block: 'east', side: 's', at: 1.25, width: 0.85, height: 2.65, sill: 0.3, kind: 'fixed' },
    { block: 'east', side: 's', at: 3.45, width: 0.85, height: 2.65, sill: 0.3, kind: 'fixed' },
    { block: 'east', side: 'n', at: 1.2, width: 1.0, height: 0.7, sill: 1.45, kind: 'window' },
    { block: 'east', side: 'n', at: 3.6, width: 1.0, height: 0.9, sill: 1.2, kind: 'window' },
    // wing (primary suite)
    { id: 'primary-slider', block: 'wing', side: 's', at: 2.3, width: 2.4, height: 2.3, kind: 'slider' },
    { block: 'wing', side: 's', at: 5.0, width: 1.6, height: 1.6, sill: 0.7, kind: 'window' },
    { block: 'wing', side: 'e', at: 2.2, width: 1.4, height: 0.8, sill: 1.4, kind: 'window' },
    { block: 'wing', side: 'e', at: 6.1, width: 1.6, height: 1.5, sill: 0.8, kind: 'window' },
    { block: 'wing', side: 'n', at: 1.6, width: 1.0, height: 0.8, sill: 1.4, kind: 'window' },
    // interior doors
    { wall: 'w-office-s', at: 2.6, width: 0.9, height: 2.15, kind: 'door' },
    { wall: 'w-entry-e', at: 0.9, width: 0.8, height: 2.15, kind: 'door' },
    { wall: 'w-great-east', at: 4.0, width: 1.0, height: 2.15, kind: 'door' },
    { wall: 'w-bed2-n', at: 1.4, width: 0.9, height: 2.15, kind: 'door' },
    { wall: 'w-hall-n', at: 1.2, width: 0.85, height: 2.15, kind: 'door' },
    { wall: 'w-hall-n', at: 3.6, width: 0.85, height: 2.15, kind: 'door' },
    { wall: 'w-east-wing', at: 5.0, width: 1.0, height: 2.15, kind: 'door' },
    { wall: 'w-primary-n', at: 1.6, width: 0.9, height: 2.15, kind: 'door' },
    { wall: 'w-primary-n', at: 4.9, width: 0.9, height: 2.15, kind: 'door' },
  ],
  rooms: [
    { id: 'great', name: 'Great room', type: 'living', rect: [-3.0, -6.4, 3.6, 0] },
    { id: 'dining', name: 'Dining', type: 'dining', rect: [-8.2, -5.0, -3.0, -1.0] },
    { id: 'kitchen', name: 'Kitchen', type: 'kitchen', rect: [-8.2, -9.5, -3.0, -5.0] },
    { id: 'entry', name: 'Entry', type: 'entry', rect: [-3.0, -9.5, -0.2, -6.4] },
    { id: 'powder', name: 'Powder', type: 'powder', rect: [-0.2, -9.5, 1.3, -7.7], floor: 'tile' },
    { id: 'office', name: 'Office', type: 'office', rect: [1.3, -9.5, 3.6, -6.4] },
    { id: 'bed2', name: 'Bedroom 2', type: 'bedroom', rect: [3.6, -4.6, 8.4, 0.4] },
    { id: 'hall', name: 'Hall', type: 'hall', rect: [3.6, -6.4, 8.4, -4.6] },
    { id: 'bath2', name: 'Bath', type: 'bath', rect: [3.6, -10.5, 6.0, -6.4], floor: 'tile' },
    { id: 'laundry', name: 'Laundry', type: 'laundry', rect: [6.0, -10.5, 8.4, -6.4], floor: 'tile' },
    { id: 'primary', name: 'Primary suite', type: 'primary', rect: [8.4, -6.0, 15.0, -2.0] },
    { id: 'closet', name: 'Closet', type: 'closet', rect: [8.4, -10.5, 11.6, -6.0] },
    { id: 'pbath', name: 'Primary bath', type: 'bath', rect: [11.6, -10.5, 15.0, -6.0], floor: 'tile' },
  ],
  decks: [{ id: 'porch-deck', rect: [-9.6, -1.0, -3.0, 2.7], height: 0.68, boardsAlong: 'x', rails: ['w'] }],
  porches: [
    {
      id: 'porch',
      rect: [-9.85, -1.0, -3.0, 2.95],
      height: 3.15,
      rises: 'n',
      posts: [
        [-9.5, 2.6],
        [-6.4, 2.6],
        [-3.35, 2.6],
      ],
    },
  ],
  stairs: [{ id: 'porch-stair', from: [-8.45, 2.7], dir: 's', width: 1.5, rise: 0.68, steps: 3, rails: ['left'] }],
  terraces: [{ id: 'terrace', rect: [-3.0, 0.0, 4.4, 3.8], kind: 'pavers', height: 0.66 }],
  landscape: {
    site: { downhill: 0, grade: 0.16, oceanDistance: 196 },
    berms: [
      { x: -10.1, z: 4.6, rx: 3.9, rz: 1.3, h: 0, seed: 3 },
      { x: 5.6, z: 4.0, rx: 2.1, rz: 1.25, h: 0, seed: 8 },
      { x: 11.1, z: 2.05, rx: 3.7, rz: 1.4, h: 0, seed: 12 },
      { x: -12.9, z: 0.8, rx: 2.9, rz: 2.45, h: 0, seed: 16 },
    ],
    trees: [
      { x: -11.9, z: 3.3, s: 1.02 },
      { x: 8.4, z: 1.8, s: 0.85, kind: 'bush' },
      { x: 17.3, z: 2.4, s: 0.92, kind: 'aspen' },
      { x: -14.8, z: -6.0, s: 0.89, kind: 'aspen' },
      { x: -12.5, z: -15.7, s: 0.86, kind: 'pine' },
      { x: 9.3, z: -15.1, s: 0.8, kind: 'aspen' },
      { x: 19.5, z: 15.3, s: 0.8 },
    ],
    paths: [
      { pts: [[-8.45, 3.58], [-7.7, 4.45], [-4.9, 4.55], [-1.8, 4.5], [-1.1, 3.8]], width: 1.06 },
      { pts: [[3.8, 3.85], [4.7, 2.58], [6.5, 2.25], [9.1, 3.4], [13.4, 3.55], [16.4, 2.8]], width: 0.94 },
    ],
    fence: [
      [-17.5, -18],
      [-17.5, 4],
    ],
    planters: [
      { x: 3.7, z: 1.05, kind: 'tall', grass: true },
      { x: 4.0, z: 2.0, kind: 'bowl', grass: false },
      { x: -2.55, z: 0.75, kind: 'low', grass: true },
    ],
    lounge: [{ x: 1.55, z: 0.62, rot: 0 }],
    clear: [[-1.35, 3.4, 3.4, 6.3]],
    dining: [{ x: -6.3, z: 0.9, rot: 0 }],
  },
  views: [
    { id: 'hero', label: 'Golden hour', kind: 'orbit', pos: [-34, 9.2, -20], target: [1.5, 2.6, 1], fov: 48 },
    { id: 'front', label: 'Street', kind: 'orbit', pos: [2.5, 2.2, 26], target: [2.5, 2.4, -3], fov: 42 },
    { id: 'corner', label: 'Corner', kind: 'orbit', pos: [36, 9.4, -7], target: [4, 2.9, 5], fov: 46 },
    { id: 'porch', label: 'Porch', kind: 'walk', pos: [-8.2, 2.35, 1.9], target: [-1.5, 1.9, 1.2], fov: 62 },
    { id: 'terrace', label: 'Terrace', kind: 'walk', pos: [0.2, 2.3, 3.4], target: [1.8, 1.5, 0.2], fov: 62 },
    { id: 'living', label: 'Great room', kind: 'walk', pos: [0.1, 2.35, -4.1], target: [0.0, 1.96, 4.5], fov: 65, room: 'great' },
    { id: 'kitchen', label: 'Kitchen', kind: 'walk', pos: [-3.6, 2.35, -2.2], target: [-6.8, 1.6, -8.4], fov: 66, room: 'kitchen' },
    { id: 'primary', label: 'Primary suite', kind: 'walk', pos: [14.2, 2.35, -2.6], target: [9.5, 1.6, -5.2], fov: 66, room: 'primary' },
    { id: 'test-window', label: 'Window', kind: 'orbit', pos: [5.2, 2.0, 6.5], target: [5.6, 2.2, 0.2], fov: 50 },
    { id: 'aerial', label: 'Aerial', kind: 'orbit', pos: [-25, 24, -29], target: [2, 1.6, 15], fov: 48 },
    { id: 'ocean', label: 'Ocean outlook', kind: 'orbit', pos: [-13, 8.5, -15], target: [0, -2, 43], fov: 53 },
  ],
  finishes: {
    cedar: 'natural-cedar',
    panel: 'charcoal',
    panel2: 'pewter',
    roof: 'charcoal',
    trim: 'black',
    door: 'cedar',
    deck: 'ipe',
    palette: 'light',
    walls: 'limewash',
  },
  zones: ['cedar', 'panel', 'panel2', 'roof', 'trim', 'door', 'deck', 'palette', 'walls'],
}
