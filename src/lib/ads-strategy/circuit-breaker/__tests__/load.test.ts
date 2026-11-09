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
      ad_strategy_configs: [{ primary_result: 'lead', target_cost_per_primary: null }],
      marketing_plans: [{ status: 'approved', plan_data: { promo: { daily_total_cap_cents: 1000 } } }],
      ad_entity_snapshots: [
        { ad_account_id: 'act-demo', level: 'account', entity_id: 'act-demo', entity_name: '账户', campaign_id: null, adset_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', captured_at: NOW.toISOString(), timezone_name: 'Pacific/Auckland', currency: 'NZD' },
        { ad_account_id: 'act-demo', level: 'campaign', entity_id: 'camp-a', entity_name: '春季系列', campaign_id: 'camp-a', adset_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', captured_at: NOW.toISOString(), timezone_name: null, currency: null },
      ],
      ad_daily_insights: [{
        ad_account_id: 'act-demo', entity_id: 'camp-a', entity_name: '春季系列',
        insight_date: '2026-11-09', spend: 15.5, leads: 0, messaging_conversations: 4, updated_at: NOW.toISOString(),
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
    expect(facts.primaryResult).toBe('lead')
    expect(facts.spend[0]?.primaryCount).toBe(0)
  })

  it('开聊客户留资为 0、开聊大于 0 时不出没有结果的暂停卡', async () => {
    const judged = await judgeLoaded({ primary: 'messaging_started', leads: 0, messaging: 4, spend: 2.5 })
    expect(judged.pauses).toEqual([])
    expect(judged.alerts.map((item) => item.code)).not.toContain('primary_unreadable')
  })

  it('开聊客户开聊为 0 且花费超过目标倍数时出暂停卡', async () => {
    const judged = await judgeLoaded({ primary: 'messaging_started', leads: 0, messaging: 0, spend: 2.5 })
    expect(judged.pauses.map((item) => item.rules)).toEqual([['cpl_zero_leads']])
  })

  it('留资客户只看留资，开聊数不影响原来的暂停卡', async () => {
    const judged = await judgeLoaded({ primary: 'lead', leads: 0, messaging: 4, spend: 2.5 })
    expect(judged.pauses.map((item) => item.rules)).toEqual([['cpl_zero_leads']])
    expect(judged.pauses[0]?.summary).toContain('没有线索')
  })

  it('主结果读不出来时不出暂停卡，缺的数也不当成 0', async () => {
    const unknown = await judgeLoaded({ primary: 'qualified_enquiry', leads: 0, messaging: 0, spend: 2.5 })
    const missing = await judgeLoaded({ primary: 'messaging_started', leads: 0, messaging: null, spend: 2.5 })
    expect(unknown.pauses).toEqual([])
    expect(missing.pauses).toEqual([])
    expect(unknown.alerts.map((item) => item.code)).toEqual(['primary_unreadable'])
    expect(missing.alerts.map((item) => item.code)).toEqual(['primary_unreadable'])
  })
})

async function judgeLoaded(input: { primary: unknown; leads: number | null; messaging: number | null; spend: number }) {
  const facts = await loadBreakerFacts(sb({
    clients: [{
      leads_config: { ads_circuit_breaker: { target_cpl_cents: 100 } },
      meta_ad_account_id: 'act-demo',
    }],
    ad_strategy_configs: [{ primary_result: input.primary, target_cost_per_primary: null }],
    marketing_plans: [{ status: 'approved', plan_data: { promo: { daily_total_cap_cents: 1000 } } }],
    ad_entity_snapshots: [
      { ad_account_id: 'act-demo', level: 'account', entity_id: 'act-demo', entity_name: '账户', campaign_id: null, adset_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', captured_at: NOW.toISOString(), timezone_name: 'Pacific/Auckland', currency: 'NZD' },
      { ad_account_id: 'act-demo', level: 'campaign', entity_id: 'camp-a', entity_name: '春季系列', campaign_id: 'camp-a', adset_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', captured_at: NOW.toISOString(), timezone_name: null, currency: null },
    ],
    ad_daily_insights: [{
      ad_account_id: 'act-demo', entity_id: 'camp-a', entity_name: '春季系列',
      insight_date: '2026-11-09', spend: input.spend, leads: input.leads, messaging_conversations: input.messaging, updated_at: NOW.toISOString(),
    }],
    ad_snapshot_captures: [{ ad_account_id: 'act-demo', level: 'campaign', captured_at: NOW.toISOString(), complete: true, skipped_shared: false }],
  }), 'client-a', NOW)
  if (facts === 'unreadable') throw new Error('fixture unreadable')
  return judgeBreaker(facts)
}
