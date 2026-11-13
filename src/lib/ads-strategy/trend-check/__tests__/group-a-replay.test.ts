import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTrendCheckRunReceipt, runDailyTrendCheck } from '../run'
import type { TrendDailyRow, TrendEntitySeries } from '../types'

interface FixtureDay {
  insight_date: string
  ctr_pct: number
  impressions: number
  spend: number
  primary_results: number
  cpm: number
}

interface GroupAFixture {
  client_slug: string
  target_cost_per_primary: number
  adset: { id: string; name: string }
  narrative_window: { acceptance_first: string; acceptance_last: string }
  structure: { delivering_ad_count: number; single_creative_days: number }
  daily: FixtureDay[]
}

const FIXTURE: GroupAFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'group-a-replay.json'), 'utf8'),
) as GroupAFixture

function dailyRows(): TrendDailyRow[] {
  return FIXTURE.daily.map((d) => ({
    insight_date: d.insight_date,
    impressions: d.impressions,
    clicks: Math.round((d.impressions * d.ctr_pct) / 100),
    spend: d.spend,
    primary_results: d.primary_results,
    cpm: d.cpm,
  }))
}

function entity(): TrendEntitySeries {
  return {
    subject: { level: 'adset', id: FIXTURE.adset.id, name: FIXTURE.adset.name },
    daily: dailyRows(),
    structure: {
      delivering_ad_count: FIXTURE.structure.delivering_ad_count,
      single_creative_days: FIXTURE.structure.single_creative_days,
    },
    intraday: { buckets: [] },
  }
}

function datesBetween(first: string, last: string): string[] {
  const out: string[] = []
  let cur = first
  while (cur <= last) {
    out.push(cur)
    const t = Date.parse(`${cur}T00:00:00Z`) + 86_400_000
    cur = new Date(t).toISOString().slice(0, 10)
  }
  return out
}

describe('客户 C 组 A 脱敏回放（日趋势规则）', () => {
  it('第 6–11 天验收窗内至少有一天命中 creative_fatigue（CTR 对自己 7 日均值）', () => {
    const window = datesBetween(
      FIXTURE.narrative_window.acceptance_first,
      FIXTURE.narrative_window.acceptance_last,
    )
    const hits: string[] = []
    for (const date of window) {
      const result = runDailyTrendCheck({
        client_slug: FIXTURE.client_slug,
        evaluation_date: date,
        target_cost_per_primary: FIXTURE.target_cost_per_primary,
        entities: [entity()],
      })
      if (result.findings.some((f) => f.diagnosis_code === 'creative_fatigue')) hits.push(date)
    }
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((d) => d >= FIXTURE.narrative_window.acceptance_first && d <= FIXTURE.narrative_window.acceptance_last)).toBe(true)
  })

  it('命中日含结构化证据与调方建议', () => {
    const result = runDailyTrendCheck({
      client_slug: FIXTURE.client_slug,
      evaluation_date: '2026-11-07',
      target_cost_per_primary: FIXTURE.target_cost_per_primary,
      entities: [entity()],
    })
    const fatigue = result.findings.find((f) => f.diagnosis_code === 'creative_fatigue')
    expect(fatigue?.rule_id).toBe('ctr_vs_self_7d')
    expect(fatigue?.label_zh).toBe('素材疲劳/走弱')
    expect(fatigue?.evidence.ctr_drop_pct).toBeLessThanOrEqual(-30)
    expect(fatigue?.suggested_tune).toContain('swap_creative')
    expect(fatigue?.evidence.flags).toContain('single_creative_stale')
    const receipt = buildTrendCheckRunReceipt(result)
    expect(receipt.kind).toBe('ads_daily_trend_check')
    expect(receipt.findings_count).toBeGreaterThan(0)
  })
})
