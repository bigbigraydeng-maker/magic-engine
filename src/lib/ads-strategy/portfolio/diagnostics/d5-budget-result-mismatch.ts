/**
 * D5 · 钱和结果错配，设计 §3.3 + §14 M2/M3/M6/M7/M9。只读，**不出任何挪预算处方**。
 *
 * 只比：
 *   - **独立预算单位**之间（ABO 广告组之间、CBO 系列之间）——CBO 系列内部的广告组绝不互比（Meta 自己在分钱）
 *   - **同一角色**（M6）——破冰组不参与主结果占比；mixed / unknown 说不清角色，不参与
 *   - 主结果能**确定归到单位**的（平台直报或 Webhook 来源；UNKNOWN / 启发式 → not_comparable，M2/M3）
 *   - 每单位主结果 ≥ 客户配置的最低数（样本量闸）
 * 共用账户整账户不比（M9，run.ts 已在外层拦掉）；Meta 实验中的单位已从预算单位里去掉（M7）。
 *
 * 判定：窗口 7 天，花费占比 vs 主结果占比；每个单位做精确二项检验（H0：结果占比 = 花费占比），
 * 同组多单位用 Benjamini–Hochberg 控制错误发现率；调整后 p ≤ q 且占比差 ≥ 0.15 才报。
 */

import type { AccountContext, BudgetUnit } from './context'
import { adsetRows, sumSpend } from './context'
import { countOutcome, isAttributableForBudget, OUTCOME_STEP_LABEL } from '../outcome-ladder'
import type { FunnelRole } from '../roles'
import type { Diagnosis, DiagnosisInput, DiagnosisUnit } from './types'
import { D5_FDR_Q, D5_MIN_SHARE_GAP } from './thresholds'

const COMPARABLE_ROLES: readonly FunnelRole[] = ['acquisition', 'retargeting', 'expansion']
const round3 = (n: number) => Math.round(n * 1000) / 1000

function logFactorial(n: number): number {
  let s = 0
  for (let i = 2; i <= n; i++) s += Math.log(i)
  return s
}

/** 精确二项检验双侧 p 值（把概率 ≤ 观测值概率的结果都加起来）。 */
export function binomialTwoSidedP(k: number, n: number, p: number): number {
  if (n === 0) return 1
  if (p <= 0) return k === 0 ? 1 : 0
  if (p >= 1) return k === n ? 1 : 0
  const lf = logFactorial(n)
  const pmf = (i: number) => Math.exp(lf - logFactorial(i) - logFactorial(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p))
  const observed = pmf(k)
  let total = 0
  for (let i = 0; i <= n; i++) {
    const v = pmf(i)
    if (v <= observed * (1 + 1e-9)) total += v
  }
  return Math.min(1, total)
}

/** Benjamini–Hochberg 调整后 p 值（与输入同序）。 */
export function benjaminiHochberg(ps: number[]): number[] {
  const m = ps.length
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const adj = Array.from({ length: m }, () => 1)
  let running = 1
  for (let r = m - 1; r >= 0; r--) {
    running = Math.min(running, (order[r].p * m) / (r + 1))
    adj[order[r].i] = Math.min(1, running)
  }
  return adj
}

function toUnit(ctx: AccountContext, u: BudgetUnit): DiagnosisUnit {
  return { level: u.level, id: u.id, name: u.name, adAccountId: ctx.account.adAccountId, role: u.role, roleConfidence: u.confidence }
}

