import type { Block, HomePlan, Rect, RoomDef } from '../engine/house/types'
import { cedarRidge } from './cedarRidge'

export const FOOTPRINTS = [
  { id: 'bar', name: 'Bar', description: 'A single open span', rects: [[-7, -4, 7, 4]] },
  { id: 'ell', name: 'L-shaped', description: 'Two wings around a sheltered patio', rects: [[-7, -5, 7, 1], [-7, 1, -1, 7]] },
  { id: 'court', name: 'Courtyard', description: 'Three wings framing an outdoor room', rects: [[-8, -6, 8, -1], [-8, -1, -4, 7], [4, -1, 8, 7]] },
  { id: 'box', name: 'Two-storey box', description: 'Two compact floors with a stair', rects: [[-5, -4, 5, 4]] },
] satisfies { id: string; name: string; description: string; rects: Rect[] }[]

export const UPPER_OFFSET = 3.05
export const BEARING_ROOF: Extract<Block['roof'], { type: 'flat' }> = { type: 'flat', height: 2.8, thickness: 0.23, overhang: 0, bearing: true }

export function footprint(id: string): HomePlan | undefined {
  const template = FOOTPRINTS.find(item => item.id === id)
  if (!template) return
  const blocks: Block[] = template.rects.map((rect, index) => ({
    id: `volume-${index + 1}`,
    rect: [...rect],
    roof: { type: 'flat', height: index ? 2.8 : 3.15, thickness: 0.28, overhang: template.rects.length > 1 ? 0 : 0.28 },
    cladding: { default: index ? { zone: 'panel', kind: 'panel' } : { zone: 'cedar', kind: 'boards' } },
    ceiling: 2.65,
  }))
  const [x0, z0, x1, z1] = blocks[0].rect
  const rooms: RoomDef[] = [
    { id: 'living', name: 'Living room', type: 'living', rect: [x0 + 0.22, z0 + 0.22, 1, z1 - 0.22] },
    { id: 'kitchen', name: 'Kitchen', type: 'kitchen', rect: [1, z0 + 0.22, x1 - 0.22, z1 - 0.22] },
  ]
  const plan: HomePlan = {
    id: template.id,
    name: `${template.name} home`,
    style: 'Custom design',
    tagline: template.description,
    floorY: 0.2,
    liveLighting: true,
    facts: { area: 0, beds: 0, baths: 0, stories: 1, width: 0, depth: 0 },
    blocks, rooms, walls: [], views: [],
    openings: [
      { id: 'front-entry', block: blocks[0].id, side: 's', kind: 'entry', at: id === 'court' ? 10.6 : x1 - x0 - 1.7, width: 1.05, height: 2.15 },
      { id: 'living-glass', block: blocks[0].id, side: 'n', kind: 'window', at: 2.4, width: 2.8, height: 1.55, sill: 0.75, panes: 3 },
      { id: 'kitchen-glass', block: blocks[0].id, side: 'n', kind: 'window', at: x1 - x0 - 2, width: 1.7, height: 1.3, sill: 0.95, panes: 2 },
      { id: 'courtyard-glass', block: blocks[0].id, side: 's', kind: 'slider', at: id === 'court' ? 8 : x1 - x0 - 5.35, width: 2.65, height: 2.23, panes: 2, slide: 'right' },
      { id: 'corner-glass', block: blocks[0].id, side: 'e', kind: 'fixed', at: (z1 - z0) / 2, width: 2.45, height: 1.5, sill: 0.65, panes: 2 },
    ],
    decks: [], porches: [], terraces: [], stairs: [],
    landscape: {
      site: { ...cedarRidge.landscape.site! },
      forest: cedarRidge.landscape.forest && { ...cedarRidge.landscape.forest },
    },
    zones: [...cedarRidge.zones],
    finishes: { ...cedarRidge.finishes },
  }
  if (id === 'box') {
    const upper = { id: 'upper', label: 'Level 2', offset: UPPER_OFFSET }
    plan.levels = [{ id: 'main', label: 'Ground floor', offset: 0 }, upper]
    blocks[0].roof = { ...BEARING_ROOF }
    blocks.push({
      ...blocks[0], id: 'upper-volume', level: upper.id, rect: [...blocks[0].rect],
      roof: { type: 'gable', eave: 2.7, ridge: 3.85, ridgeAxis: 'x', overhang: 0.22 },
    })
    const hall = [x0 + 0.22, z0 + 0.22, x0 + 2.4, z1 - 0.22] satisfies Rect
    rooms[0].rect[0] = hall[2]
    rooms.push(
      { id: 'upper-hall', name: 'Landing', type: 'hall', rect: [...hall], level: upper.id },
      { id: 'upper-room', name: 'Bedroom', type: 'bedroom', rect: [hall[2], z0 + 0.22, x1 - 0.22, z1 - 0.22], level: upper.id },
    )
    plan.stairs.push({
      id: 'main-stair', from: [x0 + 1.2, z1 - 1.15], dir: 'n', width: 1.1, going: 0.28, steps: 17, rise: upper.offset,
      between: { lower: 'main', upper: upper.id }, rails: ['left', 'right'],
    })
    plan.openings.push({ id: 'upper-glass', block: 'upper-volume', side: 's', kind: 'window', at: 6.8, width: 1.65, height: 1.35, sill: 0.8, panes: 2 })
  }
  return plan
}
