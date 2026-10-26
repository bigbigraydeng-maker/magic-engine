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

describe('readLiveDeliveringProd', () => {
  it('happy path: returns delivering budget and passes token to adsets fetcher', async () => {
    const fetchers = makeFetchers({})
    const resolveToken = vi.fn(async () => ({ token: 'tok123' }))

    const result = await readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers })

    expect(result).toEqual(
      expect.objectContaining({ minor: 3000, incomplete: false, currency: 'NZD' }),
    )
    expect(fetchers.adsets).toHaveBeenCalledWith('act_1', 'tok123')
  })

  it('resolveToken returns null -> null and no fetcher called', async () => {
    const fetchers = makeFetchers({})
    const resolveToken = vi.fn(async () => null)

    const result = await readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers })

    expect(result).toBeNull()
    expect(fetchers.account).not.toHaveBeenCalled()
    expect(fetchers.adsets).not.toHaveBeenCalled()
    expect(fetchers.ads).not.toHaveBeenCalled()
    expect(fetchers.insights).not.toHaveBeenCalled()
  })

  it('resolveToken throws -> null (does not reject)', async () => {
    const fetchers = makeFetchers({})
    const resolveToken = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(
      readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers }),
    ).resolves.toBeNull()
  })

  it('adsets fetcher returns incomplete result -> null', async () => {
    const fetchers = makeFetchers({
      adsets: vi.fn(
        async (): Promise<GraphReadResult<GraphHeartbeatAdset>> => ({
          rows: [],
          complete: false,
          error: { status: 500, code: null, message: 'x' },
        }),
      ),
    })
    const resolveToken = vi.fn(async () => ({ token: 'tok123' }))

    const result = await readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers })

    expect(result).toBeNull()
  })

  it('every fetcher rejects -> resolves to null (does not reject)', async () => {
    const reject = async (): Promise<never> => {
      throw new Error('net')
    }
    const fetchers = makeFetchers({
      account: vi.fn(reject),
      adsets: vi.fn(reject),
      ads: vi.fn(reject),
      insights: vi.fn(reject),
    })
    const resolveToken = vi.fn(async () => ({ token: 'tok123' }))

    await expect(
      readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers }),
    ).resolves.toBeNull()
  })

  it('slow fetchers with timeoutMs=50 -> null and returns quickly', async () => {
    const fetchers = makeFetchers({
      adsets: vi.fn(
        (): Promise<GraphReadResult<GraphHeartbeatAdset>> =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve(
                  okResult<GraphHeartbeatAdset>([
                    {
                      id: 'a1',
                      campaign_id: 'c1',
                      effective_status: 'ACTIVE',
                      daily_budget: '3000',
                    },
                  ]),
                ),
              400,
            )
          }),
      ),
    })
    const resolveToken = vi.fn(async () => ({ token: 'tok123' }))

    const start = performance.now()
    const result = await readLiveDeliveringProd('c1', 'act_1', {
      resolveToken,
      fetchers,
      timeoutMs: 50,
    })
    const elapsed = performance.now() - start

    expect(result).toBeNull()
    expect(elapsed).toBeLessThan(300)
  })

  it('returned value never contains the token', async () => {
    const fetchers = makeFetchers({})
    const resolveToken = vi.fn(async () => ({ token: 'tok123' }))

    const result = await readLiveDeliveringProd('c1', 'act_1', { resolveToken, fetchers })

    expect(JSON.stringify(result)).not.toContain('tok123')
  })
})
