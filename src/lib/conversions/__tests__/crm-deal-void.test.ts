import { describe, expect, it } from 'vitest'
import { planDealVoid, voidDealMessage, type DealVoidRow } from '../crm-deal-void'

function row(status: string, writebacks: Array<{ id: string; status: string }> = []): DealVoidRow {
  return {
    id: 'outcome-1',
    reviewStatus: status,
    writebacks: writebacks.map((item) => ({ ...item, payloadPreview: null })),
  }
}

describe('planDealVoid', () => {
  it('voids a queued deal and stops its send row', () => {
    const plan = planDealVoid([row('pending_review', [{ id: 'wb-1', status: 'queued' }])])
    expect(plan.voidIds).toEqual(['outcome-1'])
    expect(plan.stopIds).toEqual(['wb-1'])
    expect(plan.flagIds).toEqual([])
    expect(voidDealMessage(plan)).toContain('已作废')
    expect(voidDealMessage(plan)).not.toContain('已经发给')
  })

  it('leaves a confirmed send and does not void the deal', () => {
    const plan = planDealVoid([row('approved', [{ id: 'wb-1', status: 'confirmed' }])])
    expect(plan.voidIds).toEqual([])
    expect(plan.stopIds).toEqual([])
    expect(plan.confirmed).toBe(true)
    expect(voidDealMessage(plan)).toContain('已经发给广告平台')
    expect(voidDealMessage(plan)).toContain('撤不回来')
  })

  it('leaves an in-doubt send without calling it already delivered', () => {
    const plan = planDealVoid([row('approved', [{ id: 'wb-1', status: 'in_doubt' }])])
    expect(plan.voidIds).toEqual([])
    expect(plan.maybeSent).toBe(true)
    expect(voidDealMessage(plan)).toContain('可能已经发给')
    expect(voidDealMessage(plan)).not.toContain('已经发给广告平台的成交留着')
  })
})
