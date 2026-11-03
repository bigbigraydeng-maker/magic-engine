/**
 * 每周调整建议 —— 纯函数（IMPACT 的 Tune 段）。
 * 输入对账 + 每日检查结果 + 检查证据，输出「补数据 / 补执行 / 改处方 / 继续」中的一个建议。
 *
 * 规则：
 *  - 判断顺序固定：补数据 → 补执行 → 改处方 → 继续，前一档命中就返回；
 *  - 读不到的事实（unknown）先补数据，绝不当 0；
 *  - immature / info 状态、平台自报结果（results_meta）从不触发调整；
 *  - 阈值是导出常量，不读客户配置；
 *  - 只给建议，不生成处方、不碰钱、不写库。
 */

import type { AdjustDecision, PromoAdjustmentRecord } from '../types'
import type { WatchCode, WatchFinding } from './daily-watch'
import { addDays, type Reconciliation, type ReconcileRow } from './reconcile'

/** 目标进度连续落后几个窗口，才建议改处方。 */
export const CONSECUTIVE_BEHIND_WINDOWS = 2
/** 复检默认间隔（天）。不用 7 的倍数，避免每次都落在同一个星期几。 */
export const DEFAULT_RECHECK_DAYS = 6
const WINDOW_DAYS = 7

/** 检查证据的最小形状；没有检查证据 = null。 */
export interface AdjustCheckEvidence {
  status: 'declared' | 'unknown'
  reason?: string
}

export interface AdjustInput {
  reconcile: Reconciliation
  findings: WatchFinding[]
  checkEvidence: AdjustCheckEvidence | null
  /** 当前阶段的实验卡上限（分）；没有实验 = null */
  experiment: { max_loss_cents: number } | null
  spentCentsInExperiment: number | null
  priorAdjustments: PromoAdjustmentRecord[]
}

export interface AdjustSuggestion {
  decision: AdjustDecision
  reasons: string[]
  experiment_hit: 'stop_rule' | 'max_loss' | null
}

const DATA_CODES: WatchCode[] = ['reconcile_blind', 'plan_structure_unreadable', 'daily_plan_unreadable']
const EXECUTION_CODES: WatchCode[] = ['phase_gate_failed', 'daily_plan_gap', 'approved_content_changed']

function row(r: Reconciliation, key: ReconcileRow['key']): ReconcileRow | undefined {
  return r.rows.find(x => x.key === key)
}

function hasCode(findings: WatchFinding[], codes: WatchCode[]): boolean {
  return findings.some(f => codes.includes(f.code))
}

/** 本窗口是否需要人来决定怎么调（正常周走「按计划继续」）。 */
export function isAbnormalWindow(reconcile: Reconciliation, findings: WatchFinding[]): boolean {
  if (reconcile.blind) return true
  if (hasCode(findings, [...DATA_CODES, ...EXECUTION_CODES])) return true
  return reconcile.rows.some(r => {
    if (r.key === 'results_meta') return false
    if (r.status === 'behind' || r.status === 'over') return true
    return r.status === 'unknown' && (r.key === 'spend' || r.key === 'results_goal' || r.key === 'content')
  })
}

function dataReasons(i: AdjustInput): string[] {
  const out: string[] = []
  const { reconcile: rec } = i
  if (rec.blind) out.push('本周对账看不清')
  for (const key of ['spend', 'results_goal', 'content'] as const) {
    if (row(rec, key)?.status === 'unknown') out.push(`${row(rec, key)?.label.split('（')[0]}读不出来`)
  }
  if (i.experiment && i.spentCentsInExperiment === null) out.push('实验累计花费读不出来')
  if (i.checkEvidence === null) out.push('没有检查证据')
  else if (i.checkEvidence.status === 'unknown') out.push(`检查证据看不清${i.checkEvidence.reason ? `：${i.checkEvidence.reason}` : ''}`)
  if (hasCode(i.findings, DATA_CODES)) out.push('每日检查发现数据读不出来')
  return out
}

