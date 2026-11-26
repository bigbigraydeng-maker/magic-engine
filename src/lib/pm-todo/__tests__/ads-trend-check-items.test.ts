import { describe, expect, it } from 'vitest'
import { buildAdsTrendCheckItem } from '../ads-trend-check-items'

describe('buildAdsTrendCheckItem', () => {
  it('聚合趋势行到一条待办', () => {
    const item = buildAdsTrendCheckItem('fixture-client-c', '演示客户', {
      insightDate: '2026-11-05',
      patrolLine: '趋势检查：A',
      lines: ['Fixture group A：素材疲劳/走弱（点击率较自身基线 -30.0%）'],
      tuneFindings: [],
      receipt: {
        kind: 'ads_daily_trend_check',
        client_slug: 'fixture-client-c',
        evaluation_date: '2026-11-05',
        findings_count: 1,
        diagnosis_codes: ['creative_fatigue'],
        rule_ids: ['ctr_vs_self_7d'],
      },
    })
    expect(item.kind).toBe('ads_trend_check_alert')
    expect(item.what).toContain('趋势检查')
  })
})