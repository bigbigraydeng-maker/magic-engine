import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { collectMonthlyAdsSection } from '../monthly-ads-section'

const mockFrom = vi.mocked(supabaseAdmin.from)
const CLIENT = '00000000-0000-0000-0000-000000000001'
const FROM = '2026-10-01'
const TO = '2026-10-31'

type Tables = {
  ad_strategy_configs: Record<string, unknown> | null
  ad_daily_insights: Array<Record<string, unknown>>
  ad_entity_snapshots: Array<Record<string, unknown>>
  client_pipeline_stages: Array<Record<string, unknown>>
  contact_stage_events: Array<Record<string, unknown>>
  contacts: Array<Record<string, unknown>>
  flywheel_actions: Array<Record<string, unknown>>
  flywheel_outcomes: Array<Record<string, unknown>>
}

function chainResolve(rows: unknown[]) {
  const self = () => chain
  const chain: Record<string, unknown> = {}
  chain.select = self
  chain.eq = self
  chain.neq = self
  chain.in = self
  chain.gte = self
  chain.lte = self
  chain.order = self
  chain.limit = self
  chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
  chain.range = async () => ({ data: rows, error: null })
  return chain
}

function insightsChain(all: Array<Record<string, unknown>>) {
  let level: string | null = null
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.select = self
  chain.eq = (col: string, val: string) => {
    if (col === 'level') level = val
    return chain
  }
  chain.neq = self
  chain.gte = self
  chain.lte = self
  chain.order = self
  chain.range = async () => ({
    data: all.filter(r => level == null || r.level === level),
    error: null,
  })
  return chain
}

function installTables(t: Tables) {
  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case 'ad_strategy_configs':
        return chainResolve(t.ad_strategy_configs ? [t.ad_strategy_configs] : [])
      case 'ad_daily_insights':
        return insightsChain(t.ad_daily_insights)
      case 'ad_entity_snapshots':
        return chainResolve(t.ad_entity_snapshots)
      case 'client_pipeline_stages':
        return chainResolve(t.client_pipeline_stages)
      case 'contact_stage_events':
        return chainResolve(t.contact_stage_events)
      case 'contacts':
        return chainResolve(t.contacts)
      case 'flywheel_actions':
        return chainResolve(t.flywheel_actions)
      case 'flywheel_outcomes':
        return chainResolve(t.flywheel_outcomes)
      default:
        throw new Error(`unexpected table ${table}`)
    }
  })
}

const baseConfig = {
  leading_result: 'messaging_started',
  primary_result: 'lead',
  target_cost_per_primary: 40,
  min_primary_per_unit: 5,
  qualified_stage_keys: ['quoted'],
}

describe('collectMonthlyAdsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates spend, lead count, CPL vs target, and ranks ad sets by name not id', async () => {
    installTables({
      ad_strategy_configs: baseConfig,
      ad_daily_insights: [
        { entity_id: '111', entity_name: '系列 A', level: 'campaign', spend: 100, leads: 4, messaging_conversations: 0, insight_date: '2026-10-05' },
        { entity_id: '222', entity_name: '组优', level: 'adset', spend: 60, leads: 3, messaging_conversations: 0, insight_date: '2026-10-06' },
        { entity_id: '333', entity_name: '组弱', level: 'adset', spend: 40, leads: 1, messaging_conversations: 0, insight_date: '2026-10-06' },
      ],
      ad_entity_snapshots: [{ currency: 'NZD', level: 'account', captured_at: '2026-10-10T00:00:00Z' }],
      client_pipeline_stages: [{ stage_key: 'quoted', label: '已报价' }],
      contact_stage_events: [{ contact_id: 'c1', to_stage: 'quoted', created_at: '2026-10-08T00:00:00Z', id: 'e1' }],
      contacts: [],
      flywheel_actions: [],
      flywheel_outcomes: [],
    })

    const section = await collectMonthlyAdsSection(CLIENT, FROM, TO)

    expect(section.spend).toBe(100)
    expect(section.results).toBe(4)
    expect(section.costPerResult).toBe(25)
    expect(section.vsTarget).toBe('at_or_below')
    expect(section.qualifiedLeads).toBe(1)
    expect(section.topAdSets[0]?.name).toBe('组优')
    expect(section.topAdSets[0]?.name).not.toMatch(/^\d+$/)
    expect(section.gaps).not.toContain('本月没有读到广告投放日数据')
  })

  it('lists gaps instead of inventing defaults when insights are empty', async () => {
    installTables({
      ad_strategy_configs: baseConfig,
      ad_daily_insights: [],
      ad_entity_snapshots: [],
      client_pipeline_stages: [],
      contact_stage_events: [],
      contacts: [],
      flywheel_actions: [],
      flywheel_outcomes: [],
    })

    const section = await collectMonthlyAdsSection(CLIENT, FROM, TO)
    expect(section.spend).toBeNull()
    expect(section.gaps).toContain('本月没有读到广告投放日数据')
  })
})
