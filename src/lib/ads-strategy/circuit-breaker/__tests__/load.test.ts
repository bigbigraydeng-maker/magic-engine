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
    limit: async (n: number) => ({ data: rows.slice(0, n), error: null }),
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
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

describe('account staleness does not swallow other accounts', () => {
  const old = new Date(NOW.getTime() - 30 * 24 * 3_600_000).toISOString()

  it('闲置账户快照再旧、上面还有在投标记，也不挡住在投账户的暂停卡', async () => {
    const facts = await loadBreakerFacts(sb(tables({
      snaps: [
        accountSnap('act-live', NOW.toISOString()),
        campaignSnap('act-idle', 'camp-idle', 'ACTIVE', old),
        adSnap('act-idle', 'camp-idle', 'ad-idle', 'ACTIVE', 'DISAPPROVED', old),
        campaignSnap('act-live', 'camp-live', 'ACTIVE', NOW.toISOString()),
        adSnap('act-live', 'camp-live', 'ad-live', 'ACTIVE', 'ACTIVE', NOW.toISOString()),
      ],
      captures: [
        capture('act-idle', 'campaign', old),
        capture('act-idle', 'ad', old),
        capture('act-live', 'account', NOW.toISOString()),
        capture('act-live', 'campaign', NOW.toISOString()),
        capture('act-live', 'ad', NOW.toISOString()),
      ],
      insights: [insight('act-live', 'camp-live', NOW.toISOString(), 2.5, 1)],
    })), 'client-a', NOW)
    if (facts === 'unreadable') throw new Error('fixture unreadable')
    expect(facts.deliveringAccounts).toEqual(['act-live'])
    const judged = judgeBreaker(facts)
    expect(judged.pauses.map((item) => item.campaignId)).toEqual(['camp-live'])
    expect(judged.pauses[0]?.rules).toEqual(['cpl_over_target'])
    expect(judged.alerts.map((item) => item.code)).not.toContain('stale')
  })

  it('在投账户数据过期只压住它自己的卡，并留下提醒', async () => {
    const staleAt = new Date(NOW.getTime() - 13 * 3_600_000).toISOString()
    const facts = await loadBreakerFacts(sb(tables({
      snaps: [
        accountSnap('act-fresh', NOW.toISOString()),
        campaignSnap('act-stale', 'camp-stale', 'ACTIVE', staleAt),
        adSnap('act-stale', 'camp-stale', 'ad-stale', 'ACTIVE', 'ACTIVE', staleAt),
        campaignSnap('act-fresh', 'camp-fresh', 'ACTIVE', NOW.toISOString()),
        adSnap('act-fresh', 'camp-fresh', 'ad-fresh', 'ACTIVE', 'ACTIVE', NOW.toISOString()),
      ],
      captures: [
        capture('act-stale', 'campaign', staleAt),
        capture('act-stale', 'ad', staleAt),
        capture('act-fresh', 'account', NOW.toISOString()),
        capture('act-fresh', 'campaign', NOW.toISOString()),
        capture('act-fresh', 'ad', NOW.toISOString()),
      ],
      insights: [
        insight('act-stale', 'camp-stale', staleAt, 2.5, 1),
        insight('act-fresh', 'camp-fresh', NOW.toISOString(), 2.5, 1),
      ],
    })), 'client-a', NOW)
    if (facts === 'unreadable') throw new Error('fixture unreadable')
    expect(facts.deliveringAccounts).toEqual(expect.arrayContaining(['act-stale', 'act-fresh']))
    const judged = judgeBreaker(facts)
    expect(judged.pauses.map((item) => item.campaignId)).toEqual(['camp-fresh'])
    expect(judged.alerts).toEqual([expect.objectContaining({ code: 'stale', accountId: 'act-stale' })])
  })
})

