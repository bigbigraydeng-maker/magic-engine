import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/marketing-plan/promo/facts', () => ({ loadOwnedAccounts: vi.fn() }))
vi.mock('@/lib/marketing-plan/promo/playbooks', () => ({ resolvePromoPlaybook: vi.fn() }))
vi.mock('@/lib/ads-strategy/promo-draft-facts', () => ({ loadAdsDraftFacts: vi.fn() }))
vi.mock('@/lib/meta/lead-forms', () => ({ fetchPageLeadForms: vi.fn() }))
vi.mock('@/lib/meta/graph-base', () => ({ GRAPH_BASE: 'https://graph.example.test/v99.0' }))
vi.mock('@/lib/meta/page-posts', () => ({ getPageAccessToken: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({
  getStoredPageToken: vi.fn(),
  resolveMetaTokenForClient: vi.fn(async () => ({
    token: 'EAABsecretTOKEN1234567890abcdef',
    source: 'client_db',
  })),
}))

import { readLiveDeliveringProd } from '../deps'
import type { HeartbeatFetchers } from '@/lib/ads-strategy/heartbeat/read'
import type {
  GraphReadResult,
  GraphHeartbeatAccount,
  GraphHeartbeatAdset,
  GraphHeartbeatAd,
  GraphHeartbeatInsightRow,
} from '@/lib/meta/entity-settings'

function okResult<T>(rows: T[]): GraphReadResult<T> {
  return { rows, complete: true, error: null }
}

function makeFetchers(over: Partial<HeartbeatFetchers>): HeartbeatFetchers {
  return {
    account: vi.fn(
      async (): Promise<GraphReadResult<GraphHeartbeatAccount>> =>
        okResult<GraphHeartbeatAccount>([
          {
            id: 'act_1',
            account_status: 1,
            disable_reason: 0,
            currency: 'NZD',
            timezone_name: 'Pacific/Auckland',
          },
        ]),
    ),
    adsets: vi.fn(
      async (): Promise<GraphReadResult<GraphHeartbeatAdset>> =>
        okResult<GraphHeartbeatAdset>([
          {
            id: 'a1',
            campaign_id: 'c1',
            effective_status: 'ACTIVE',
            daily_budget: '3000',
          },
        ]),
    ),
    ads: vi.fn(
      async (): Promise<GraphReadResult<GraphHeartbeatAd>> => okResult<GraphHeartbeatAd>([]),
    ),
    insights: vi.fn(
      async (): Promise<GraphReadResult<GraphHeartbeatInsightRow>> =>
        okResult<GraphHeartbeatInsightRow>([]),
    ),
    ...over,
  }
}

describe('readLiveDeliveringProd round 2', () => {
  it('P3 only account and adsets are called, once each', async () => {
    const fetchers = makeFetchers({
      ads: vi.fn(
        async (): Promise<GraphReadResult<GraphHeartbeatAd>> =>
          okResult<GraphHeartbeatAd>([
            { id: 'ad1', adset_id: 'a1', effective_status: 'ACTIVE' },
          ]),
      ),
      insights: vi.fn(
        async (): Promise<GraphReadResult<GraphHeartbeatInsightRow>> =>
          okResult<GraphHeartbeatInsightRow>([
            { adset_id: 'a1', spend: '1.00', impressions: '10' },
          ]),
      ),
    })
    const resolveToken = vi.fn(async () => ({ token: 'tok123' }))

    const result = await readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers })

    expect(result).toEqual(
      expect.objectContaining({ minor: 3000, incomplete: false, currency: 'NZD' }),
    )
    expect(fetchers.account).toHaveBeenCalledTimes(1)
    expect(fetchers.adsets).toHaveBeenCalledTimes(1)
    expect(fetchers.ads).toHaveBeenCalledTimes(0)
    expect(fetchers.insights).toHaveBeenCalledTimes(0)

    const totalCalls =
      vi.mocked(fetchers.account).mock.calls.length +
      vi.mocked(fetchers.adsets).mock.calls.length +
      vi.mocked(fetchers.ads).mock.calls.length +
      vi.mocked(fetchers.insights).mock.calls.length
    expect(totalCalls).toBe(2)
  })

  it('S5 an empty adsets list is "did not read", not a real zero', async () => {
    const fetchers = makeFetchers({
      adsets: vi.fn(
        async (): Promise<GraphReadResult<GraphHeartbeatAdset>> =>
          okResult<GraphHeartbeatAdset>([]),
      ),
    })
    const resolveToken = vi.fn(async () => ({ token: 'tok123' }))

    const result = await readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers })

    expect(result).toBeNull()
  })

  it('S5 account fetcher fails -> currency unknown (build layer then falls back to the snapshot)', async () => {
    const fetchers = makeFetchers({
      account: vi.fn(
        async (): Promise<GraphReadResult<GraphHeartbeatAccount>> => ({
          rows: [],
          complete: false,
          error: { status: 500, code: null, message: 'x' },
        }),
      ),
    })
    const resolveToken = vi.fn(async () => ({ token: 'tok123' }))

    const result = await readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers })

    expect(result?.currency ?? null).toBeNull()
  })
})
