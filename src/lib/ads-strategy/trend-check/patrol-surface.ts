/**
 * 日趋势规则 → 巡察结论 / Tune 预备结构化发现（纯函数 + 日表输入）。
 */

import { shiftDate } from '../portfolio/diagnostics/context'
import type { AccountInput, DailyRow, DiagnosisInput } from '../portfolio/diagnostics/types'
import { countOutcome } from '../portfolio/outcome-ladder'
import type { TrendCheckRules } from './config'
import { buildTrendCheckRunReceipt, runDailyTrendCheck } from './run'
import type { TrendCheckRunReceipt, TrendDailyRow, TrendEntitySeries, TrendFinding } from './types'

export const TUNE_TREND_SCHEMA = 'ads_tune_trend_v1' as const

export interface TuneReadyTrendFinding {
  readonly schema_version: typeof TUNE_TREND_SCHEMA
  readonly type: TrendFinding['diagnosis_code']
  readonly level: 'adset'
  readonly entity_ref: string
  readonly entity_name: string | null
  readonly metric: 'ctr_pct' | 'cpl'
  readonly baseline: number | null
  readonly today: number | null
  readonly severity: TrendFinding['severity']
  readonly rule_id: TrendFinding['rule_id']
  readonly suggested_tune: TrendFinding['suggested_tune']
}

export interface TrendCheckPatrolSurface {
  readonly insightDate: string
  readonly patrolLine: string
  readonly lines: readonly string[]
  readonly tuneFindings: readonly TuneReadyTrendFinding[]
  readonly receipt: TrendCheckRunReceipt
}

function toTrendDaily(row: DailyRow, primaryCount: number): TrendDailyRow {
  return {
    insight_date: row.insight_date,
    impressions: row.impressions,
    clicks: row.clicks,
    spend: row.spend,
    primary_results: primaryCount,
    cpm: row.impressions > 0 ? (row.spend / row.impressions) * 1000 : null,
  }
}

function adsetName(account: AccountInput, adsetId: string): string | null {
  return account.snapshots.find((s) => s.level === 'adset' && s.entity_id === adsetId)?.entity_name ?? null
}

function structureForAdset(account: AccountInput, adsetId: string, endDate: string, adsetRows: DailyRow[]): TrendEntitySeries['structure'] {
  const delivering = account.snapshots.filter(
    (s) => s.level === 'ad' && s.adset_id === adsetId && s.effective_status === 'ACTIVE',
  ).length
  if (delivering !== 1) return { delivering_ad_count: delivering, single_creative_days: 0 }
  let streak = 0
  let d = endDate
  const byDate = new Map(adsetRows.map((r) => [r.insight_date, r]))
  while ((byDate.get(d)?.impressions ?? 0) > 0) {
    streak += 1
    d = shiftDate(d, -1)
  }
  return { delivering_ad_count: 1, single_creative_days: streak }
}

function buildEntities(input: DiagnosisInput, date: string): TrendEntitySeries[] {
  const primary = input.outcome.primary
  const out: TrendEntitySeries[] = []
  for (const account of input.accounts) {
    if (account.shared) continue
    const adsetRows = account.daily.filter((r) => r.level === 'adset')
    const byId = new Map<string, DailyRow[]>()
    for (const row of adsetRows) {
      const list = byId.get(row.entity_id)
      if (list) list.push(row)
      else byId.set(row.entity_id, [row])
    }
    for (const [adsetId, rows] of byId) {
      const daily = rows
        .sort((a, b) => a.insight_date.localeCompare(b.insight_date))
        .map((r) =>
          toTrendDaily(
            r,
            countOutcome(primary, r, {
              messagingReferralAvailable: input.messagingReferralAvailable,
              optimizationGoal: account.snapshots.find((s) => s.level === 'adset' && s.entity_id === adsetId)?.optimization_goal ?? null,
            }),
          ),
        )
      if (!daily.some((d) => d.insight_date === date)) continue
      out.push({
        subject: { level: 'adset', id: adsetId, name: adsetName(account, adsetId) ?? adsetId },
        daily,
        structure: structureForAdset(account, adsetId, date, rows),
      })
    }
  }
  return out
}

function metricOf(finding: TrendFinding): TuneReadyTrendFinding['metric'] {
  return finding.diagnosis_code === 'cost_creep' ? 'cpl' : 'ctr_pct'
}

function baselineToday(finding: TrendFinding): { baseline: number | null; today: number | null } {
  const e = finding.evidence
  if (finding.diagnosis_code === 'cost_creep') {
    return { baseline: e.cpl_prior_7d ?? null, today: e.cpl_day ?? e.cpl_rolling_7d ?? null }
  }
  return { baseline: e.ctr_baseline_7d_pct ?? null, today: e.ctr_day_pct ?? null }
}

export function toTuneReady(finding: TrendFinding): TuneReadyTrendFinding {
  const { baseline, today } = baselineToday(finding)
  return {
    schema_version: TUNE_TREND_SCHEMA,
    type: finding.diagnosis_code,
    level: 'adset',
    entity_ref: finding.subject.id,
    entity_name: finding.subject.name,
    metric: metricOf(finding),
    baseline,
    today,
    severity: finding.severity,
    rule_id: finding.rule_id,
    suggested_tune: finding.suggested_tune,
  }
}

export function lineForFinding(finding: TrendFinding): string {
  const label = finding.subject.name ?? `广告组 ${finding.subject.id.slice(-6)}`
  const { baseline, today } = baselineToday(finding)
  if (finding.diagnosis_code === 'cost_creep' && baseline != null && today != null) {
    return `${label}：${finding.label_zh}（单次成效成本 ${baseline.toFixed(1)} → ${today.toFixed(1)}）`
  }
  if (finding.evidence.ctr_drop_pct != null) {
    return `${label}：${finding.label_zh}（点击率较自身基线 ${finding.evidence.ctr_drop_pct.toFixed(1)}%）`
  }
  return `${label}：${finding.label_zh}`
}

export function judgeTrendCheckPatrol(
  input: DiagnosisInput,
  insightDate: string,
  targetCostPerPrimary: number | null,
  rules: TrendCheckRules,
): TrendCheckPatrolSurface | null {
  const entities = buildEntities(input, insightDate)
  if (entities.length === 0) return null
  const result = runDailyTrendCheck(
    {
      client_slug: input.clientId,
      evaluation_date: insightDate,
      target_cost_per_primary: targetCostPerPrimary,
      entities,
    },
    { rules },
  )
  if (result.findings.length === 0) return null
  const lines = result.findings.map(lineForFinding)
  return {
    insightDate,
    patrolLine: lines.length === 1 ? `趋势检查：${lines[0]}` : `趋势检查：${lines.length} 条（${lines.join('；')}）`,
    lines,
    tuneFindings: result.findings.map(toTuneReady),
    receipt: buildTrendCheckRunReceipt(result),
  }
}