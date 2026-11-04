/**
 * D3 · 花钱没结果（获客 / 再营销），设计 §3.3 + §14 M8。只读。
 *
 * 近 7 天某广告组：花费 ≥ K × 客户目标单次主结果成本，且单次主结果成本 ≥ K × 目标（含零结果）→ 命中。
 * not_comparable（只在有获客/再营销花费、本可能命中时才出，健康日不出）：
 *   - 客户没配目标单次成本 / 没配主结果（不许回落行业默认值，红线 7）
 *   - 主结果 UNKNOWN（归不到广告单位，§14 M8）
 *   - 广告组自己出的结果跟客户主结果不是一种（WhatsApp 开聊组 vs 主结果留资）：按主结果数永远是 0，
 *     只能判不了（2026-11-03 生产库：CTS 的 WhatsApp 组连着 6 天被误报）。结果种类复用 rules/core-metric.ts
 * Meta 实验中的广告组不判（§14 M7）。
 * 已经不在投放的广告组（暂停 / 系列被暂停 / 审核中）不判：钱已经不在流了，红灯只会误导；
 * 有结果但结果数和有花费的天数都不到 D3_SMALL_SAMPLE → 样本太小先观察（0 结果照旧报）。
 *
 * 候选范围：获客 / 再营销（可进自动暂停建议）；另有类似人群（expansion）和流量组
 * （优化目标 LINK_CLICKS / LANDING_PAGE_VIEWS，任何角色）——这两类只提醒，`autoPauseEligible: false`，
 * 自动暂停消费端不处理（保持原自动动作范围不变）。
 */

import type { AccountContext } from './context'
import { adsetRows, isDelivering, money, sumSpend, unitOf } from './context'
import { countOutcome, OUTCOME_STEP_LABEL } from '../outcome-ladder'
import { CORE_METRIC_NOUN, resolveCoreMetric, type CoreMetric } from '../../rules/core-metric'
import type { OutcomeStep } from '../outcome-ladder'
import type { EntitySnapshotRow } from '../snapshot'
import type { Diagnosis, DiagnosisInput } from './types'
import { D3_COST_MULTIPLE } from './thresholds'

/** 结果不到这么多个、且有花费的天数也不到这么多天：样本太小，先观察不报（零结果的白花钱不受这条限制） */
export const D3_SMALL_SAMPLE = 3

const round2 = (n: number) => Math.round(n * 100) / 100

const TRAFFIC_GOALS: ReadonlySet<string> = new Set(['LINK_CLICKS', 'LANDING_PAGE_VIEWS'])

/** 原有范围：获客 / 再营销。命中可进自动暂停建议。 */
function isAutoPauseScope(role: string | undefined): boolean {
  return role === 'acquisition' || role === 'retargeting'
}

/** 新纳入范围：类似人群，或按点击 / 落地页浏览优化的流量组。只提醒。 */
function isAlertOnlyScope(role: string | undefined, optimizationGoal: string | null): boolean {
  return role === 'expansion' || (optimizationGoal !== null && TRAFFIC_GOALS.has(optimizationGoal))
}

/**
 * 广告组自己出的结果种类跟客户主结果对不上时，返回它自己的那种（复用 rules/core-metric.ts，D2 / D10 同一个口径）；
 * 对得上、或客户主结果不是留资 / 开聊（合格询盘、成交这类）、或这个组自己认不出种类时返回 null，照旧按主结果数。
 */
function mismatchedMetric(adset: EntitySnapshotRow, primary: OutcomeStep): CoreMetric | null {
  if (primary !== 'lead' && primary !== 'messaging_started') return null
  const metric = resolveCoreMetric({ destinationType: adset.destination_type, optimizationGoal: adset.optimization_goal, clientPrimary: primary })
  return metric !== null && metric !== primary ? metric : null
}

/**
 * 标题要写明是哪个广告组；同系列下还有别的有花费的广告组时，再补一段系列合计，
 * 免得把「这个组」的数当成整个系列的数（合计 = 各组花费之和 / 各组结果之和）。
 */
function campaignTotalTail(ctx: AccountContext, input: DiagnosisInput, adset: EntitySnapshotRow): string {
  const primary = input.outcome.primary
  if (!adset.campaign_id || primary === null) return ''
  const withSpend = Array.from(ctx.adsets.values())
    .filter(s => s.campaign_id === adset.campaign_id)
    .map(s => ({ s, rows: adsetRows(ctx, [s.entity_id]) }))
    .filter(x => sumSpend(x.rows) > 0)
  if (withSpend.length < 2) return ''
  // 系列里混着出另一种结果的组（WhatsApp 开聊组 + 表单组）：按主结果加总会把开聊组的钱算进分母，不写
  if (withSpend.some(x => mismatchedMetric(x.s, primary) !== null)) return ''
  let spend = 0
  let results = 0
  for (const { s, rows } of withSpend) {
    spend += sumSpend(rows)
    for (const r of rows) {
      const c = countOutcome(primary, r, {
        messagingReferralAvailable: input.messagingReferralAvailable,
        optimizationGoal: s.optimization_goal,
      })
      if (c.value === null) return '' // 有一个组归不上，合计不可信，不写
      results += c.value
    }
  }
  const name = ctx.campaigns.get(adset.campaign_id)?.entity_name ?? '所属系列'
  const per = results > 0 ? money(ctx, round2(spend / results)) : '—'
  return `；「${name}」系列合计 ${money(ctx, round2(spend))} / ${results} = ${per}`
}

