import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PLANS } from '../../plans'
import { coastalKeepout, coastalLawn, coastalNeighbors, coastalPlantLayout, coastalStreets, coastalStreetWidth, inRect } from './coastalLayout'
import { Hillside, shoreline } from './hillside'

describe('Pacific Palisades planting and context', () => {
  it.each(PLANS)('keeps $name scrub off its pad, garden and paths', plan => {
    const hill = new Hillside(plan, plan.landscape.site!)
    const neighbors = coastalNeighbors(hill)
    const { near, far, hedges, dryGrass, gardenGrass, garden, lawn } = coastalPlantLayout(plan, hill, 'low', neighbors)
    const blocked = coastalKeepout(plan)
    const scrub = [...near, ...far, ...hedges, ...dryGrass]
    expect(near.length).toBeGreaterThan(300)
    expect(far.length).toBeGreaterThan(700)
    expect(dryGrass.length).toBeGreaterThan(500)
    expect(garden.flat().length).toBeGreaterThan(80)
    expect(scrub.every(({ x, z, y, radius }) => {
      const [u, v] = hill.local(x, z)
      return !inRect(u, v, hill.pad, radius) && !blocked(x, z, radius) &&
        (!lawn || !inRect(u, v, lawn, radius)) &&
        v < shoreline(u, hill.oceanDistance!) - 13 &&
        Math.abs(y - hill.heightAt(x, z) + 0.025) < 1e-7
    })).toBe(true)
    expect(gardenGrass.length).toBeGreaterThan(5)
    expect([...gardenGrass, ...garden.flat()].every(({ x, z, radius }) => {
      const [u, v] = hill.local(x, z)
      return !blocked(x, z, radius) && (!lawn || !inRect(u, v, lawn, radius))
    })).toBe(true)
  })

  it('roots scrub cards on the triangles they are drawn over', () => {
    const plan = PLANS[0]
    const hill = new Hillside(plan, plan.landscape.site!)
    const material = new THREE.MeshBasicMaterial()
    const ground = hill.buildSurface(material, material, true)
    const { far } = coastalPlantLayout(plan, hill, 'low', coastalNeighbors(hill))
    for (const { x, y, z } of far.slice(0, 40)) {
      expect(y + 0.025).toBeCloseTo(hill.surfaceHeight(...hill.local(x, z)), 6)
    }
    for (const mesh of ground.children as THREE.Mesh[]) mesh.geometry.dispose()
    material.dispose()
  })

  it.each(PLANS)('keeps $name context streets on the shoulders with clear setbacks', plan => {
    const hill = new Hillside(plan, plan.landscape.site!)
    const neighbors = coastalNeighbors(hill)
    const [u0, , u1] = hill.pad
    for (const street of coastalStreets(neighbors)) {
      expect(street.length).toBeGreaterThan(2)
      for (const [u, v] of street) {
        expect(u < u0 || u > u1).toBe(true)
        const n = neighbors.find(n => n.u === u)!
        expect(v + coastalStreetWidth * 0.5).toBeLessThan(n.v - n.depth / 2 - 1.8)
      }
    }
  })

  it.each(PLANS)('gives $name denser high tiers with two distinct scrub distances', plan => {
    const hill = new Hillside(plan, plan.landscape.site!)
    const neighbors = coastalNeighbors(hill)
    const layouts = (['low', 'medium', 'high'] as const).map(tier => coastalPlantLayout(plan, hill, tier, neighbors))
    const [u0, v0, u1, v1] = hill.pad
    for (const kind of ['near', 'far'] as const) {
      const counts = layouts.map(layout => layout[kind].length)
      expect(counts[2]).toBeGreaterThan(counts[1])
      expect(counts[1]).toBeGreaterThan(counts[0])
      expect(layouts[0][kind].every(({ x, z }) => {
        const [u, v] = hill.local(x, z)
        const distance = Math.hypot(Math.max(u0 - u, u - u1, 0), Math.max(v0 - v, v - v1, 0))
        return (kind === 'far') === (distance >= 54)
      })).toBe(true)
    }
    expect(coastalPlantLayout(plan, hill, 'low', neighbors).near).toEqual(layouts[0].near)
  })

  it.each(PLANS)('steps $name neighboring houses away from the bay sightline and beach', plan => {
    const hill = new Hillside(plan, plan.landscape.site!)
    const [u0, , u1, v1] = hill.pad
    const neighbors = coastalNeighbors(hill)
    const firstRow: number[] = [], lastRow: number[] = []
    expect(neighbors.length).toBeGreaterThan(36)
    for (const { u, v, width, depth } of neighbors) {
      expect(u + width * 0.5 < u0 || u - width * 0.5 > u1).toBe(true)
      expect(v - depth * 0.5).toBeGreaterThan(v1)
      expect(v + depth * 0.5).toBeLessThan(shoreline(u, hill.oceanDistance!) - 20)
      const y = hill.heightAt(...hill.world(u, v))
      if (v < v1 + 38) firstRow.push(y)
      if (v > v1 + 107) lastRow.push(y)
    }
    const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
    expect(average(lastRow)).toBeLessThan(average(firstRow) - 7)
  })

  it.each(PLANS)('fits the $name lawn on the terrace and clears its hardscape', plan => {
    const hill = new Hillside(plan, plan.landscape.site!)
    const lawn = coastalLawn(plan, hill)
    expect(lawn).toBeDefined()
    const [u0, v0, u1, v1] = lawn!
    const blocked = coastalKeepout(plan)
    const corners = [[u0, v0], [u0, v1], [u1, v0], [u1, v1]]
    expect(corners.every(([u, v]) => !blocked(...hill.world(u, v)))).toBe(true)
    expect(v0).toBeGreaterThan(hill.pad[3])
    expect(v1).toBeLessThan(hill.pad[3] + 5.6)
  })
})
