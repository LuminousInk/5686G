import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PLANS } from '../../plans'
import { cedarRidge } from '../../plans/cedarRidge'
import { coastalModern } from '../../plans/coastalModern'
import { aspenCustom } from '../../plans/aspenCustom'
import { Hillside, shoreline, siteFootprints } from './hillside'
import { Terrain } from './terrain'
import type { HomePlan } from '../house/types'

describe('hillside lots', () => {
  it.each(PLANS.filter(plan => !plan.landscape.site?.walkout))('keeps the $name pad and its margin at grade', plan => {
    const terrain = new Terrain(plan, new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 6, 20)))
    expect(terrain.hillside).toBeDefined()
    for (const [x0, z0, x1, z1] of siteFootprints(plan)) {
      for (const x of [x0 - 1, (x0 + x1) / 2, x1 + 1]) {
        for (const z of [z0 - 1, (z0 + z1) / 2, z1 + 1]) expect(terrain.heightAt(x, z)).toBeCloseTo(0, 5)
      }
    }
  })

  it('levels a rotated pad including landscape driveways', () => {
    const plan: HomePlan = { ...cedarRidge, landscape: { ...cedarRidge.landscape, driveway: [[15, 0, 19, 9]] } }
    const hill = new Hillside(plan, { downhill: 57, grade: 0.16 })
    expect(hill.heightAt(19.9, 9.9)).toBeCloseTo(0)
    const v = hill.pad[3]
    const near = hill.heightAt(...hill.world(0, v + 15))
    const far = hill.heightAt(...hill.world(0, v + 48))
    const grade = (near - far) / 33
    expect(grade).toBeGreaterThan(0.10)
    expect(grade).toBeLessThan(0.23)
    expect(hill.heightAt(...hill.world(0, hill.pad[1] - 30))).toBeGreaterThan(0)
  })

  it('opens the retaining walls at the driveway approach', () => {
    const hill = new Hillside(coastalModern, coastalModern.landscape.site!)
    const v = hill.pad[3] + 0.35
    const [drive] = hill.local(6.5, 9)
    expect(Math.abs(hill.heightAt(...hill.world(drive, v)))).toBeLessThan(0.08)
    expect(hill.heightAt(...hill.world(drive - 5, v))).toBeLessThan(-0.55)
  })

  it('keeps a near-coast pad flat at zero grade', () => {
    const hill = new Hillside(cedarRidge, { downhill: 0, grade: 0, oceanDistance: 10 })
    for (const u of [hill.pad[0], 0, hill.pad[2]]) {
      expect(hill.heightAt(...hill.world(u, hill.pad[3]))).toBeCloseTo(0, 5)
    }
  })

  it('cuts a walkout below its selected house face and keeps the front at grade', () => {
    const site = aspenCustom.landscape.site!
    const { drop } = site.walkout!
    const hill = new Hillside(aspenCustom, site)
    const mat = new THREE.MeshStandardMaterial()
    const [terrain] = hill.buildSurface(mat, mat, true).children
    for (const { rect: [x0, z0, x1, z1] } of aspenCustom.blocks.filter(b => b.level === 'lower')) {
      const x = (x0 + x1) / 2
      expect(hill.heightAt(x, z0)).toBeCloseTo(-drop)
      expect(hill.heightAt(x, z0 - 6)).toBeCloseTo(-drop)
      expect(hill.heightAt(x, z1 + 0.07)).toBeCloseTo(0)
      expect(hill.heightAt(x1 + 0.07, (z0 + z1) / 2)).toBeCloseTo(0)
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, (z0 + z1) / 2), new THREE.Vector3(0, -1, 0))
      expect(ray.intersectObject(terrain)[0].point.y).toBeCloseTo(-drop)
    }
    expect(hill.heightAt(0, 2)).toBeCloseTo(0)
    expect(hill.heightAt(-21, 9)).toBeCloseTo(0)
  })

  it('transitions through sea level at the beach and extends the headland out to sea', () => {
    const hill = new Hillside(cedarRidge, { downhill: 0, grade: 0.16, oceanDistance: 200 })
    const beach = shoreline(0, 200)
    expect(beach).toBeCloseTo(200, -1)
    expect(hill.heightAt(...hill.world(0, beach))).toBeCloseTo(hill.seaLevel)
    expect(hill.heightAt(...hill.world(0, beach - 9))).toBeGreaterThan(hill.seaLevel)
    expect(hill.heightAt(...hill.world(0, beach + 9))).toBeLessThan(hill.seaLevel)
    expect(hill.heightAt(...hill.world(-270, beach + 55))).toBeGreaterThan(hill.seaLevel)
  })

  it('builds two retaining faces and a lower-resolution terrain for phones', () => {
    const hill = new Hillside(cedarRidge, { downhill: 0, grade: 0.16, oceanDistance: 190 })
    const mat = new THREE.MeshStandardMaterial()
    const low = hill.buildSurface(mat, mat, true).children as THREE.Mesh[]
    const high = hill.buildSurface(mat, mat, false).children as THREE.Mesh[]
    expect(low[0].geometry.index!.count).toBeLessThan(high[0].geometry.index!.count)
    const wall = low[1].geometry.getAttribute('position')
    const stations = new Set<number>()
    for (let i = 0; i < wall.count; i++) stations.add(Math.round(hill.local(wall.getX(i), wall.getZ(i))[1] * 100))
    expect(stations.size).toBe(4)
  })
})
