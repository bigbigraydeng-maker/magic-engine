import { describe, expect, it } from 'vitest'
import { baseSpec } from './fixtures'
import {
  readApprovedPromoDeliveryStage,
} from '../approved-delivery-stage'

describe('readApprovedPromoDeliveryStage', () => {
  it('promo 已批准但没有 delivery.stage → missing', () => {
    const spec = baseSpec({})
    delete (spec as { delivery?: unknown }).delivery
    const read = readApprovedPromoDeliveryStage([{ plan_data: { promo: spec } }])
    expect(read).toEqual({ kind: 'missing' })
  })

  it('promo 已标阶段 → set', () => {
    const spec = baseSpec({
      delivery: { stage: 'scale', goal: '放量', started_on: '2026-11-01' },
    })
    const read = readApprovedPromoDeliveryStage([{ plan_data: { promo: spec } }])
    expect(read).toEqual({ kind: 'set', stage: 'scale' })
  })

  it('没有 promo 计划 → none', () => {
    expect(readApprovedPromoDeliveryStage([{ plan_data: { tasks: [] } }])).toEqual({ kind: 'none' })
  })
})
