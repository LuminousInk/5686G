import type { TextureSetId } from './textures'

// Finish catalog. A zone is a configurable surface group (all cedar boards, all metal panels, the roof...). Each
// option sets physical material parameters, so wood stays wood (grain, sheen) and paint stays paint.

export interface MaterialParams {
  color: string
  roughness: number
  metalness?: number
  tex?: TextureSetId | null
  /** named procedural colour map (generated in textures.ts) instead of a bank texture set */
  map?: 'limewash'
  /** texture tile scale multiplier */
  texScale?: number
  clearcoat?: number
  /** how strongly per-board colour variation shows (boards only) */
  variation?: number
}

export interface FinishOption {
  id: string
  name: string
  swatch: string
  params: MaterialParams
}

export interface FinishZone {
  id: string
  label: string
  group: 'exterior' | 'interior' | 'site'
  options: FinishOption[]
}

const boards = (id: string, name: string, swatch: string, color: string, roughness = 0.78, variation = 1): FinishOption =>
  ({ id, name, swatch, params: { color, roughness, tex: 'teak_veneer', variation } })
const paint = (id: string, name: string, swatch: string, roughness = 0.5, metalness = 0.25): FinishOption =>
  ({ id, name, swatch, params: { color: swatch, roughness, metalness, tex: null } })
const paintedBoards = (id: string, name: string, swatch: string, roughness = 0.62): FinishOption =>
  ({ id, name, swatch, params: { color: swatch, roughness, metalness: 0, tex: null, variation: 0.12 } })
// Interior matte paint options retain the same share-code IDs.
const wallPaint = (id: string, name: string, swatch: string, map?: 'limewash'): FinishOption =>
  ({ id, name, swatch, params: { color: swatch, roughness: map ? 0.94 : 0.9, metalness: 0, tex: null, map } })

export const ZONES: Record<string, FinishZone> = {
  cedar: {
    id: 'cedar',
    label: 'Cedar cladding',
    group: 'exterior',
    options: [
      boards('natural-cedar', 'Natural Cedar', '#B07A4B', '#FFE2C4', 0.74, 1),
      boards('smoked-oak', 'Smoked Oak', '#8C7A64', '#B59C86', 0.8, 0.7),
      boards('weathered-cedar', 'Weathered Cedar', '#A08F7E', '#C9C0B4', 0.85, 0.6),
      boards('charcoal', 'Charred Cedar', '#3E3B38', '#3B3734', 0.62, 0.35),
      boards('chalk', 'Chalk', '#E5DECB', '#FFFFFF', 0.7, 0.15),
    ],
  },
  coastal: {
    id: 'coastal',
    label: 'Siding',
    group: 'exterior',
    options: [
      paintedBoards('chalk', 'Chalk', '#E5DECB'),
      paintedBoards('sand', 'Sand', '#CDB89C'),
      boards('weathered-cedar', 'Weathered Cedar', '#A77750', '#E0B791', 0.8, 0.7),
    ],
  },
  body: {
    id: 'body',
    label: 'Board & batten',
    group: 'exterior',
    options: [
      paint('charcoal', 'Charcoal', '#2F3134', 0.6, 0),
      paint('graphite', 'Graphite', '#4A4D50', 0.6, 0),
      paint('iron-ore', 'Iron Ore', '#3D3B37', 0.6, 0),
      paint('arctic-white', 'Arctic White', '#EEEDE7', 0.62, 0),
      paint('sage', 'Sage', '#8E9C85', 0.62, 0),
      paint('deep-navy', 'Deep Navy', '#2F3C50', 0.6, 0),
    ],
  },
  panel: {
    id: 'panel',
    label: 'Metal panels',
    group: 'exterior',
    options: [
      paint('charcoal', 'Charcoal', '#33373C', 0.46, 0.35),
      paint('graphite', 'Graphite', '#4A4E52', 0.46, 0.35),
      paint('iron-ore', 'Iron Ore', '#3D3B37', 0.5, 0.3),
      paint('bronze', 'Dark Bronze', '#4E4236', 0.42, 0.4),
      paint('pewter', 'Pewter', '#8B8E8F', 0.4, 0.45),
      paint('chalk', 'Chalk', '#E4DDCC', 0.55, 0.1),
    ],
  },
  panel2: {
    id: 'panel2',
    label: 'Upper panels',
    group: 'exterior',
    options: [
      paint('pewter', 'Pewter', '#9A9FA2', 0.42, 0.4),
      paint('charcoal', 'Charcoal', '#33373C', 0.46, 0.35),
      paint('chalk', 'Chalk', '#E4DDCC', 0.55, 0.1),
      paint('bronze', 'Dark Bronze', '#4E4236', 0.42, 0.4),
    ],
  },
  stucco: {
    id: 'stucco',
    label: 'Stucco',
    group: 'exterior',
    options: [
      paint('chalk', 'Chalk', '#E7E1D2', 0.9, 0),
      paint('sand', 'Sand', '#CBB79B', 0.9, 0),
      paint('fog', 'Fog', '#B9BAB4', 0.9, 0),
      paint('graphite', 'Graphite', '#55585A', 0.88, 0),
    ],
  },
  siding: {
    id: 'siding',
    label: 'Board & batten',
    group: 'exterior',
    options: [
      paint('arctic-white', 'Arctic White', '#EEEDE7', 0.62, 0),
      paint('light-mist', 'Light Mist', '#D8D9D2', 0.62, 0),
      paint('sage', 'Sage', '#8E9C85', 0.62, 0),
      paint('iron-gray', 'Iron Gray', '#565A5E', 0.6, 0),
      paint('deep-navy', 'Deep Navy', '#2F3C50', 0.6, 0),
    ],
  },
  roof: {
    id: 'roof',
    label: 'Roof',
    group: 'exterior',
    options: [
      paint('charcoal', 'Charcoal Seam', '#2C2F33', 0.42, 0.55),
      paint('slate', 'Slate Seam', '#4F5458', 0.42, 0.55),
      paint('galvalume', 'Galvalume', '#9DA2A5', 0.3, 0.85),
      paint('bronze', 'Bronze Seam', '#4A3F35', 0.42, 0.55),
    ],
  },
  trim: {
    id: 'trim',
    label: 'Windows & trim',
    group: 'exterior',
    options: [
      paint('black', 'Matte Black', '#151618', 0.45, 0.5),
      paint('charcoal', 'Charcoal', '#2F3134', 0.45, 0.5),
      paint('bronze', 'Bronze', '#3E342B', 0.42, 0.55),
      paint('chalk', 'Chalk', '#E4DDCC', 0.5, 0.1),
    ],
  },
  door: {
    id: 'door',
    label: 'Entry door',
    group: 'exterior',
    options: [
      boards('cedar', 'Cedar', '#8C5A35', '#E8C3A0', 0.6, 0.4),
      paint('black', 'Matte Black', '#1C1D1F', 0.5, 0.3),
      paint('forest', 'Forest', '#2F4A3A', 0.5, 0.1),
      paint('rust', 'Rust', '#8A3F25', 0.5, 0.1),
      paint('sand', 'Sand', '#C9B79C', 0.55, 0.05),
    ],
  },
  deck: {
    id: 'deck',
    label: 'Decking',
    group: 'exterior',
    options: [
      boards('ipe', 'Ipe', '#6B4A33', '#9C7258', 0.62, 0.9),
      boards('charcoal', 'Charcoal Composite', '#38363A', '#4A4747', 0.7, 0.25),
      boards('driftwood', 'Driftwood', '#A39684', '#D2C8BA', 0.8, 0.5),
    ],
  },
  palette: {
    id: 'palette',
    label: 'Interior palette',
    group: 'interior',
    options: [
      { id: 'light', name: 'Light Oak & Limestone', swatch: '#D5B997', params: { color: '#ffffff', roughness: 0.5 } },
      { id: 'walnut', name: 'Honey Oak & Travertine', swatch: '#744D35', params: { color: '#ffffff', roughness: 0.5 } },
      { id: 'ash', name: 'Ash & Slate', swatch: '#77736E', params: { color: '#ffffff', roughness: 0.5 } },
    ],
  },
  walls: {
    id: 'walls',
    label: 'Interior walls',
    group: 'interior',
    options: [
      wallPaint('warm-white', 'Warm white', '#F1EBE1', 'limewash'),
      wallPaint('greige', 'Greige', '#D9CEC0', 'limewash'),
      wallPaint('sage', 'Sage', '#DDDCCD', 'limewash'),
      wallPaint('clay', 'Clay', '#E5D3C1', 'limewash'),
      wallPaint('fog', 'Fog blue', '#E6E7E3', 'limewash'),
      wallPaint('charcoal', 'Charcoal', '#4B4C4A'),
      // mottled plaster: near-white blotch map tinted by the colour, a touch rougher than flat paint
      wallPaint('limewash', 'Limewash', '#E3D8C8', 'limewash'),
    ],
  },
}