describe('snapshot completeness', () => {
  it('超过 500 行历史快照时，仍按最新一次抓全判断，不报设置读不全', async () => {
    const latest = NOW.toISOString()
    const older = new Date(NOW.getTime() - 20 * 24 * 3_600_000).toISOString()
    const ads = Array.from({ length: 500 }, (_, index) => adSnap('act-live', 'camp-a', `ad-${String(index).padStart(3, '0')}`, 'ACTIVE', 'ACTIVE', latest))
    ads.push(adSnap('act-live', 'camp-a', 'ad-zzz', 'ACTIVE', 'DISAPPROVED', latest))
    const history = Array.from({ length: 200 }, (_, index) => adSnap('act-live', 'camp-old', `old-${index}`, 'PAUSED', 'PAUSED', older))
    const facts = await loadBreakerFacts(strictSb({
      clients: [{ id: 'client-a', leads_config: { ads_circuit_breaker: { target_cpl_cents: 100 } }, meta_ad_account_id: 'act-live' }],
      ad_strategy_configs: [{ client_id: 'client-a', primary_result: 'lead', target_cost_per_primary: null }],
      marketing_plans: [{ client_id: 'client-a', status: 'approved', plan_data: { promo: { daily_total_cap_cents: 1000 } } }],
      ad_entity_snapshots: [
        accountSnap('act-live', latest),
        campaignSnap('act-live', 'camp-a', 'ACTIVE', latest),
        ...ads,
        ...history,
      ],
      ad_snapshot_captures: [
        capture('act-live', 'ad', older),
        capture('act-live', 'campaign', older),
        capture('act-live', 'account', latest),
        capture('act-live', 'campaign', latest),
        capture('act-live', 'ad', latest),
      ],
      ad_daily_insights: [insight('act-live', 'camp-a', latest, 1, 1)],
    }), 'client-a', NOW)
    if (facts === 'unreadable') throw new Error('fixture unreadable')
    expect(facts.policyReadable).toBe(true)
    expect(facts.policyAds).toHaveLength(501)
    const judged = judgeBreaker(facts)
    expect(judged.alerts.map((item) => item.code)).not.toContain('policy_unreadable')
    expect(judged.pauses.some((item) => item.campaignId === 'camp-a' && item.rules.includes('policy_error'))).toBe(true)
  })

  it('同一天后来只抓到变更时，仍保留这次没变的在投系列', async () => {
    const fullAt = new Date(NOW.getTime() - 6 * 3_600_000).toISOString()
    const partialAt = new Date(NOW.getTime() - 3_600_000).toISOString()
    const facts = await loadBreakerFacts(strictSb({
      clients: [{ id: 'client-a', leads_config: null, meta_ad_account_id: 'act-live' }],
      ad_strategy_configs: [{ client_id: 'client-a', primary_result: 'lead', target_cost_per_primary: null }],
      marketing_plans: [{ client_id: 'client-a', status: 'approved', plan_data: { promo: { daily_total_cap_cents: 1000 } } }],
      ad_entity_snapshots: [
        accountSnap('act-live', fullAt),
        campaignSnap('act-live', 'camp-a', 'ACTIVE', fullAt),
        adSnap('act-live', 'camp-a', 'ad-keep', 'ACTIVE', 'ACTIVE', fullAt),
        adSnap('act-live', 'camp-a', 'ad-new', 'ACTIVE', 'DISAPPROVED', partialAt),
      ],
      ad_snapshot_captures: [
        capture('act-live', 'account', fullAt),
        capture('act-live', 'campaign', fullAt),
        capture('act-live', 'ad', fullAt),
        capture('act-live', 'ad', partialAt),
      ],
      ad_daily_insights: [insight('act-live', 'camp-a', partialAt, 1, 1)],
    }), 'client-a', NOW)
    if (facts === 'unreadable') throw new Error('fixture unreadable')
    expect(facts.policyAds.map((item) => item.effectiveStatus).sort()).toEqual(['ACTIVE', 'DISAPPROVED'])
    expect(facts.policyReadable).toBe(true)
    const judged = judgeBreaker(facts)
    expect(judged.pauses.some((item) => item.campaignId === 'camp-a' && item.rules.includes('policy_error'))).toBe(true)
  })
})

