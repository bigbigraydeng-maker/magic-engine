import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { judgeTrendCheckPatrol } from '../patrol-surface'
import { DEFAULT_TREND_CHECK_RULES } from '../config'
import type { DiagnosisInput, DailyRow } from '../../portfolio/diagnostics/types'
import type { EntitySnapshotRow } from '../../portfolio/snapshot'

const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'group-a-replay.json'), 'utf8')) as {
  daily: Array<{ insight_date: string; ctr_pct: number; impressions: number; spend: number; primary_results: number }>
  adset: { id: string; name: string }
  target_cost_per_primary: number
}

function diagnosisInput(date: string): DiagnosisInput {
  const daily: DailyRow[] = FIXTURE.daily.map((d) => ({
    level: 'adset',
    entity_id: FIXTURE.adset.id,
    parent_id: 'fixture-campaign',
    insight_date: d.insight_date,
    spend: d.spend,
    impressions: d.impressions,
    reach: null,
    clicks: Math.round((d.impressions * d.ctr_pct) / 100),
    leads: d.primary_results,
    messaging_conversations: 0,
    video_thruplays: null,
    actions: null,
  }))
  const snap = (level: EntitySnapshotRow['level'], entity_id: string, adset_id: string | null): EntitySnapshotRow =>
    ({ level, entity_id, entity_name: level === 'adset' ? FIXTURE.adset.name : 'Fixture ad', adset_id, effective_status: 'ACTIVE' }) as EntitySnapshotRow
  return {
    clientId: 'fixture-client-c',
    date,
    evaluatedAt: `${date}T06:00:00.000Z`,
    outcome: { leading: 'lead', primary: 'lead', targetCostPerPrimary: FIXTURE.target_cost_per_primary, minPrimaryPerUnit: 5 },
    outcomeConfigured: true,
    messagingReferralAvailable: false,
    digestRecipients: [],
    accounts: [{
      adAccountId: 'fixture-account', shared: false, timezone: 'Pacific/Auckland', currency: 'NZD',
      snapshots: [snap('adset', FIXTURE.adset.id, null), snap('ad', 'fixture-ad-one', FIXTURE.adset.id)],
      daily, hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: date,
    }],
  }
}

describe('judgeTrendCheckPatrol dry run', () => {
  it('11-05 巡察结论 + ads_tune_trend_v1', () => {
    const surface = judgeTrendCheckPatrol(diagnosisInput('2026-11-05'), '2026-11-05', FIXTURE.target_cost_per_primary, DEFAULT_TREND_CHECK_RULES)
    expect(surface?.patrolLine).toContain('趋势检查')
    expect(surface?.tuneFindings[0]?.type).toBe('creative_fatigue')
  })
})