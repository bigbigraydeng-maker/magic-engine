import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManualItem } from '../manual-item-types'
import {
  pushAdsAgentStaleItems,
  pushAdsDailyPullbackGapItems,
  pushAdsDailySpendOverCapNoticeItems,
  pushAdsHeartbeatStallItems,
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
    in: () => q,
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
  it('skips when no cap', async () => {
    const items: Parameters<typeof pushAdsDailySpendOverCapNoticeItems>[1] = []
    await pushAdsDailySpendOverCapNoticeItems({} as never, items, () => 'n')
    expect(items).toHaveLength(0)
  })
})

describe('pushAdsHeartbeatStallItems', () => {
  const env = process.env

  afterEach(() => {
    process.env = { ...env }
  })

  it('does not alert when dry and no clients', async () => {
    process.env.AD_HEARTBEAT_MODE = 'dry'
    process.env.AD_HEARTBEAT_CLIENT_IDS = ''
    const items: ManualItem[] = []
    const supabase = { from: () => chain('cron_run_logs', []) }
    await pushAdsHeartbeatStallItems(supabase as never, items, NOW)
    expect(items).toHaveLength(0)
  })

  it('alerts when configured client never succeeds', async () => {
    process.env.AD_HEARTBEAT_MODE = 'dry'
    process.env.AD_HEARTBEAT_CLIENT_IDS = 'c1'
    const items: ManualItem[] = []
    const supabase = { from: () => chain('cron_run_logs', []) }
    await pushAdsHeartbeatStallItems(supabase as never, items, NOW)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('ads_heartbeat_stall')
  })
})

describe('pushAdsDailyPullbackGapItems', () => {
  it('emits per-client gap and skips when stale already on client', async () => {
    const finished = '2026-11-08T09:00:00.000Z'
    const supabase = {
      from: (table: string) => {
        if (table === 'cron_run_logs') {
          return chain(table, [{
            finished_at: finished,
            summary: {
              errors: [
                { client_id: 'c1', source: 'ad_daily', error: 'timeout' },
                { client_id: 'c2', source: 'ad_health', error: 'x' },
              ],
            },
          }])
        }
        return chain(table, [])
      },
    }
    const items: ManualItem[] = [{ kind: 'ads_agent_sync_stale', client_id: 'c1', client_name: 'A', what: 'w', how: 'h', href: 'u' }]
    await pushAdsDailyPullbackGapItems(supabase as never, items, NOW, (id) => `名-${id}`)
    expect(items.filter((i) => i.kind === 'ads_agent_daily_pull_gap').map((i) => i.client_id)).toEqual(['c2'])
  })
})
