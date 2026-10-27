import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { liveDeliveringFromRead } from '../live-delivering'
import type {
  HeartbeatAccountRead,
  HeartbeatAdsetSample,
} from '@/lib/ads-strategy/heartbeat/read'

function adset(over: Partial<HeartbeatAdsetSample>): HeartbeatAdsetSample {
  return {
    adsetId: 'a1',
    campaignId: 'c1',
    name: null,
    effectiveStatus: 'ACTIVE',
    budgetLevel: 'adset',
    dailyBudgetMinor: 1000,
    hasLifetimeBudget: false,
    createdTime: null,
    startTime: null,
    updatedTime: null,
    hasDeliverySchedule: false,
    isDynamicCreative: false,
    spendTodayMinor: null,
    impressionsToday: null,
    ...over,
  }
}

function read(over: Partial<HeartbeatAccountRead>): HeartbeatAccountRead {
  return {
    adAccountId: 'act_1',
    sampledAtIso: '2026-10-26T03:00:00Z',
    accountDay: null,
    timezone: null,
    currency: 'NZD',
    accountStatus: 1,
    disableReason: 0,
    adsets: [],
    ads: [],
    outcomes: [
      { kind: 'account', verdict: 'ok', reason: '', errorCode: null },
      { kind: 'adsets', verdict: 'ok', reason: '', errorCode: null },
    ],
    abortedBy: null,
    callCount: 2,
    anyFailure: false,
    ...over,
  }
}

describe('liveDeliveringFromRead', () => {
  it('sums daily budgets of two ACTIVE adsets', () => {
    const result = liveDeliveringFromRead(
      read({
        adsets: [
          adset({ adsetId: 'a1', dailyBudgetMinor: 1000 }),
          adset({ adsetId: 'a2', dailyBudgetMinor: 2500 }),
        ],
      }),
    )

    expect(result).toEqual({
      minor: 3500,
      incomplete: false,
      readAtIso: '2026-10-26T03:00:00Z',
      currency: 'NZD',
    })
  })

  it('ignores PAUSED adsets', () => {
    const result = liveDeliveringFromRead(
      read({
        adsets: [
          adset({
            adsetId: 'a1',
            effectiveStatus: 'PAUSED',
            dailyBudgetMinor: 9999,
          }),
          adset({ adsetId: 'a2', dailyBudgetMinor: 1000 }),
        ],
      }),
    )

    expect(result).toEqual({
      minor: 1000,
      incomplete: false,
      readAtIso: '2026-10-26T03:00:00Z',
      currency: 'NZD',
    })
  })

  it('marks incomplete when an ACTIVE adset uses campaign budget', () => {
    const result = liveDeliveringFromRead(
      read({
        adsets: [
          adset({
            adsetId: 'a1',
            budgetLevel: 'campaign',
            dailyBudgetMinor: null,
          }),
          adset({ adsetId: 'a2', dailyBudgetMinor: 1000 }),
        ],
      }),
    )

    expect(result).toEqual({
      minor: 1000,
      incomplete: true,
      readAtIso: '2026-10-26T03:00:00Z',
      currency: 'NZD',
    })
  })

  it('marks incomplete when an ACTIVE adset has a null daily budget', () => {
    const result = liveDeliveringFromRead(
      read({
        adsets: [
          adset({
            adsetId: 'a1',
            budgetLevel: 'adset',
            dailyBudgetMinor: null,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      minor: 0,
      incomplete: true,
      readAtIso: '2026-10-26T03:00:00Z',
      currency: 'NZD',
    })
  })

  it('returns null when the adsets outcome verdict is read_failed', () => {
    const result = liveDeliveringFromRead(
      read({
        outcomes: [
          { kind: 'account', verdict: 'ok', reason: '', errorCode: null },
          {
            kind: 'adsets',
            verdict: 'read_failed',
            reason: '',
            errorCode: null,
          },
        ],
      }),
    )

    expect(result).toBeNull()
  })

  it('returns null when there is no adsets outcome', () => {
    const result = liveDeliveringFromRead(
      read({
        outcomes: [
          { kind: 'account', verdict: 'ok', reason: '', errorCode: null },
        ],
      }),
    )

    expect(result).toBeNull()
  })

  it('returns null when the read was aborted', () => {
    const result = liveDeliveringFromRead(
      read({
        abortedBy: 'token_expired',
        adsets: [adset({ adsetId: 'a1', dailyBudgetMinor: 1000 })],
      }),
    )

    expect(result).toBeNull()
  })

  it('counts IN_PROCESS and WITH_ISSUES adsets', () => {
    const result = liveDeliveringFromRead(
      read({
        adsets: [
          adset({
            adsetId: 'a1',
            effectiveStatus: 'IN_PROCESS',
            dailyBudgetMinor: 500,
          }),
          adset({
            adsetId: 'a2',
            effectiveStatus: 'WITH_ISSUES',
            dailyBudgetMinor: 500,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      minor: 1000,
      incomplete: false,
      readAtIso: '2026-10-26T03:00:00Z',
      currency: 'NZD',
    })
  })

  it('ignores adsets with a null effective status', () => {
    const result = liveDeliveringFromRead(
      read({
        adsets: [
          adset({
            adsetId: 'a1',
            effectiveStatus: null,
            dailyBudgetMinor: 1000,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      minor: 0,
      incomplete: false,
      readAtIso: '2026-10-26T03:00:00Z',
      currency: 'NZD',
    })
  })

  it('(pure function) returns minor 0 when the adsets step is ok and no adset is ACTIVE', () => {
    const result = liveDeliveringFromRead(read({ adsets: [] }))

    expect(result).toEqual({
      minor: 0,
      incomplete: false,
      readAtIso: '2026-10-26T03:00:00Z',
      currency: 'NZD',
    })
  })
})
