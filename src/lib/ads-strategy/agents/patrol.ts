/**
 * 卫青 · 巡察（spec 2026-09-24 §4）。IMPACT 的 Inspect + Measure 两段。
 *
 * 每天把三样东西合成一份「广告经营状态」写进 `ads_growth_states`：
 *   问题（D1–D9，现有诊断引擎）· 机会（O1–O3，新）· 目标节奏（WP0 的 goal-pace）
 * 看板和日报都从这一行读，不再各自去拼。
 *
 * 🔴 数据不全的日子（completeness='partial'）：诊断照跑不误——D7「授权/数据体检」
 *    的职责恰恰是报「数据采集坏了」这件事；但机会一条都不出。机会判断全靠占比和
 *    趋势，分子被系统性拉低时最容易凭空报出「潜在爆款」，而 API 不稳和账户端出事
 *    常常同源，缺数据的那天恰恰最可能是真出事的那天。
 *
 * 不出处方、不出动作、不碰 Kernel —— 那些是 WP2/WP3。这一层只负责「看见」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { loadDiagnosisInput } from '../portfolio/diagnostics/loader'
import { runDiagnostics } from '../portfolio/diagnostics/run'
import { runOpportunities, type DataCompleteness } from '../portfolio/opportunities/run'
import { buildDigestGoalContext } from '../portfolio/goal-context'
import type { AccountInput, AdLevelCoverage, Diagnosis, ExcludedEntity } from '../portfolio/diagnostics/types'
import type { DigestGoalContext } from '../portfolio/internal-digest'

/** 一个账户某一层日数据的同步结果——只关心成没成。 */
export interface SyncLevelResult {
  success: boolean
}

/** 一个广告账户三层日数据的同步结果。缺字段 = 这一层压根没跑，按不完整算。 */
export interface AccountSyncResults {
  campaign?: SyncLevelResult | null
  adset?: SyncLevelResult | null
  ad?: SyncLevelResult | null
}

export interface CompletenessInput {
  /** 主账户 + 所有次账户，每个都要三层齐全才算完整。 */
  accounts: AccountSyncResults[]
  /** 当天 `ad_snapshot_captures` 是否每个账户每层都抓全了。 */
  capturesComplete: boolean
}

export interface CompletenessVerdict {
  completeness: DataCompleteness
  /** 人话原因，写进 payload 给日报直接用；完整时为空数组。 */
  reasons: string[]
}

const LEVEL_LABEL: Record<keyof AccountSyncResults, string> = {
  campaign: '广告系列级',
  adset: '广告组级',
  ad: '广告级',
}

/**
 * 判定当天数据全不全。纯函数。
 *
 * 🔴 三层都要查。现有 cron 里那个 `if (result.ad_daily?.success)` 只看了广告系列级，
 *    而 D3–D9 和 O1–O3 大多是广告组粒度——只查一层等于漏掉大部分缺数据的情况。
 */
export function resolveCompleteness(input: CompletenessInput): CompletenessVerdict {
  const reasons: string[] = []

  input.accounts.forEach((acc, i) => {
    for (const level of ['campaign', 'adset', 'ad'] as const) {
      const r = acc[level]
      if (!r) reasons.push(`第 ${i + 1} 个广告账户的${LEVEL_LABEL[level]}日数据这次没跑`)
      else if (!r.success) reasons.push(`第 ${i + 1} 个广告账户的${LEVEL_LABEL[level]}日数据拉取失败`)
    }
  })

  if (input.accounts.length === 0) reasons.push('这个客户这次一个广告账户的日数据都没同步')
  if (!input.capturesComplete) reasons.push('当天广告设置快照没抓全')

  return { completeness: reasons.length > 0 ? 'partial' : 'complete', reasons }
}

/**
 * 当天设置快照抓全了没有。纯函数。
 *
 * `skipped_shared` 是合法跳过——共用账户按 §14 M9 本来就只抓账户级，不算缺数据；
 * 其余任何一层 `complete === false` 都算没抓全。
 */
export function capturesComplete(accounts: readonly AccountInput[]): boolean {
  return accounts.every(a => a.latestCaptures.every(c => c.skipped_shared || c.complete))
}

/**
 * D5 与 O3 的方向性重叠去重（子牙 WP1 复审 2026-09-24 查出，已核实）。
 *
 * D5 的筛选用 `Math.abs(resultShare - spendShare)` —— 两侧都报；O3 只报
 * `resultShare - spendShare` 为正的那一侧。两边共用同一组 `COMPARABLE_ROLES`、
 * 同一套二项检验 + BH 修正、同一对阈值常量，所以数学上 **O3 ⊆ D5**：
 * 每一条 O3 命中必然也是一条 D5 命中。
 *
 * 不去重的话，同一条广告组同一天会同时出现在经营视图的「要看的事」和
 * 「可以加力的地方」两栏，而且说法相反（一个说错配、一个说该加钱），PM 无从判断。
 *
 * 只丢 D5 那张，留 O3：后者带方向、能直接对应到动作。
 * 🔴 只作用于经营视图。现有技术版日报（runPortfolioDiagnostics → internal-digest）
 *    那条链路完全不经过这里，D5 在那边照旧全量上报，行为零变化。
 */