export function diagnoseBudgetResultMismatch(ctx: AccountContext, input: DiagnosisInput): Diagnosis[] {
  const out: Diagnosis[] = []
  const primary = input.outcome.primary
  for (const role of COMPARABLE_ROLES) {
    const units = ctx.budgetUnits
      .filter(u => u.role === role)
      .map(u => ({ u, rows: adsetRows(ctx, u.adsetIds) }))
      .filter(x => sumSpend(x.rows) > 0)
    if (units.length < 2) continue

    const base = { code: 'D5' as const, clientVisible: false }
    const window = { window_start: ctx.window[0], window_end: ctx.date, role }
    if (!input.outcomeConfigured || primary === null) {
      out.push({ ...base, status: 'not_comparable', notComparableReason: 'outcome_not_configured', title: '钱和结果错配判不了：客户还没设置主结果', units: units.map(x => toUnit(ctx, x.u)), evidence: window, sample: [{ label: '同角色预算单位', value: units.length }], reasons: ['没有主结果就没有可比的「结果占比」'] })
      continue
    }

    const counted = units.map(x => {
      const adsetGoal = (id: string) => ctx.adsets.get(id)?.optimization_goal ?? null
      const counts = x.rows.map(r => countOutcome(primary, r, { messagingReferralAvailable: input.messagingReferralAvailable, optimizationGoal: adsetGoal(r.entity_id) }))
      return { ...x, spend: sumSpend(x.rows), counts, results: counts.reduce((a, c) => a + (c.value ?? 0), 0), attributable: counts.every(isAttributableForBudget) }
    })

    const unattributable = counted.filter(c => !c.attributable)
    if (unattributable.length > 0) {
      out.push({ ...base, status: 'not_comparable', notComparableReason: 'primary_not_attributable', title: `钱和结果错配判不了：${OUTCOME_STEP_LABEL[primary]}归不到具体广告单位`, units: unattributable.map(c => toUnit(ctx, c.u)), evidence: window, sample: [{ label: '归不上的单位', value: unattributable.length }], reasons: ['主结果 UNKNOWN 或只有启发式归属，禁止进 D5（§14 M2/M3）', ...unattributable.flatMap(c => c.counts.map(k => k.note).filter((n): n is string => !!n)).slice(0, 1)] })
      continue
    }

    const min = input.outcome.minPrimaryPerUnit
    const totalSpend = counted.reduce((a, c) => a + c.spend, 0)
    const totalResults = counted.reduce((a, c) => a + c.results, 0)
    const gapOf = (c: (typeof counted)[number]) =>
      Math.abs((totalResults > 0 ? c.results / totalResults : 0) - (totalSpend > 0 ? c.spend / totalSpend : 0))
    // 样本量闸：少于最低数的单位不参与比较。只有当它**看起来**错配（占比差 ≥ 门槛）时才说「判不了」，
    // 否则健康日会天天冒一条「数量太少」噪音（2026-09-14 Oztop 8/04 回放发现）。
    const thin = counted.filter(c => c.results < min)
    const thinSuspicious = thin.filter(c => gapOf(c) >= D5_MIN_SHARE_GAP)
    const enough = counted.filter(c => c.results >= min)
    if (thinSuspicious.length > 0) {
      const thin = thinSuspicious
      out.push({ ...base, status: 'not_comparable', notComparableReason: 'below_min_sample', title: `钱和结果错配判不了：有单位${OUTCOME_STEP_LABEL[primary]}少于 ${min} 个，数量太少下结论不靠谱`, units: thin.map(c => toUnit(ctx, c.u)), evidence: { ...window, min_primary_per_unit: min }, sample: thin.map(c => ({ label: `${c.u.name ?? c.u.id} 的${OUTCOME_STEP_LABEL[primary]}`, value: c.results })), reasons: ['样本量闸：每单位主结果 ≥ 客户配置的最低数'] })
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
    const flagged = stats.map((s, i) => ({ ...s, adj: adj[i] })).filter(s => s.adj <= D5_FDR_Q && Math.abs(s.resultShare - s.spendShare) >= D5_MIN_SHARE_GAP)
    for (const s of flagged) {
      out.push({
        ...base, status: 'hit',
        title: `钱和结果错配：${s.c.u.name ?? s.c.u.id} 花了 ${Math.round(s.spendShare * 100)}% 的钱，拿到 ${Math.round(s.resultShare * 100)}% 的${OUTCOME_STEP_LABEL[primary]}`,
        units: [toUnit(ctx, s.c.u)],
        evidence: { ...window, spend: s.c.spend, results: s.c.results, spend_share: round3(s.spendShare), result_share: round3(s.resultShare), p_value: round3(s.p), bh_adjusted_p: round3(s.adj), group_units: enough.length, group_results: N },
        sample: [{ label: `同组${OUTCOME_STEP_LABEL[primary]}合计`, value: N }, { label: `本单位${OUTCOME_STEP_LABEL[primary]}`, value: s.c.results }],
        reasons: ['只比同角色的独立预算单位；二项检验 + Benjamini–Hochberg 多重比较修正', '只读诊断，不出挪预算处方'],
      })
    }
  }
  return out
}
