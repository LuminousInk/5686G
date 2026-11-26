import type { HomePlan } from '../engine/house/types'
import { aspenCustom } from './aspenCustom'
import { cedarRidge } from './cedarRidge'
import { coastalModern } from './coastalModern'
import { modernFarmhouse } from './modernFarmhouse'
import { woodlandModern } from './woodlandModern'

export const PLANS: HomePlan[] = [cedarRidge, coastalModern, woodlandModern, aspenCustom, modernFarmhouse]

export const planById = (id: string) => PLANS.find(p => p.id === id)
