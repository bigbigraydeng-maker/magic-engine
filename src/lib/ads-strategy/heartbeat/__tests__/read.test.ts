import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { readHeartbeatAccount, parseBudgetMinor, toMinorUnits } from '../read'
import type { HeartbeatFetchers } from '../read'

import type {
  GraphHeartbeatAccount,
  GraphHeartbeatAd,
  GraphHeartbeatAdset,
  GraphHeartbeatInsightRow,
  GraphReadResult,
} from '@/lib/meta/entity-settings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResult<T>(rows: T[]): GraphReadResult<T> {
  return { rows, complete: true, error: null }
}

function failResult<T>(code: number, status = 400): GraphReadResult<T> {
  return { rows: [], complete: false, error: { status, code, message: 'x' } }
}

const defaultAccount: GraphHeartbeatAccount = {
  id: 'act_1',
  account_status: 1,
  disable_reason: 0,
  currency: 'NZD',
  timezone_name: 'Pacific/Auckland',
}

const defaultAdsets: GraphHeartbeatAdset[] = [
  {
    id: 'a1',
    campaign_id: 'c1',
    effective_status: 'ACTIVE',
    daily_budget: '7500',
    created_time: '2026-10-21T00:00:00Z',
    start_time: '2026-10-21T00:00:00Z',
    updated_time: '2026-10-21T00:00:00Z',
  },
  {
    id: 'a2',
    campaign_id: 'c2',
    effective_status: 'ACTIVE',
    created_time: '2026-10-21T00:00:00Z',
  },
]

const defaultAds: GraphHeartbeatAd[] = [
  { id: 'ad1', adset_id: 'a1', effective_status: 'ACTIVE' },
]

const defaultInsights: GraphHeartbeatInsightRow[] = [
  { adset_id: 'a1', spend: '12.34', impressions: '500' },
]

interface FetcherOverrides {
  account?: HeartbeatFetchers['account']
  adsets?: HeartbeatFetchers['adsets']
  ads?: HeartbeatFetchers['ads']
  insights?: HeartbeatFetchers['insights']
}

function makeFetchers(overrides: FetcherOverrides = {}): HeartbeatFetchers {
  return {
    account:
      overrides.account ??
      vi.fn(async () => okResult<GraphHeartbeatAccount>([defaultAccount])),
    adsets:
      overrides.adsets ??
      vi.fn(async () => okResult<GraphHeartbeatAdset>(defaultAdsets)),
    ads:
      overrides.ads ??
      vi.fn(async () => okResult<GraphHeartbeatAd>(defaultAds)),
    insights:
      overrides.insights ??
      vi.fn(async () => okResult<GraphHeartbeatInsightRow>(defaultInsights)),
  }
}

const now = new Date('2026-10-21T12:30:00Z')

function makeArgs(fetchers: HeartbeatFetchers, accountHasActiveCampaigns = true) {
  return {
    adAccountId: 'act_1',
    accessToken: 'tok',
    now,
    accountHasActiveCampaigns,
    fetchers,
  }
}

