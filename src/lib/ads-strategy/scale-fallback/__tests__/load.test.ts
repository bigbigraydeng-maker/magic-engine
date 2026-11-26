import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { baseSpec } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import { loadScaleFallback } from '../load'
import { judgeScaleFallback } from '../rules'

const NOW = new Date('2026-11-10T17:00:00.000Z')
const CLIENT = '00000000-0000-4000-8000-000000000001'

function table(data: unknown) {
  const query: Record<string, unknown> = {}
  const chain = () => query
  for (const name of ['select', 'eq', 'in', 'order', 'limit']) query[name] = chain
  query.maybeSingle = () => Promise.resolve({ data, error: null })
  query.then = (done: (value: unknown) => unknown, fail?: (reason: unknown) => unknown) => (
    Promise.resolve({ data, error: null }).then(done, fail)
  )
  return query
}

function db(): SupabaseClient {
  const spec = baseSpec({ delivery: { stage: 'scale', goal: '把已经验证的受众放量', started_on: '2026-11-01' } })
  const tables: Record<string, unknown> = {
    clients: { leads_config: null, meta_ad_account_id: 'act_1' },
    ad_strategy_configs: { target_cost_per_primary: 8 },
    marketing_plans: [{ status: 'approved', plan_data: { promo: spec } }],
    ad_entity_snapshots: [
      { ad_account_id: 'act_1', level: 'account', entity_id: 'act_1', campaign_id: null, effective_status: 'ACTIVE', daily_budget_minor: null, captured_at: '2026-11-10T16:00:00.000Z', timezone_name: 'Pacific/Auckland', currency: 'NZD' },
      { ad_account_id: 'act_1', level: 'campaign', entity_id: 'camp-1', campaign_id: null, effective_status: 'ACTIVE', daily_budget_minor: null, captured_at: '2026-11-10T16:00:00.000Z', timezone_name: null, currency: null },
      { ad_account_id: 'act_1', level: 'adset', entity_id: 'set-alpha', campaign_id: 'camp-1', effective_status: 'ACTIVE', daily_budget_minor: 1440, captured_at: '2026-11-10T16:00:00.000Z', timezone_name: null, currency: null },
    ],
    ad_daily_insights: [
      { entity_id: 'set-alpha', insight_date: '2026-11-10', spend: 11, leads: 1 },
      { entity_id: 'set-alpha', insight_date: '2026-11-09', spend: 11, leads: 1 },
    ],
    ad_snapshot_captures: [{ complete: true, captured_at: '2026-11-10T16:00:00.000Z', skipped_shared: false }],
    flywheel_actions: [
      { executed_at: '2026-11-01T00:00:00.000Z', payload: { kind: 'adset_daily_budget', status: 'executed', wroteMeta: true, beforeCents: 1000, afterCents: 1200, order: { adsetId: 'set-alpha' } } },
      { executed_at: '2026-11-02T00:00:00.000Z', payload: { kind: 'adset_daily_budget', status: 'executed', wroteMeta: true, beforeCents: 1200, afterCents: 1440, order: { adsetId: 'set-alpha' } } },
    ],
  }
  return { from(name: string) { return table(tables[name] ?? []) } } as unknown as SupabaseClient
}

describe('从已有表读出收回建议', () => {
  it('假数据走出一张卡，金额是加预算之前的日预算', async () => {
    const loaded = await loadScaleFallback(db(), CLIENT, NOW)
    expect(loaded).not.toBe('unreadable')
    if (loaded === 'unreadable') return
    const [card] = judgeScaleFallback(loaded)
    expect(card?.restoreCents).toBe(1000)
    expect(card?.currentCents).toBe(1440)
    expect(card?.reasons).toEqual(['cpl'])
    expect(card?.yesterday).toBe('2026-11-10')
    expect(card?.dayBefore).toBe('2026-11-09')
  })
})
