/**
 * Pure look-back: compare ads_decision_v1 expectations to daily insight rows.
 */

import type {
  AdsDecisionReviewResult,
  AdsDecisionV1,
  DecisionDailyInsightRow,
} from './types'

export interface LookbackEvaluateInput {
  readonly decision: AdsDecisionV1
  readonly insights: readonly DecisionDailyInsightRow[]
  readonly targetCplMajor: number | null
  readonly reviewAsOf: string
  readonly adsetRef: string
}

export interface LookbackEvaluateOutput {
  readonly result: AdsDecisionReviewResult
  readonly reviewCaseText: string
}

const CTR_FLOOR = 0.018

export function evaluateDecisionLookback(input: LookbackEvaluateInput): LookbackEvaluateOutput {
  const reviewedAt = `${input.reviewAsOf}T12:00:00.000Z`
  const itemResults: Array<{ ok: boolean | null; line: string; informational?: boolean }> = []

  for (const item of input.decision.expectation.items) {
    if (item.metric === 'per_ad_link_ctr') {
      itemResults.push(evaluatePerAdCtr(item, input.insights, input.reviewAsOf))
    } else if (item.metric === 'cpl_ratio_to_target') {
      itemResults.push(evaluateAdsetCpl(item, input.insights, input.targetCplMajor, input.adsetRef, input.reviewAsOf))
    } else if (item.metric === 'crm_quoted_rate') {
      itemResults.push({
        ok: true,
        line: 'CRM「已报价」占比尚未接入数据，本次只记入预期文本。',
        informational: true,
      })
    } else {
      itemResults.push({ ok: null, line: `指标 ${item.metric} 暂无自动核对规则。` })
    }
  }

  const scored = itemResults.filter((r) => !r.informational)
  const failures = scored.filter((r) => r.ok === false)
  const unknowns = scored.filter((r) => r.ok === null)
  const passes = scored.filter((r) => r.ok === true)

  let verdict: AdsDecisionReviewResult['verdict']
  let suggested: string | null = null

  if (failures.length > 0) {
    verdict = 'not_met'
    suggested = '建议对照未达预期的素材或预算，考虑换创意或收窄投放。'
  } else if (unknowns.length > 0) {
    verdict = 'cant_tell'
    suggested = unknowns.length === itemResults.length
      ? '先补齐日表或目标获客成本，再重跑回头看。'
      : '部分条件缺数据，请人工看一眼广告后台。'
  } else if (passes.length === scored.length && scored.length > 0) {
    verdict = 'met'
    suggested = '可继续观察；若下周走弱再记一条新决策。'
  } else {
    verdict = 'cant_tell'
    suggested = '部分条件缺数据，请人工看一眼广告后台。'
  }

  const reasonLines = [...passes, ...failures, ...unknowns].map((r) => r.line)
  const reason_zh = reasonLines.join(' ')
  const reviewCaseText = `决策回头看：${verdictLabel(verdict)}。${reason_zh}`

  return {
    result: {
      verdict,
      reason_zh,
      suggested_next_zh: suggested,
      reviewed_at: reviewedAt,
    },
    reviewCaseText,
  }
}

function verdictLabel(v: AdsDecisionReviewResult['verdict']): string {
  if (v === 'met') return '达到预期'
  if (v === 'not_met') return '未达预期'
  return '看不出'
}

function evaluatePerAdCtr(
  item: AdsDecisionV1['expectation']['items'][number],
  insights: readonly DecisionDailyInsightRow[],
  reviewAsOf: string,
): { ok: boolean | null; line: string } {
  const refs = item.entity_refs ?? []
  if (refs.length === 0) return { ok: null, line: '新素材广告编号未登记，无法核对点击率。' }
  const from = dayMinus(reviewAsOf, Math.max(1, item.horizon_days) - 1)
  const fails: string[] = []
  const passes: string[] = []
  for (const ref of refs) {
    const rows = insights.filter(
      (r) => r.level === 'ad' && r.entity_id === ref && r.insight_date >= from && r.insight_date <= reviewAsOf,
    )
    if (rows.length === 0) {
      return { ok: null, line: '新素材日表样本不足，看不出链接点击率。' }
    }
    const ctr = aggregateCtr(rows)
    if (ctr === null) return { ok: null, line: '新素材缺少点击或展示，看不出链接点击率。' }
    if (ctr >= CTR_FLOOR) passes.push(`素材 ${ref} 链接点击率约 ${pct(ctr)}，达到 ≥1.8%`)
    else fails.push(`素材 ${ref} 链接点击率约 ${pct(ctr)}，低于 1.8%`)
  }
  if (fails.length > 0) return { ok: false, line: fails.join('；') }
  return { ok: true, line: passes.join('；') }
}