function outcomeFor(
  outcomes: { kind: string; verdict: string; reason: string }[],
  kind: string,
) {
  return outcomes.find((o) => o.kind === kind)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('readHeartbeatAccount', () => {
  it('happy path: reads all four steps and maps samples', async () => {
    const fetchers = makeFetchers()
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    expect(result.callCount).toBe(4)
    expect(result.accountDay).toBe('2026-10-22')
    expect(result.timezone).toBe('Pacific/Auckland')
    expect(result.currency).toBe('NZD')
    expect(result.anyFailure).toBe(false)
    expect(result.abortedBy).toBeNull()

    expect(fetchers.insights).toHaveBeenCalledWith('act_1', 'tok', '2026-10-22')

    const a1 = result.adsets.find((a) => a.adsetId === 'a1')!
    expect(a1.budgetLevel).toBe('adset')
    expect(a1.dailyBudgetMinor).toBe(7500)
    expect(a1.spendTodayMinor).toBe(1234)
    expect(a1.impressionsToday).toBe(500)

    const a2 = result.adsets.find((a) => a.adsetId === 'a2')!
    expect(a2.budgetLevel).toBe('campaign')
    expect(a2.dailyBudgetMinor).toBeNull()
    expect(a2.spendTodayMinor).toBe(0)
    expect(a2.impressionsToday).toBe(0)

    expect(result.ads).toHaveLength(1)
    expect(result.ads[0].adId).toBe('ad1')
  })

  it('token expired on account read aborts the sequence', async () => {
    const fetchers = makeFetchers({
      account: vi.fn(async () => failResult<GraphHeartbeatAccount>(190)),
    })
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    expect(result.abortedBy).toBe('token_expired')
    expect(result.callCount).toBe(1)
    expect(fetchers.adsets).not.toHaveBeenCalled()
    expect(fetchers.ads).not.toHaveBeenCalled()
    expect(fetchers.insights).not.toHaveBeenCalled()

    for (const kind of ['adsets', 'ads', 'insights']) {
      const o = outcomeFor(result.outcomes, kind)!
      expect(o.verdict).toBe('skipped')
      expect(o.reason).toBe('aborted_by_token_expired')
    }
  })

  it('rate limited on adsets read aborts ads and insights', async () => {
    const fetchers = makeFetchers({
      adsets: vi.fn(async () => failResult<GraphHeartbeatAdset>(17)),
    })
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    expect(result.abortedBy).toBe('rate_limited')
    expect(result.callCount).toBe(2)
    expect(fetchers.ads).not.toHaveBeenCalled()
    expect(fetchers.insights).not.toHaveBeenCalled()

    for (const kind of ['ads', 'insights']) {
      const o = outcomeFor(result.outcomes, kind)!
      expect(o.verdict).toBe('skipped')
      expect(o.reason).toBe('aborted_by_rate_limited')
    }
  })

  it('account read failure: no timezone, insights skipped, spend unknown', async () => {
    const fetchers = makeFetchers({
      account: vi.fn(async () => failResult<GraphHeartbeatAccount>(100)),
    })
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    expect(result.timezone).toBeNull()
    expect(result.accountDay).toBeNull()
    expect(fetchers.adsets).toHaveBeenCalled()
    expect(fetchers.ads).toHaveBeenCalled()
    expect(fetchers.insights).not.toHaveBeenCalled()

    const insightsOutcome = outcomeFor(result.outcomes, 'insights')!
    expect(insightsOutcome.verdict).toBe('skipped')
    expect(insightsOutcome.reason).toBe('no_timezone')

    for (const a of result.adsets) {
      expect(a.spendTodayMinor).toBeNull()
      expect(a.impressionsToday).toBeNull()
    }
    expect(result.anyFailure).toBe(true)
  })

  it('empty adset list is read_failed only when account has active campaigns', async () => {
    const emptyFetchers = makeFetchers({
      adsets: vi.fn(async () => okResult<GraphHeartbeatAdset>([])),
    })
    const failed = await readHeartbeatAccount(makeArgs(emptyFetchers, true))
    expect(outcomeFor(failed.outcomes, 'adsets')!.verdict).toBe('read_failed')
    expect(failed.anyFailure).toBe(true)

    const okFetchers = makeFetchers({
      adsets: vi.fn(async () => okResult<GraphHeartbeatAdset>([])),
    })
    const ok = await readHeartbeatAccount(makeArgs(okFetchers, false))
    expect(outcomeFor(ok.outcomes, 'adsets')!.verdict).toBe('ok')
    expect(ok.anyFailure).toBe(false)
  })

  it('insights read failure leaves spend/impressions unknown', async () => {
    const fetchers = makeFetchers({
      insights: vi.fn(async () => failResult<GraphHeartbeatInsightRow>(100)),
    })
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    expect(result.anyFailure).toBe(true)
    for (const a of result.adsets) {
      expect(a.spendTodayMinor).toBeNull()
      expect(a.impressionsToday).toBeNull()
    }
    const a1 = result.adsets.find((a) => a.adsetId === 'a1')!
    expect(a1.dailyBudgetMinor).toBe(7500)
    expect(a1.effectiveStatus).toBe('ACTIVE')
  })

  it('ads read failure yields empty ads and anyFailure', async () => {
    const fetchers = makeFetchers({
      ads: vi.fn(async () => failResult<GraphHeartbeatAd>(100)),
    })
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    expect(result.ads).toEqual([])
    expect(result.anyFailure).toBe(true)
  })

  it('incomplete adsets read is read_failed', async () => {
    const fetchers = makeFetchers({
      adsets: vi.fn(async () => ({
        rows: [defaultAdsets[0]],
        complete: false,
        error: { status: 500, code: 1, message: 'x' },
      })),
    })
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    expect(outcomeFor(result.outcomes, 'adsets')!.verdict).toBe('read_failed')
    expect(result.anyFailure).toBe(true)
  })

  it('lifetime budget adset has no daily budget', async () => {
    const fetchers = makeFetchers({
      adsets: vi.fn(async () =>
        okResult<GraphHeartbeatAdset>([
          {
            id: 'a1',
            campaign_id: 'c1',
            effective_status: 'ACTIVE',
            lifetime_budget: '100000',
          },
        ]),
      ),
    })
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    const a1 = result.adsets[0]
    expect(a1.hasLifetimeBudget).toBe(true)
    expect(a1.dailyBudgetMinor).toBeNull()
  })

  it('detects delivery schedule presence', async () => {
    const fetchers = makeFetchers({
      adsets: vi.fn(async () =>
        okResult<GraphHeartbeatAdset>([
          {
            id: 'a1',
            campaign_id: 'c1',
            effective_status: 'ACTIVE',
            adset_schedule: [{ days: [1], start_minute: 0, end_minute: 60 }],
          },
          {
            id: 'a2',
            campaign_id: 'c2',
            effective_status: 'ACTIVE',
            adset_schedule: [],
          },
          {
            id: 'a3',
            campaign_id: 'c3',
            effective_status: 'ACTIVE',
          },
        ]),
      ),
    })
    const result = await readHeartbeatAccount(makeArgs(fetchers))

    expect(result.adsets.find((a) => a.adsetId === 'a1')!.hasDeliverySchedule).toBe(true)
    expect(result.adsets.find((a) => a.adsetId === 'a2')!.hasDeliverySchedule).toBe(false)
    expect(result.adsets.find((a) => a.adsetId === 'a3')!.hasDeliverySchedule).toBe(false)
  })

  it('issues at most four fetcher calls per round', async () => {
    const fetchers = makeFetchers()
    await readHeartbeatAccount(makeArgs(fetchers))

    const total =
      vi.mocked(fetchers.account).mock.calls.length +
      vi.mocked(fetchers.adsets).mock.calls.length +
      vi.mocked(fetchers.ads).mock.calls.length +
      vi.mocked(fetchers.insights).mock.calls.length
    expect(total).toBeLessThanOrEqual(4)
  })
})

describe('parseBudgetMinor', () => {
  it('parses minor-unit budget strings', () => {
    expect(parseBudgetMinor('7500')).toBe(7500)
    expect(parseBudgetMinor('0')).toBeNull()
    expect(parseBudgetMinor('-5')).toBeNull()
    expect(parseBudgetMinor('abc')).toBeNull()
    expect(parseBudgetMinor(undefined)).toBeNull()
  })
})

describe('toMinorUnits', () => {
  it('converts major units to minor units by currency', () => {
    expect(toMinorUnits('12.34', 'NZD')).toBe(1234)
    expect(toMinorUnits('12.34', 'JPY')).toBe(12)
    expect(toMinorUnits('abc', 'NZD')).toBeNull()
    expect(toMinorUnits(undefined, 'NZD')).toBeNull()
    expect(toMinorUnits('0', 'NZD')).toBe(0)
  })
})