export interface InteriorPalette {
  floor: { tex: TextureSetId; color: string; roughness: number }
  cabinet: { tex: TextureSetId; color: string; roughness: number }
  counter: { color: string; roughness: number; speckle: string }
  ceilingWood: { color: string }
  fabric: string
  fabric2: string
  rug: string
  metal: { color: string; roughness: number; metalness: number }
  stone: string
}

export const PALETTES: Record<string, InteriorPalette> = {
  light: {
    floor: { tex: 'laminate_floor_02', color: '#FFF1DD', roughness: 0.57 },
    cabinet: { tex: 'white_oak_veneer', color: '#F1D2AD', roughness: 0.62 },
    counter: { color: '#F3ECE0', roughness: 0.5, speckle: '#D9CFBD' },
    ceilingWood: { color: '#FFE9D2' },
    fabric: '#EEE3D1',
    fabric2: '#A49379',
    rug: '#C6AD8C',
    metal: { color: '#BA8D53', roughness: 0.39, metalness: 0.72 },
    stone: '#E9E3D6',
  },
  walnut: {
    floor: { tex: 'laminate_floor_02', color: '#E8CDA9', roughness: 0.6 },
    cabinet: { tex: 'white_oak_veneer', color: '#CBA57F', roughness: 0.62 },
    counter: { color: '#E9E0D0', roughness: 0.51, speckle: '#CDBDA7' },
    ceilingWood: { color: '#E9CAA9' },
    fabric: '#E5D9C9',
    fabric2: '#837459',
    rug: '#B9A07F',
    metal: { color: '#B08D57', roughness: 0.3, metalness: 1 },
    stone: '#D8C7B0',
  },
  ash: {
    floor: { tex: 'wood_planks_grey', color: '#D8D4CF', roughness: 0.6 },
    cabinet: { tex: 'ash_veneer', color: '#9B958D', roughness: 0.6 },
    counter: { color: '#55585A', roughness: 0.45, speckle: '#3E4143' },
    ceilingWood: { color: '#C8C2BA' },
    fabric: '#C9C7C2',
    fabric2: '#4A4C4E',
    rug: '#8E8B86',
    metal: { color: '#1E1F21', roughness: 0.45, metalness: 0.6 },
    stone: '#6A6D6F',
  },
}

export function zoneOption(zone: string, optionId: string | undefined): FinishOption {
  const z = ZONES[zone]
  return z.options.find(o => o.id === optionId) ?? z.options[0]
}