function executionReasons(i: AdjustInput): string[] {
  const out: string[] = []
  if (hasCode(i.findings, EXECUTION_CODES)) out.push('每日检查发现执行没到位（阶段检查没过、每日计划缺口或批准后内容被改）')
  if (row(i.reconcile, 'content')?.status === 'behind') out.push('本周内容发布落后于计划')
  if (row(i.reconcile, 'spend')?.status === 'behind') out.push('花费落后于计划（钱没花出去，是执行没到位）')
  return out
}

/** 在当前窗口之前，是否有 CONSECUTIVE_BEHIND_WINDOWS-1 个紧邻窗口的目标进度都是落后。 */
function priorWindowsBehind(i: AdjustInput): boolean {
  const need = CONSECUTIVE_BEHIND_WINDOWS - 1
  for (let k = 1; k <= need; k++) {
    const start = addDays(i.reconcile.window.start, -WINDOW_DAYS * k)
    const rec = i.priorAdjustments.find(p => p.window.start === start)
    if (!rec?.trigger.rows.some(r => r.key === 'results_goal' && r.status === 'behind')) return false
  }
  return true
}

function latestPriorStopRule(i: AdjustInput): boolean {
  const before = i.priorAdjustments
    .filter(p => p.window.start < i.reconcile.window.start)
    .sort((a, b) => b.window.start.localeCompare(a.window.start))[0]
  return before?.trigger.experiment_hit === 'stop_rule'
}

function reviseReasons(i: AdjustInput): { reasons: string[]; hit: AdjustSuggestion['experiment_hit'] } {
  const reasons: string[] = []
  let hit: AdjustSuggestion['experiment_hit'] = null
  if (i.experiment && i.spentCentsInExperiment !== null && i.spentCentsInExperiment >= i.experiment.max_loss_cents) {
    hit = 'max_loss'
    reasons.push('实验花费已达到最大可承受损失')
  }
  if (latestPriorStopRule(i)) {
    hit ??= 'stop_rule'
    reasons.push('上一条调整记录标了实验停止条件命中')
  }
  const goal = row(i.reconcile, 'results_goal')
  if (goal?.status === 'behind' && priorWindowsBehind(i)) {
    reasons.push(`目标进度连续 ${CONSECUTIVE_BEHIND_WINDOWS} 个窗口落后`)
  }
  // immature / info 表示还不能判断效果，只有明确 behind 才算「没跟上」。
  if (row(i.reconcile, 'spend')?.status === 'over' && goal?.status === 'behind') {
    reasons.push('花费超出计划，目标进度却没跟上')
  }
  return { reasons, hit }
}

export function suggestAdjustment(input: AdjustInput): AdjustSuggestion {
  const data = dataReasons(input)
  if (data.length > 0) return { decision: 'fix_data', reasons: data, experiment_hit: null }

  const exec = executionReasons(input)
  if (exec.length > 0) return { decision: 'fix_execution', reasons: ['数据齐全', ...exec], experiment_hit: null }

  const { reasons, hit } = reviseReasons(input)
  if (reasons.length > 0) {
    return { decision: 'revise_prescription', reasons: ['数据齐全', '执行到位', ...reasons], experiment_hit: hit }
  }
  return { decision: 'continue', reasons: ['没有命中补数据、补执行、改处方的条件'], experiment_hit: null }
}

/**
 * 复检日期（YYYY-MM-DD）：默认 6 天后；落在周五顺延到周日、落在周六顺延到周一
 * （今日待办这两天不跑；结果都是 8 天，不碰 7 的倍数）。
 */
export function nextRecheckDate(fromDay: string, days: number = DEFAULT_RECHECK_DAYS): string {
  const due = addDays(fromDay, days)
  const dow = new Date(`${due}T00:00:00Z`).getUTCDay()
  return dow === 5 || dow === 6 ? addDays(due, 2) : due
}
