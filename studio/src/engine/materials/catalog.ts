import type { TextureSetId } from './textures'

// Finish catalog. A zone is a configurable surface group (all cedar boards, all metal panels, the roof...). Each
// option sets physical material parameters, so wood stays wood (grain, sheen) and paint stays paint.

export interface MaterialParams {
  color: string
  roughness: number
  metalness?: number
  tex?: TextureSetId | null
  /** texture tile scale multiplier */
  texScale?: number
  texRotation?: number
  normalStrength?: number
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

const boards = (id: string, name: string, swatch: string, color: string, roughness = 0.86, variation = 1): FinishOption =>
  ({ id, name, swatch, params: { color, roughness, tex: 'teak_veneer', normalStrength: 0.9, variation } })
const cladding = (id: string, name: string, swatch: string, color: string, roughness: number, variation: number): FinishOption => {
  const finish = boards(id, name, swatch, color, roughness, variation)
  finish.params.texRotation = Math.PI / 2
  return finish
}
const paint = (id: string, name: string, swatch: string, roughness = 0.5, metalness = 0.05): FinishOption =>
  ({ id, name, swatch, params: { color: swatch, roughness, metalness, tex: null } })
const paintedBoards = (id: string, name: string, swatch: string, roughness = 0.62): FinishOption =>
  ({ id, name, swatch, params: { color: swatch, roughness, metalness: 0, tex: null, variation: 0.12 } })
const plaster = (id: string, name: string, swatch: string, normalStrength: number): FinishOption =>
  ({ id, name, swatch, params: { color: swatch, roughness: 0.96, tex: 'ambientcg_plaster001', normalStrength } })
const wallPaint = (id: string, name: string, swatch: string): FinishOption =>
  plaster(id, name, swatch, id === 'limewash' ? 0.28 : 0.16)

export const ZONES: Record<string, FinishZone> = {
  cedar: {
    id: 'cedar',
    label: 'Cedar cladding',
    group: 'exterior',
    options: [
      cladding('natural-cedar', 'Natural Cedar', '#B07A4B', '#F1DFCD', 0.9, 1),
      cladding('smoked-oak', 'Smoked Oak', '#8C7A64', '#B59C86', 0.8, 0.7),
      cladding('weathered-cedar', 'Weathered Cedar', '#A08F7E', '#C9C0B4', 0.85, 0.6),
      cladding('charcoal', 'Charred Cedar', '#3E3B38', '#55514E', 0.98, 0.85),
      cladding('chalk', 'Chalk', '#E5DECB', '#F0EBDF', 0.94, 0.26),
    ],
  },
  coastal: {
    id: 'coastal',
    label: 'Siding',
    group: 'exterior',
    options: [
      paintedBoards('chalk', 'Chalk', '#E5DECB'),
      paintedBoards('sand', 'Sand', '#CDB89C'),
      cladding('weathered-cedar', 'Weathered Cedar', '#A77750', '#E0B791', 0.8, 0.7),
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
      paint('charcoal', 'Charcoal', '#33373C', 0.46, 0.07),
      paint('graphite', 'Graphite', '#4A4E52', 0.46, 0.07),
      paint('iron-ore', 'Iron Ore', '#3D3B37', 0.5, 0.06),
      paint('bronze', 'Dark Bronze', '#4E4236', 0.42, 0.12),
      paint('pewter', 'Pewter', '#8B8E8F', 0.4, 0.28),
      paint('chalk', 'Chalk', '#E4DDCC', 0.55, 0.1),
    ],
  },
  panel2: {
    id: 'panel2',
    label: 'Upper panels',
    group: 'exterior',
    options: [
      paint('pewter', 'Pewter', '#9A9FA2', 0.42, 0.12),
      paint('charcoal', 'Charcoal', '#33373C', 0.46, 0.07),
      paint('chalk', 'Chalk', '#E4DDCC', 0.55, 0.1),
      paint('bronze', 'Dark Bronze', '#4E4236', 0.42, 0.12),
    ],
  },
  stucco: {
    id: 'stucco',
    label: 'Stucco',
    group: 'exterior',
    options: [
      plaster('chalk', 'Chalk', '#E7E1D2', 0.58),
      plaster('sand', 'Sand', '#CBB79B', 0.58),
      plaster('fog', 'Fog', '#B9BAB4', 0.58),
      plaster('graphite', 'Graphite', '#55585A', 0.58),
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
      paint('charcoal', 'Charcoal Seam', '#313438', 0.46, 0.06),
      paint('slate', 'Slate Seam', '#4F5458', 0.46, 0.06),
      paint('galvalume', 'Galvalume', '#AEB4B7', 0.41, 0.86),
      paint('bronze', 'Bronze Seam', '#514437', 0.46, 0.08),
    ],
  },
  trim: {
    id: 'trim',
    label: 'Windows & trim',
    group: 'exterior',
    options: [
      paint('black', 'Matte Black', '#202225', 0.48, 0.05),
      paint('charcoal', 'Charcoal', '#2F3134', 0.46, 0.05),
      paint('bronze', 'Bronze', '#3E342B', 0.44, 0.18),
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
      wallPaint('warm-white', 'Warm white', '#F1EBE1'),
      wallPaint('greige', 'Greige', '#D9CEC0'),
      wallPaint('sage', 'Sage', '#DDDCCD'),
      wallPaint('clay', 'Clay', '#E5D3C1'),
      wallPaint('fog', 'Fog blue', '#E6E7E3'),
      wallPaint('charcoal', 'Charcoal', '#4B4C4A'),
      wallPaint('limewash', 'Limewash', '#E3D8C8'),
    ],
  },
}

export interface InteriorPalette {
  floor: { tex: TextureSetId; color: string; roughness: number }
  cabinet: { tex: TextureSetId; color: string; roughness: number }
  counter: { color: string; roughness: number; coat: number }
  ceilingWood: { color: string }
  fabric: string
  fabric2: string
  rug: string
  metal: { color: string; roughness: number; metalness: number }
  stone: string
}

export const PALETTES: Record<string, InteriorPalette> = {
  light: {
    floor: { tex: 'oak_wood_planks', color: '#F6F4EF', roughness: 0.96 },
    cabinet: { tex: 'white_oak_veneer', color: '#F1D2AD', roughness: 0.62 },
    counter: { color: '#F4F0EA', roughness: 0.97, coat: 0.24 },
    ceilingWood: { color: '#FFE9D2' },
    fabric: '#EEE3D1',
    fabric2: '#A49379',
    rug: '#C6AD8C',
    metal: { color: '#BA8D53', roughness: 0.39, metalness: 0.72 },
    stone: '#E9E3D6',
  },
  walnut: {
    floor: { tex: 'oak_wood_planks', color: '#E5CDB0', roughness: 0.95 },
    cabinet: { tex: 'white_oak_veneer', color: '#CBA57F', roughness: 0.62 },
    counter: { color: '#E8DDCC', roughness: 1, coat: 0.15 },
    ceilingWood: { color: '#E9CAA9' },
    fabric: '#E5D9C9',
    fabric2: '#837459',
    rug: '#B9A07F',
    metal: { color: '#B08D57', roughness: 0.3, metalness: 1 },
    stone: '#D8C7B0',
  },
  ash: {
    floor: { tex: 'wood_planks_grey', color: '#D8D4CF', roughness: 0.88 },
    cabinet: { tex: 'ash_veneer', color: '#9B958D', roughness: 0.6 },
    counter: { color: '#77797B', roughness: 0.92, coat: 0.18 },
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