export function diagnoseSpendNoResult(ctx: AccountContext, input: DiagnosisInput): Diagnosis[] {
  const candidates = Array.from(ctx.adsets.values()).filter(s => {
    if (ctx.experimentIds.has(s.entity_id)) return false
    // effective_status 读不到（null）时不当作已停：宁可多报一次，也不让读失败把整条诊断悄悄关掉
    if (s.effective_status !== null && !isDelivering(s)) return false
    const role = ctx.roles.get(s.entity_id)?.role
    return isAutoPauseScope(role) || isAlertOnlyScope(role, s.optimization_goal)
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
    // 出的结果跟客户主结果不是一种（WhatsApp 开聊组 vs 主结果留资）：改数它自己的结果。零个照样是白花钱
    // （照常命中、照常可进自动暂停，魏征复审），有结果才判不了——留资的目标成本量不了开聊
    // （2026-11-03：CTS WhatsApp 组聊着天却被连报 6 天）。其余情况照旧按主结果数（见 mismatchedMetric）。
    const ownMetric = mismatchedMetric(s, outcome.primary)
    const step = ownMetric ?? outcome.primary
    const counts = rows.map(r => countOutcome(step, r, {
      messagingReferralAvailable: input.messagingReferralAvailable,
      optimizationGoal: s.optimization_goal,
    }))
    const unit = unitOf(ctx, 'adset', s.entity_id)
    const alertOnly = isAlertOnlyScope(ctx.roles.get(s.entity_id)?.role, s.optimization_goal)
    if (counts.some(c => c.value === null)) {
      if (spend < threshold) continue
      out.push({
        code: 'D3', status: 'not_comparable', notComparableReason: 'primary_result_unknown',
        title: `花钱没结果这条判不了：${OUTCOME_STEP_LABEL[step]}归不到这个广告组`,
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
    if (ownMetric !== null && results > 0) {
      out.push({
        code: 'D3', status: 'not_comparable', notComparableReason: 'result_type_mismatch',
        title: `花钱没结果这条判不了：这个广告组出的是${CORE_METRIC_NOUN[ownMetric]}（近 7 天 ${results} 个），客户主结果是${OUTCOME_STEP_LABEL[outcome.primary]}`,
        units: [unit],
        evidence: { window_start: ctx.window[0], window_end: ctx.date, spend, results, unit_result: step, target_cost: target },
        sample: [{ label: OUTCOME_STEP_LABEL[step], value: results }, { label: '有花费的天数', value: rows.filter(r => r.spend > 0).length }],
        reasons: ['目标单次成本只按客户主结果设了一个，量不了这种结果，所以这个组暂时不按成本判；它自己一个结果都没有时照样会报'],
        clientVisible: true,
      })
      continue
    }
    if (cpr !== null && cpr < threshold) continue
    const spendDays = rows.filter(r => r.spend > 0).length
    if (results > 0 && results < D3_SMALL_SAMPLE && spendDays < D3_SMALL_SAMPLE) continue
    const noteOnly = alertOnly ? '（只提醒，不会自动暂停）' : ''
    const who = `广告组「${s.entity_name ?? s.entity_id}」`
    const tail = campaignTotalTail(ctx, input, s)
    out.push({
      code: 'D3', status: 'hit',
      ...(alertOnly ? { autoPauseEligible: false } : {}),
      title: results === 0
        ? `花钱没结果${noteOnly}：${who}投放 ${spendDays} 天花了 ${money(ctx, spend)}，${OUTCOME_STEP_LABEL[step]} 0 个${tail}`
        : `花钱结果太少${noteOnly}：${who}投放 ${spendDays} 天花了 ${money(ctx, spend)}，${OUTCOME_STEP_LABEL[step]} ${results} 个，每个 ${money(ctx, cpr)}（目标 ${money(ctx, target)}）${tail}`,
      units: [unit],
      evidence: { window_start: ctx.window[0], window_end: ctx.date, spend, results, cost_per_result: cpr, target_cost: target, multiple: D3_COST_MULTIPLE },
      sample: [{ label: OUTCOME_STEP_LABEL[step], value: results }, { label: '有花费的天数', value: spendDays }],
      reasons: [`花费 ≥ ${D3_COST_MULTIPLE}× 目标，且单次成本 ≥ ${D3_COST_MULTIPLE}× 目标`],
      clientVisible: true,
    })
  }
  return out
}
