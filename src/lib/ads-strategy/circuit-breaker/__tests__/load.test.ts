import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadBreakerFacts } from '../load'
import { judgeBreaker } from '../rules'

const NOW = new Date('2026-11-09T00:00:00.000Z')

function sb(tables: Record<string, unknown[]>): SupabaseClient {
  let rows: unknown[] = []
  const api = {
    select: () => api,
    eq: () => api,
    in: () => api,
    gte: () => api,
    lte: () => api,
    order: () => api,
    limit: async () => ({ data: rows, error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  }
  return { from: (table: string) => { rows = tables[table] ?? []; return api } } as unknown as SupabaseClient
}

describe('loadBreakerFacts', () => {
  it('把元为单位的花费换成分，再交给判定，全程不改广告', async () => {
    const facts = await loadBreakerFacts(sb({
      clients: [{
        leads_config: { ads_circuit_breaker: { target_cpl_cents: 100 } },
        meta_ad_account_id: 'act-demo',
      }],
      marketing_plans: [{ status: 'approved', plan_data: { promo: { daily_total_cap_cents: 1000 } } }],
      ad_entity_snapshots: [
        { ad_account_id: 'act-demo', level: 'account', entity_id: 'act-demo', entity_name: '账户', campaign_id: null, adset_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', captured_at: NOW.toISOString(), timezone_name: 'Pacific/Auckland', currency: 'NZD' },
        { ad_account_id: 'act-demo', level: 'campaign', entity_id: 'camp-a', entity_name: '春季系列', campaign_id: 'camp-a', adset_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', captured_at: NOW.toISOString(), timezone_name: null, currency: null },
      ],
      ad_daily_insights: [{
        ad_account_id: 'act-demo', entity_id: 'camp-a', entity_name: '春季系列',
        insight_date: '2026-11-09', spend: 15.5, leads: 0, updated_at: NOW.toISOString(),
      }],
      ad_snapshot_captures: [{ ad_account_id: 'act-demo', level: 'campaign', captured_at: NOW.toISOString(), complete: true, skipped_shared: false }],
    }), 'client-a', NOW)
    expect(facts).not.toBe('unreadable')
    if (facts === 'unreadable') return
    expect(facts.spend[0]?.spendCents).toBe(1550)
    expect(facts.capCents).toBe(1000)
    expect(facts.settings.targetCplCents).toBe(100)
    const judged = judgeBreaker(facts)
    expect(judged.pauses[0]?.rules).toEqual(expect.arrayContaining(['spend_over_cap', 'cpl_zero_leads']))
    expect(judged.pauses.every((item) => item.kind === 'pause')).toBe(true)
  })
})
