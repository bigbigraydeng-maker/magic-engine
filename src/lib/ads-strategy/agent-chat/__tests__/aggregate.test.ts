import { describe, expect, it } from 'vitest'
import { aggregateInsightRows, deltaMetrics } from '../aggregate'

const row = (date: string, spend: number, leads: number) => ({
  level: 'campaign' as const,
  entity_id: 'ent-a',
  entity_name: 'Demo Campaign',
  insight_date: date,
  spend,
  impressions: 1000,
  clicks: 50,
  leads,
  messaging_conversations: 0,
  reach: 800,
  video_thruplays: null,
  video_3s_views: null,
  frequency: 1.2,
  frequency_7d: date === '2026-11-07' ? 1.5 : null,
  actions: [{ action_type: 'link_click', value: '40' }],
})

describe('aggregateInsightRows', () => {
  it('sums spend and computes CPA from lead primary', () => {
    const agg = aggregateInsightRows([row('2026-11-06', 10, 2), row('2026-11-07', 20, 1)], 'lead')
    expect(agg.spend).toBe(30)
    expect(agg.leads).toBe(3)
    expect(agg.primary_results).toBe(3)
    expect(agg.cost_per_primary).toBe(10)
    expect(agg.link_clicks).toBe(80)
  })

  it('deltaMetrics reports CPA change', () => {
    const a = aggregateInsightRows([row('2026-11-07', 30, 1)], 'lead')
    const b = aggregateInsightRows([row('2026-11-06', 20, 2)], 'lead')
    const d = deltaMetrics(a, b)
    expect(d.cost_per_primary_delta).toBe(20)
    expect(d.cost_per_primary_delta_pct).toBe(200)
  })
})
