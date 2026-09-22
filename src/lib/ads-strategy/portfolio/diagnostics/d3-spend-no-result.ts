/**
 * D3 · 花钱没结果（获客 / 再营销），设计 §3.3 + §14 M8。只读。
 *
 * 近 7 天某广告组：花费 ≥ K × 客户目标单次主结果成本，且单次主结果成本 ≥ K × 目标（含零结果）→ 命中。
 * not_comparable（只在有获客/再营销花费、本可能命中时才出，健康日不出）：
 *   - 客户没配目标单次成本 / 没配主结果（不许回落行业默认值，红线 7）
 *   - 主结果 UNKNOWN（归不到广告单位，§14 M8）
 * Meta 实验中的广告组不判（§14 M7）。
 */

import type { AccountContext } from './context'
import { adsetRows, money, sumSpend, unitOf } from './context'
import { countOutcome, OUTCOME_STEP_LABEL } from '../outcome-ladder'
import type { Diagnosis, DiagnosisInput } from './types'
import { D3_COST_MULTIPLE } from './thresholds'

const round2 = (n: number) => Math.round(n * 100) / 100

export function diagnoseSpendNoResult(ctx: AccountContext, input: DiagnosisInput): Diagnosis[] {
  const candidates = Array.from(ctx.adsets.values()).filter(s => {
    if (ctx.experimentIds.has(s.entity_id)) return false
    const role = ctx.roles.get(s.entity_id)?.role
    return role === 'acquisition' || role === 'retargeting'
  })
  const spending = candidates
    .map(s => ({ s, rows: adsetRows(ctx, [s.entity_id]) }))
    .filter(x => sumSpend(x.rows) > 0)
  if (spending.length === 0) return []

  const { outcome } = input
  const target = outcome.targetCostPerPrimary
  // 结果阶梯整个没配：D7 客户级已经报「还没设置广告结果怎么算」，这里不重复出（子牙复审）
  if (!input.outcomeConfigured || outcome.primary === null) return []
  if (target === null) {
    const spend = round2(spending.reduce((a, x) => a + sumSpend(x.rows), 0))
    return [{
      code: 'D3',
      status: 'not_comparable',
      notComparableReason: 'target_cost_not_configured',
      title: '花钱没结果这条判不了：客户还没设置目标单次成本',
      units: spending.map(x => unitOf(ctx, 'adset', x.s.entity_id)),
      evidence: { window_start: ctx.window[0], window_end: ctx.date, acquisition_spend: spend, target_cost: target },
      sample: [{ label: '近 7 天有花费的获客/再营销广告组', value: spending.length }],
      reasons: ['不拿行业默认值代替客户目标（红线 7），去设置页「广告结果怎么算」填上后才判'],
      clientVisible: true,
    }]
  }

  const out: Diagnosis[] = []
  const threshold = D3_COST_MULTIPLE * target
  for (const { s, rows } of spending) {
    const spend = sumSpend(rows)
    const counts = rows.map(r => countOutcome(outcome.primary!, r, {
      messagingReferralAvailable: input.messagingReferralAvailable,
      optimizationGoal: s.optimization_goal,
    }))
    const unit = unitOf(ctx, 'adset', s.entity_id)
    if (counts.some(c => c.value === null)) {
      if (spend < threshold) continue
      out.push({
        code: 'D3', status: 'not_comparable', notComparableReason: 'primary_result_unknown',
        title: `花钱没结果这条判不了：${OUTCOME_STEP_LABEL[outcome.primary]}归不到这个广告组`,
        units: [unit],
        evidence: { window_start: ctx.window[0], window_end: ctx.date, spend, target_cost: target },
        sample: [{ label: '主结果归不上的天数', value: counts.filter(c => c.value === null).length }],
        reasons: [counts.find(c => c.note)?.note ?? '主结果 UNKNOWN（§14 M8）'],
        clientVisible: true,
      })
      continue
    }
    const results = counts.reduce((a, c) => a + (c.value ?? 0), 0)
    const cpr = results > 0 ? round2(spend / results) : null
    if (spend < threshold) continue
    if (cpr !== null && cpr < threshold) continue
    out.push({
      code: 'D3', status: 'hit',
      title: results === 0
        ? `花钱没结果：近 7 天花了 ${money(ctx, spend)}，${OUTCOME_STEP_LABEL[outcome.primary]} 0 个`
        : `花钱结果太少：近 7 天花了 ${money(ctx, spend)}，${OUTCOME_STEP_LABEL[outcome.primary]} ${results} 个，每个 ${money(ctx, cpr)}（目标 ${money(ctx, target)}）`,
      units: [unit],
      evidence: { window_start: ctx.window[0], window_end: ctx.date, spend, results, cost_per_result: cpr, target_cost: target, multiple: D3_COST_MULTIPLE },
      sample: [{ label: OUTCOME_STEP_LABEL[outcome.primary], value: results }, { label: '有花费的天数', value: rows.filter(r => r.spend > 0).length }],
      reasons: [`花费 ≥ ${D3_COST_MULTIPLE}× 目标，且单次成本 ≥ ${D3_COST_MULTIPLE}× 目标`],
      clientVisible: true,
    })
  }
  return out
}
