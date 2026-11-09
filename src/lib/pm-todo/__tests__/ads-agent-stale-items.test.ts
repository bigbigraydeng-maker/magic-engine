import { describe, expect, it, vi } from 'vitest'
import { loadClientCapFacts } from '@/lib/ads-strategy/circuit-cap-facts'
import {
  pushAdsAgentStaleItems,
  pushAdsDailySpendOverCapNoticeItems,
} from '../ads-agent-stale-items'

vi.mock('@/lib/meta/client-ad-accounts', () => ({
  getActiveClientsWithMetaAccounts: vi.fn(async () => [
    { id: 'c1', name: '测试客户', meta_ad_account_id: 'act_1' },
  ]),
}))

vi.mock('@/lib/ads-strategy/circuit-cap-facts', () => ({
  loadClientCapFacts: vi.fn(async () => ({
    clientReferenceDate: '2026-11-07',
    accounts: [],
    capCents: null,
    configSource: 'strategy',
  })),
}))

vi.mock('@/lib/ads-strategy/circuit-state', () => ({
  listActiveCircuitTrips: vi.fn(async () => []),
}))

const NOW = new Date('2026-11-08T12:00:00.000Z')

function chain(table: string, rows: unknown[]) {
  const q: Record<string, unknown> = {
    eq: () => q,
    not: () => q,
    gte: () => q,
    order: () => q,
    limit: () => q,
    select: () => q,
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
  }
  return q
}

describe('pushAdsAgentStaleItems', () => {
  it('emits stale item when insights too old', async () => {
    const old = '2026-11-01T00:00:00.000Z'
    const supabase = {
      from: (table: string) => {
        if (table === 'ad_daily_insights') return chain(table, [{ updated_at: old }])
        if (table === 'ad_entity_snapshots') return chain(table, [{ captured_at: old }])
        if (table === 'clients') return chain(table, [])
        if (table === 'prescriptions') return chain(table, [])
        if (table === 'cron_run_logs') return chain(table, [])
        return chain(table, [])
      },
    }
    const items: Parameters<typeof pushAdsAgentStaleItems>[1] = []
    await pushAdsAgentStaleItems(supabase as never, items, NOW, () => 'n')
    expect(items.some((i) => i.kind === 'ads_agent_sync_stale')).toBe(true)
    expect(items[0]?.what).not.toMatch(/\{/)
  })
})

describe('pushAdsDailySpendOverCapNoticeItems', () => {
  it('计划没填每天总上限时，写成一条去广告计划补上的待办', async () => {
    vi.mocked(loadClientCapFacts).mockResolvedValue({
      clientReferenceDate: '2026-11-07',
      accounts: [],
      capCents: null,
      configSource: 'row',
    })
    const items: Parameters<typeof pushAdsDailySpendOverCapNoticeItems>[1] = []
    await pushAdsDailySpendOverCapNoticeItems({} as never, items, () => 'n')
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('ads_plan_daily_cap_missing')
    expect(items[0]?.what).toContain('广告计划')
    expect(items[0]?.href).toContain('/promo-plan')
  })

  it('计划读不出来时不发这条待办', async () => {
    vi.mocked(loadClientCapFacts).mockResolvedValue({
      clientReferenceDate: '2026-11-07',
      accounts: [],
      capCents: null,
      configSource: 'fallback',
    })
    const items: Parameters<typeof pushAdsDailySpendOverCapNoticeItems>[1] = []
    await pushAdsDailySpendOverCapNoticeItems({} as never, items, () => 'n')
    expect(items).toHaveLength(0)
  })
})
