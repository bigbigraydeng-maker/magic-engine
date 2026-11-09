/**
 * O3 · 预算错配（机会版，spec 2026-09-24 §3 G3）。只读，不出动作。
 *
 * D5 找"花了钱没拿到结果"的单位；O3 找反面——**结果占比明显高于预算占比**的单位，
 * 也就是"钱没给够、但已经在出结果"的独立预算单位，值得在同角色内挪预算过去。
 *
 * 口径与 D5 完全一致（同一套可比性闸、同一个统计检验、同一个多重比较修正），
 * 只有命中方向相反：D5 报 result_share 显著低于 spend_share，O3 报显著高于。
 * 同角色单位数 < 2 时静默跳过（跟 D5 一致：无从比较就不出声，不报 not_comparable）。
 */

import type { AccountContext } from '../diagnostics/context'
import { adsetRows, sumSpend } from '../diagnostics/context'
import { countOutcome, isAttributableForBudget, OUTCOME_STEP_LABEL } from '../outcome-ladder'
import type { FunnelRole } from '../roles'
import type { Diagnosis, DiagnosisInput } from '../diagnostics/types'
import { D5_FDR_Q, D5_MIN_SHARE_GAP } from '../diagnostics/thresholds'
import { benjaminiHochberg, binomialTwoSidedP, toUnit } from '../diagnostics/d5-budget-result-mismatch'

const COMPARABLE_ROLES: readonly FunnelRole[] = ['acquisition', 'retargeting', 'expansion']
const round3 = (n: number) => Math.round(n * 1000) / 1000

export function findBudgetMismatch(ctx: AccountContext, input: DiagnosisInput): Diagnosis[] {
  const out: Diagnosis[] = []
  const primary = input.outcome.primary
  for (const role of COMPARABLE_ROLES) {
    const units = ctx.budgetUnits
      .filter(u => u.role === role)
      .map(u => ({ u, rows: adsetRows(ctx, u.adsetIds) }))
      .filter(x => sumSpend(x.rows) > 0)
    // 同角色只有一个预算单位 → 无从比较，静默跳过（与 D5 一致）
    if (units.length < 2) continue

    const base = { code: 'O3' as const, clientVisible: false }
    const window = { window_start: ctx.window[0], window_end: ctx.date, role }
    if (!input.outcomeConfigured || primary === null) {
      out.push({ ...base, status: 'not_comparable', notComparableReason: 'outcome_not_configured', title: '预算错配判不了：客户还没设置主结果', units: units.map(x => toUnit(ctx, x.u)), evidence: window, sample: [{ label: '同角色预算单位', value: units.length }], reasons: ['没有主结果就没有可比的「结果占比」'] })
      continue
    }

    const counted = units.map(x => {
      const adsetGoal = (id: string) => ctx.adsets.get(id)?.optimization_goal ?? null
      const counts = x.rows.map(r => countOutcome(primary, r, { messagingReferralAvailable: input.messagingReferralAvailable, optimizationGoal: adsetGoal(r.entity_id) }))
      return { ...x, spend: sumSpend(x.rows), counts, results: counts.reduce((a, c) => a + (c.value ?? 0), 0), attributable: counts.every(isAttributableForBudget) }
    })

    const unattributable = counted.filter(c => !c.attributable)
    if (unattributable.length > 0) {
      out.push({ ...base, status: 'not_comparable', notComparableReason: 'primary_not_attributable', title: `预算错配判不了：${OUTCOME_STEP_LABEL[primary]}归不到具体广告单位`, units: unattributable.map(c => toUnit(ctx, c.u)), evidence: window, sample: [{ label: '归不上的单位', value: unattributable.length }], reasons: ['主结果 UNKNOWN 或只有启发式归属，禁止进 O3（§14 M2/M3）', ...unattributable.flatMap(c => c.counts.map(k => k.note).filter((n): n is string => !!n)).slice(0, 1)] })
      continue
    }

    const min = input.outcome.minPrimaryPerUnit
    const totalSpend = counted.reduce((a, c) => a + c.spend, 0)
    const totalResults = counted.reduce((a, c) => a + c.results, 0)
    const gapOf = (c: (typeof counted)[number]) =>
      Math.abs((totalResults > 0 ? c.results / totalResults : 0) - (totalSpend > 0 ? c.spend / totalSpend : 0))
    // 样本量闸：少于最低数的单位不参与比较。只有它**看起来**错配（占比差 ≥ 门槛）时才说「判不了」，
    // 否则健康日会天天冒一条「数量太少」噪音（与 D5 同口径）。
    const thin = counted.filter(c => c.results < min)
    const thinSuspicious = thin.filter(c => gapOf(c) >= D5_MIN_SHARE_GAP)
    const enough = counted.filter(c => c.results >= min)
    if (thinSuspicious.length > 0) {
      out.push({ ...base, status: 'not_comparable', notComparableReason: 'below_min_sample', title: `预算错配判不了：有单位${OUTCOME_STEP_LABEL[primary]}少于 ${min} 个，数量太少下结论不靠谱`, units: thinSuspicious.map(c => toUnit(ctx, c.u)), evidence: { ...window, min_primary_per_unit: min }, sample: thinSuspicious.map(c => ({ label: `${c.u.name ?? c.u.id} 的${OUTCOME_STEP_LABEL[primary]}`, value: c.results })), reasons: ['样本量闸：每单位主结果 ≥ 客户配置的最低数'] })
    }
    if (enough.length < 2) continue

    const S = enough.reduce((a, c) => a + c.spend, 0)
    const N = enough.reduce((a, c) => a + c.results, 0)
    const stats = enough.map(c => {
      const spendShare = c.spend / S
      const resultShare = c.results / N
      return { c, spendShare, resultShare, p: binomialTwoSidedP(c.results, N, spendShare) }
    })
    const adj = benjaminiHochberg(stats.map(s => s.p))
    // 与 D5 相反：结果占比**显著高于**预算占比 → 钱没给够
    const flagged = stats
      .map((s, i) => ({ ...s, adj: adj[i] }))
      .filter(s => s.adj <= D5_FDR_Q && s.resultShare - s.spendShare >= D5_MIN_SHARE_GAP)
    for (const s of flagged) {
      out.push({
        ...base, status: 'hit',
        title: '同角色里这条广告组的结果占比明显高于预算占比，预算可以往它倾斜',
        units: [toUnit(ctx, s.c.u)],
        evidence: { ...window, spend: s.c.spend, results: s.c.results, spend_share: round3(s.spendShare), result_share: round3(s.resultShare), p_value: round3(s.p), bh_adjusted_p: round3(s.adj), group_units: enough.length, group_results: N },
        sample: [{ label: `同组${OUTCOME_STEP_LABEL[primary]}合计`, value: N }, { label: `本单位${OUTCOME_STEP_LABEL[primary]}`, value: s.c.results }],
        reasons: ['建议在同角色内挪预算（ads.budget_move_plan，总额不变）——本阶段只发现，不出动作'],
      })
    }
  }
  return out
}