export function dropProblemsSupersededByOpportunities(
  problems: readonly Diagnosis[],
  opportunities: readonly Diagnosis[],
): { problems: Diagnosis[]; supersededCount: number } {
  const o3Units = new Set(
    opportunities
      .filter(o => o.code === 'O3' && o.status === 'hit')
      .flatMap(o => o.units.map(u => u.id)),
  )
  if (o3Units.size === 0) return { problems: [...problems], supersededCount: 0 }

  let supersededCount = 0
  const kept = problems.filter(p => {
    const duplicate =
      p.code === 'D5' && p.status === 'hit' && p.units.length > 0 && p.units.every(u => o3Units.has(u.id))
    if (duplicate) supersededCount += 1
    return !duplicate
  })
  return { problems: kept, supersededCount }
}

/** 存进 `ads_growth_states.payload` 的东西。看板和日报都读这个形状。 */
export interface GrowthStatePayload {
  headline: string
  dataCompleteness: DataCompleteness
  completenessReasons: string[]
  problems: Diagnosis[]
  opportunities: Diagnosis[]
  /** 机会整段没跑时的人话原因；跑了就是 null。 */
  opportunitiesSkippedReason: string | null
  /** 因为同一单位已在「可以加力的地方」出现而没在「要看的事」里重复显示的条数（D5 ⊇ O3）。 */
  problemsSupersededByOpportunities: number
  excluded: ExcludedEntity[]
  /** 每个广告账户上广告级规则（D2/D10）跑没跑（Magic Bridge 据此区分「没发现」和「没检查」） */
  adLevelCoverage: AdLevelCoverage[]
  goal: DigestGoalContext | null
  evaluatedAt: string
}

export interface BuildGrowthStateResult {
  success: boolean
  date?: string
  problems?: number
  opportunities?: number
  completeness?: DataCompleteness
  error?: string
}

/** 一句人话结论。确定性模板，不调 LLM —— 日报和看板的第一行不该依赖一次可能失败的外部调用。 */
export function buildHeadline(
  problems: Diagnosis[],
  opportunities: Diagnosis[],
  completeness: DataCompleteness,
  goal: DigestGoalContext | null,
): string {
  const hits = problems.filter(d => d.status === 'hit').length
  const opps = opportunities.filter(d => d.status === 'hit').length
  const parts: string[] = []

  if (goal && goal.pace.verdict !== 'unknown') {
    const v = goal.pace.verdict
    if (v === 'unreachable_within_caps') parts.push('目标按现在的预算上限到不了')
    else if (v === 'behind') parts.push('目标进度落后')
    else parts.push('目标按节奏走')
  }

  if (hits > 0) parts.push(`${hits} 件要看的事`)
  if (opps > 0) parts.push(`${opps} 个可以加力的地方`)
  if (hits === 0 && opps === 0) parts.push(completeness === 'partial' ? '数据没拉全，今天只看不动' : '今天没发现要紧的事')
  else if (completeness === 'partial') parts.push('（数据没拉全，机会没判）')

  return parts.join('，')
}

/**
 * 跑一个客户当天的巡察并落库。尽力而为，不抛：巡察失败不能影响数据同步和体检。
 *
 * `syncAccounts` 由调用方（每日 cron）给出——它才知道这一轮三层日数据各自成没成；
 * 设置快照的覆盖度这边自己从诊断输入里读，不劳调用方再查一次库。
 */
export async function buildGrowthState(
  clientId: string,
  date: string,
  syncAccounts: readonly AccountSyncResults[],
): Promise<BuildGrowthStateResult> {
  try {
    const evaluatedAt = new Date().toISOString()
    const input = await loadDiagnosisInput(clientId, date, evaluatedAt)
    const completeness = resolveCompleteness({
      accounts: [...syncAccounts],
      capturesComplete: capturesComplete(input.accounts),
    })

    // 诊断永远跑：数据坏了正是 D7 要报的事。
    const diagnosisRun = runDiagnostics(input)
    // 机会只在数据齐的日子跑。
    const opportunityRun = runOpportunities(input, completeness.completeness)

    const goal = await buildDigestGoalContext(clientId, date)

    // O3 ⊆ D5：同一单位不要在两栏里各说一遍（见 dropProblemsSupersededByOpportunities）。
    const { problems, supersededCount } = dropProblemsSupersededByOpportunities(
      diagnosisRun.diagnoses,
      opportunityRun.opportunities,
    )

    const payload: GrowthStatePayload = {
      headline: buildHeadline(problems, opportunityRun.opportunities, completeness.completeness, goal),
      dataCompleteness: completeness.completeness,
      completenessReasons: completeness.reasons,
      problems,
      opportunities: opportunityRun.opportunities,
      opportunitiesSkippedReason: opportunityRun.skippedReason,
      problemsSupersededByOpportunities: supersededCount,
      excluded: diagnosisRun.excluded,
      adLevelCoverage: diagnosisRun.adLevelCoverage ?? [],
      goal,
      evaluatedAt,
    }

    const { error } = await supabaseAdmin.from('ads_growth_states').upsert(
      {
        client_id: clientId,
        date,
        payload,
        problems_count: problems.filter(d => d.status === 'hit').length,
        opportunities_count: opportunityRun.opportunities.filter(d => d.status === 'hit').length,
        goal_pace: goal?.pace ?? null,
        data_completeness: completeness.completeness,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,date' },
    )
    if (error) return { success: false, error: error.message }

    return {
      success: true,
      date,
      problems: payload.problems.filter(d => d.status === 'hit').length,
      opportunities: payload.opportunities.filter(d => d.status === 'hit').length,
      completeness: completeness.completeness,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