function evaluateAdsetCpl(
  item: AdsDecisionV1['expectation']['items'][number],
  insights: readonly DecisionDailyInsightRow[],
  targetCplMajor: number | null,
  adsetRef: string,
  reviewAsOf: string,
): { ok: boolean | null; line: string } {
  if (targetCplMajor === null || targetCplMajor <= 0) {
    return { ok: null, line: '目标获客成本未配置，无法核对 CPL 比值。' }
  }
  const needConsecutive = item.consecutive_days ?? 1
  const horizon = Math.max(needConsecutive, item.horizon_days)
  const from = dayMinus(reviewAsOf, horizon - 1)
  const rows = insights
    .filter(
      (r) => r.level === 'adset' && r.entity_id === adsetRef && r.insight_date >= from && r.insight_date <= reviewAsOf,
    )
    .sort((a, b) => a.insight_date.localeCompare(b.insight_date))
  if (rows.length < needConsecutive) {
    return { ok: null, line: '广告组日表不足，看不出相对目标的获客成本。' }
  }
  const tail = rows.slice(-needConsecutive)
  const ratios = tail.map((r) => cplRatio(r, targetCplMajor))
  if (ratios.some((x) => x === null)) {
    return { ok: null, line: '观察日花费或成效不齐，看不出 CPL 比值。' }
  }
  const ok = ratios.every((x) => x !== null && x <= 1)
  const detail = ratios.map((x, i) => `${tail[i]?.insight_date ?? '?'} 约 ${x?.toFixed(2)}× 目标`).join('；')
  return ok
    ? { ok: true, line: `广告组连续 ${needConsecutive} 天获客成本相对目标达标（${detail}）。` }
    : { ok: false, line: `广告组获客成本相对目标偏高（${detail}）。` }
}

function aggregateCtr(rows: readonly DecisionDailyInsightRow[]): number | null {
  let clicks = 0
  let impressions = 0
  for (const r of rows) {
    clicks += r.clicks ?? 0
    impressions += r.impressions ?? 0
  }
  if (impressions <= 0) return null
  if (rows.some((r) => r.ctr !== null && r.ctr !== undefined)) {
    const ctrs = rows.map((r) => r.ctr).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (ctrs.length > 0) return ctrs.reduce((a, b) => a + b, 0) / ctrs.length
  }
  return clicks / impressions
}

function cplRatio(row: DecisionDailyInsightRow, targetMajor: number): number | null {
  const spend = row.spend
  const outcomes = row.results ?? row.leads
  if (spend === null || outcomes === null || outcomes <= 0) return null
  const cpl = spend / outcomes
  return cpl / targetMajor
}

function dayMinus(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`
}

/** Fixture scenario from design §5.5 (anonymized group A, client C). */
export function fixtureGroupACreativeDecision(reviewDueOn: string): AdsDecisionV1 {
  return {
    schema_version: 'ads_decision_v1',
    decided_at: '2026-11-14T02:08:00+13:00',
    decided_by: { kind: 'human', label: 'pm' },
    subject: { level: 'adset', ref: 'fixture-adset-group-a', label_zh: '客户 C 的组 A' },
    decision_type: 'creative_change',
    what_done_zh: '旧视频继续投放；新增 2 条静态图（价格优先版、问句钩子版）；系列日预算不变。',
    evidence_at_decision: {
      cpl_ratio_to_target: 1.05,
      ctr_vs_day1_pct: -42,
      note_zh: '点击率走弱、获客成本略高于目标，转化链路稳定',
    },
    reasoning_zh: '视频疲劳明显，先用两张静图测点击率，不换落地页、不动预算。',
    expectation: {
      items: [
        {
          metric: 'per_ad_link_ctr',
          target: '≥ 1.8%',
          horizon_days: 3,
          scope: 'each_new_static_ad',
          entity_refs: ['fixture-ad-static-price', 'fixture-ad-static-hook'],
        },
        {
          metric: 'cpl_ratio_to_target',
          target: '≤ 1.0',
          horizon_days: 3,
          scope: 'adset',
          consecutive_days: 2,
        },
        {
          metric: 'crm_quoted_rate',
          target: '观察 CRM「已报价」占比是否异常走低',
          horizon_days: 3,
          scope: 'crm',
        },
      ],
      notes_zh: 'CRM「已报价」占比记入预期，数据后补。',
    },
    stop_or_rollback_zh: '任一新静图花费约达 3× 目标获客成本且 0 线索则暂停该广告。',
    review_due_on: reviewDueOn,
    status: 'active',
    review_result: null,
  }
}