function tables(input: { snaps: unknown[]; captures: unknown[]; insights: unknown[] }): Record<string, unknown[]> {
  return {
    clients: [{
      id: 'client-a',
      leads_config: { ads_circuit_breaker: { target_cpl_cents: 100 } },
      meta_ad_account_id: 'act-live',
    }],
    ad_strategy_configs: [{ client_id: 'client-a', primary_result: 'lead', target_cost_per_primary: null }],
    marketing_plans: [{ client_id: 'client-a', status: 'approved', plan_data: { promo: { daily_total_cap_cents: 1000 } } }],
    ad_entity_snapshots: input.snaps,
    ad_snapshot_captures: input.captures,
    ad_daily_insights: input.insights,
  }
}

function capture(accountId: string, level: string, capturedAt: string) {
  return { client_id: 'client-a', ad_account_id: accountId, level, captured_at: capturedAt, complete: true, skipped_shared: false }
}

function accountSnap(accountId: string, capturedAt: string) {
  return {
    client_id: 'client-a', ad_account_id: accountId, level: 'account', entity_id: accountId, entity_name: '账户',
    campaign_id: null, adset_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', captured_at: capturedAt,
    timezone_name: 'Pacific/Auckland', currency: 'NZD',
  }
}

function campaignSnap(accountId: string, campaignId: string, status: string, capturedAt: string) {
  return {
    client_id: 'client-a', ad_account_id: accountId, level: 'campaign', entity_id: campaignId, entity_name: campaignId,
    campaign_id: campaignId, adset_id: null, status, effective_status: status, captured_at: capturedAt,
    timezone_name: null, currency: null,
  }
}

function adSnap(accountId: string, campaignId: string, adId: string, status: string, effective: string, capturedAt: string) {
  return {
    client_id: 'client-a', ad_account_id: accountId, level: 'ad', entity_id: adId, entity_name: adId,
    campaign_id: campaignId, adset_id: 'set-a', status, effective_status: effective, captured_at: capturedAt,
    timezone_name: null, currency: null,
  }
}

function insight(accountId: string, campaignId: string, updatedAt: string, spend: number, leads: number) {
  return {
    client_id: 'client-a', ad_account_id: accountId, level: 'campaign', entity_id: campaignId, entity_name: campaignId,
    insight_date: '2026-11-09', spend, leads, messaging_conversations: 0, updated_at: updatedAt,
  }
}

function strictSb(tablesByName: Record<string, Array<Record<string, unknown>>>): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      let column = ''
      let ascending = true
      const api = {
        select: () => api,
        eq: (col: string, val: unknown) => { filters.push((row) => row[col] === val); return api },
        in: (col: string, vals: readonly unknown[]) => { filters.push((row) => vals.includes(row[col])); return api },
        gte: (col: string, val: unknown) => { filters.push((row) => String(row[col]) >= String(val)); return api },
        lte: (col: string, val: unknown) => { filters.push((row) => String(row[col]) <= String(val)); return api },
        order: (col: string, opts?: { ascending?: boolean }) => { column = col; ascending = opts?.ascending !== false; return api },
        limit: async (n: number) => ({ data: matched().slice(0, n), error: null }),
        range: async (from: number, to: number) => ({ data: matched().slice(from, to + 1), error: null }),
        maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      }
      function matched(): Array<Record<string, unknown>> {
        const rows = (tablesByName[table] ?? []).filter((row) => filters.every((fn) => fn(row)))
        if (!column) return rows
        return [...rows].sort((a, b) => {
          const left = String(a[column] ?? '')
          const right = String(b[column] ?? '')
          return ascending ? left.localeCompare(right) : right.localeCompare(left)
        })
      }
      return api
    },
  } as unknown as SupabaseClient
}

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
