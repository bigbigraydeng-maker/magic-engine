import { describe, expect, it } from 'vitest'
import { reusedSpendGate } from '../draft'
import { goLiveSpendReason } from '../spend-recheck'

const STORED = { dailyBudget: 15, durationDays: null, endTime: '2026-12-01T00:00:00+0000' }

describe('go-live rechecks the existing ad set', () => {
  it('stops when the daily budget or the end time changed, and passes when they match', () => {
    expect(goLiveSpendReason(STORED, { ok: true, campaignId: 'c', spend: STORED })).toBeNull()
    expect(goLiveSpendReason(STORED, {
      ok: true,
      campaignId: 'c',
      spend: { ...STORED, dailyBudget: 100 },
    })).toContain('已经变了')
    expect(goLiveSpendReason(STORED, {
      ok: true,
      campaignId: 'c',
      spend: { dailyBudget: 15, durationDays: null, endTime: null },
    })).toContain('已经变了')
    expect(goLiveSpendReason(null, { ok: false, error: 'unread' })).toContain('还没读到')
    expect(goLiveSpendReason(STORED, { ok: false, error: 'unread' })).toContain('读不到')
  })

  it('only asks for a fresh read when the draft reused an ad set', () => {
    expect(reusedSpendGate({
      status: 'awaiting_approval',
      campaignId: '900001',
      adSetId: '800001',
      adIds: ['ad'],
      draft: { existingAdSetId: '800001', inheritedSpend: STORED },
    })).toEqual({ adSetId: '800001', spend: STORED })
    expect(reusedSpendGate({
      status: 'active',
      draft: { existingAdSetId: 'set', inheritedSpend: STORED },
    })).toEqual({ adSetId: 'set', spend: STORED })
    expect(reusedSpendGate({
      status: 'awaiting_approval',
      draft: { dailyBudget: 15 },
    })).toBeNull()
  })
})
