import { describe, expect, it } from 'vitest'
import type { EntitySnapshotRow } from '../../portfolio/snapshot'
import type { AccountInput, DiagnosisInput } from '../../portfolio/diagnostics/types'
import { judgePatrolCost, patrolCostSnapshotsFresh, PATROL_COST_OVER_NUM, PATROL_COST_OVER_DEN } from '../patrol-cost'

const TARGET = 10

function snap(adsetId: string, name: string): EntitySnapshotRow {
  return {
    level: 'adset',
    entity_id: adsetId,
    entity_name: name,
    campaign_id: 'camp_1',
    ad_account_id: 'act_demo',
    effective_status: 'ACTIVE',
    status: 'ACTIVE',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    destination_type: null,
    budget_level: 'abo',
    daily_budget_minor: 5000,
    lifetime_budget_minor: null,
    captured_at: '2026-11-14T02:00:00Z',
    capture_reason: 'scheduled',
    currency: 'NZD',
    timezone_name: 'Pacific/Auckland',
    ad_studies: [],
    included_audience_ids: [],
    excluded_audience_ids: [],
    creative_video_ids: null,
    creative_page_id: 'page_demo',
    audience_rule_object_ids: null,
    audience_rule_events: null,
    audience_retention_days: null,
    bid_strategy: null,
    source_updated_time: null,
    audience_count_lower: null,
  } as EntitySnapshotRow
}

function dayRow(adsetId: string, date: string, spend: number, leads: number) {
  return {
    level: 'adset' as const,
    entity_id: adsetId,
    parent_id: 'camp_1',
    insight_date: date,
    spend,
    impressions: 1000,
    reach: 800,
    clicks: 50,
    leads,
    messaging_conversations: 0,
    video_thruplays: null,
    actions: [{ action_type: 'lead', value: String(leads) }],
  }
}

function account(
  daily: ReturnType<typeof dayRow>[],
  capturesComplete = true,
  captureAt = '2026-11-14T05:30:00.000Z',
): AccountInput {
  return {
    adAccountId: 'act_demo',
    shared: false,
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    snapshots: [snap('as_a', '测试组 A')],
    daily,
    hourly: {},
    hourlyError: null,
    latestCaptures: capturesComplete
      ? [{ level: 'adset', complete: true, skipped_shared: false, error: null, captured_at: captureAt }]
      : [{ level: 'adset', complete: false, skipped_shared: false, error: 'incomplete', captured_at: captureAt }],
    lastInsightDate: '2026-11-14',
  }
}

function input(date: string, daily: ReturnType<typeof dayRow>[], capturesComplete = true): DiagnosisInput {
  return {
    clientId: 'client_demo',
    date,
    evaluatedAt: `${date}T06:00:00.000Z`,
    outcome: { leading: 'lead', primary: 'lead', targetCostPerPrimary: TARGET, minPrimaryPerUnit: 3 },
    outcomeConfigured: true,
    messagingReferralAvailable: false,
    digestRecipients: [],
    accounts: [account(daily, capturesComplete)],
  }
}

/** spend/results 让 rolling 3d CPL ≈ 11 when target is 10 (over 15%). */
function expensiveDays(adsetId: string, end: string) {
  return [
    dayRow(adsetId, '2026-11-12', 30, 2),
    dayRow(adsetId, '2026-11-13', 30, 2),
    dayRow(adsetId, end, 30, 2),
  ]
}

describe('judgePatrolCost', () => {
  it('连续两天滚动 3 天成本都高于目标 15% → 命中', () => {
    const daily = [
      ...expensiveDays('as_a', '2026-11-12'),
      ...expensiveDays('as_a', '2026-11-13'),
      ...expensiveDays('as_a', '2026-11-14'),
    ]
    const v = judgePatrolCost(input('2026-11-14', daily), TARGET, '2026-11-14T06:00:00.000Z')
    expect(v.status).toBe('ok')
    expect(v.flags).toHaveLength(1)
    expect(v.flags[0].adsetName).toBe('测试组 A')
    expect(v.flags[0].rollingCpl).toBeGreaterThan(TARGET * (PATROL_COST_OVER_NUM / PATROL_COST_OVER_DEN))
  })

  it('只有评估日当天偏高、前一天正常 → 不命中', () => {
    const daily = [
      dayRow('as_a', '2026-11-11', 10, 2),
      dayRow('as_a', '2026-11-12', 10, 2),
      dayRow('as_a', '2026-11-13', 10, 2),
      dayRow('as_a', '2026-11-14', 100, 2),
    ]
    const v = judgePatrolCost(input('2026-11-14', daily), TARGET, '2026-11-14T06:00:00.000Z')
    expect(v.flags).toHaveLength(0)
  })

  it('没有配置目标单次成本 → 整段跳过', () => {
    const v = judgePatrolCost(input('2026-11-14', expensiveDays('as_a', '2026-11-14')), null, '2026-11-14T06:00:00.000Z')
    expect(v.status).toBe('no_target')
    expect(v.flags).toHaveLength(0)
  })

  it('快照不完整 → stale，不亮花费灯', () => {
    const v = judgePatrolCost(
      input('2026-11-14', expensiveDays('as_a', '2026-11-14'), false),
      TARGET,
      '2026-11-14T06:00:00.000Z',
    )
    expect(v.status).toBe('stale')
    expect(v.flags).toHaveLength(0)
    expect(v.summaryLines[0]).toContain('偏旧')
  })
})

describe('patrolCostSnapshotsFresh', () => {
  it('抓全且在 stale 窗口内 → fresh', () => {
    const now = '2026-11-14T06:00:00.000Z'
    const r = patrolCostSnapshotsFresh([account([], true, '2026-11-14T05:30:00.000Z')], now, 12)
    expect(r.fresh).toBe(true)
  })

  it('抓全但超过 stale 小时 → 不 fresh', () => {
    const staleCapture = account([], true)
    staleCapture.latestCaptures = [{
      level: 'adset',
      complete: true,
      skipped_shared: false,
      error: null,
      captured_at: '2026-11-13T12:00:00.000Z',
    }]
    const r = patrolCostSnapshotsFresh([staleCapture], '2026-11-14T06:00:00.000Z', 12)
    expect(r.fresh).toBe(false)
    expect(r.reason).toBe('capture_too_old')
  })
})