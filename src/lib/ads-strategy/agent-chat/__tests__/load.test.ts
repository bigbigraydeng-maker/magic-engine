import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  registryRows: [] as Array<{ ad_account_id: string; label: string | null; is_primary: boolean; hidden_from_ad_health?: boolean | null }>,
  registryError: null as string | null,
  clientPrimary: null as string | null,
  clientError: null as string | null,
  sharedAll: new Set<string>(),
  sharedLookupError: undefined as string | undefined,
  insightRange: vi.fn(),
  snapshotRange: vi.fn(),
  outcome: { source: 'row' as const, config: { primary: null, leading: null } },
}))

vi.mock('@/lib/meta/client-ad-accounts', () => ({
  findSharedAdAccounts: vi.fn(async (_clientId: string, ids: string[]) => {
    if (h.sharedLookupError) {
      return { shared: new Set(ids.map(id => id.replace(/^act_/, ''))), error: h.sharedLookupError }
    }
    return { shared: new Set(h.sharedAll) }
  }),
}))

vi.mock('@/lib/ads-strategy/portfolio/outcome-config', () => ({
  loadOutcomeConfig: vi.fn(async () => h.outcome),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') {
        const registryPayload = () => (
          h.registryError
            ? { data: null, error: { message: h.registryError } }
            : { data: h.registryRows, error: null }
        )
        return {
          select: () => ({
            eq: () => ({
              order: async () => registryPayload(),
              then: (resolve: (v: unknown) => void) => resolve(registryPayload()),
            }),
          }),
        }
      }
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => (
                h.clientError
                  ? { data: null, error: { message: h.clientError } }
                  : { data: { meta_ad_account_id: h.clientPrimary }, error: null }
              ),
            }),
          }),
        }
      }
      return { select: () => ({ eq: () => ({}) }) }
    },
  },
}))

import { buildInvestigationContext } from '../load'

const supabase = {
  from: (table: string) => {
    if (table === 'ad_daily_insights' || table === 'ad_entity_snapshots') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
              in: () => ({
                order: () => ({
                  order: () => ({
                    range: h.snapshotRange,
                  }),
                }),
              }),
              gte: () => ({
                lte: () => ({
                  order: () => ({
                    range: h.insightRange,
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    }
    return { select: () => ({ eq: () => ({}) }) }
  },
} as never

beforeEach(() => {
  h.registryRows = []
  h.registryError = null
  h.clientPrimary = null
  h.clientError = null
  h.sharedAll = new Set()
  h.sharedLookupError = undefined
  h.snapshotRange = vi.fn(async () => ({ data: [], error: null }))
  h.insightRange = vi.fn(async () => ({ data: [], error: null }))
})

describe('buildInvestigationContext shared accounts', () => {
  it('skips shared accounts and records couldNotRead', async () => {
    h.registryRows = [
      { ad_account_id: 'act_exclusive', label: 'A', is_primary: true },
      { ad_account_id: 'act_shared', label: 'B', is_primary: false },
    ]
    h.sharedAll = new Set(['shared'])

    const ctx = await buildInvestigationContext(supabase, 'client-1')

    expect(ctx.accounts).toHaveLength(1)
    expect(ctx.couldNotRead.some(m => m.includes('与其他客户共用'))).toBe(true)
  })

  it('fail-closed skips all accounts when shared lookup errors', async () => {
    h.registryRows = [{ ad_account_id: 'act_1', label: null, is_primary: true }]
    h.sharedLookupError = 'db down'

    const ctx = await buildInvestigationContext(supabase, 'client-1')

    expect(ctx.accounts).toHaveLength(0)
    expect(ctx.couldNotRead.some(m => m.includes('共用账户查询失败'))).toBe(true)
  })

  it('surfaces account registry read failure', async () => {
    h.registryError = 'timeout'

    const ctx = await buildInvestigationContext(supabase, 'client-1')

    expect(ctx.accounts).toHaveLength(0)
    expect(ctx.couldNotRead.some(m => m.includes('客户广告账户列表读失败'))).toBe(true)
  })
})
