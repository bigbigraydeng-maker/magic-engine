/**
 * 端到端 lineage —— 一等公民，不是事后补的报表。
 *
 * 现状（审计实测）：全仓只有**一条**跨表 lineage 边（`flywheel_actions.execution_item_id`）。
 * 问「上周那篇文章现在到哪一步了」要人手拼 5 张表。
 *
 * 这条链必须能回答五个问题：
 *   为什么做（goal + rationale + evidence）→ 谁授权的（decision）→
 *   做到哪（steps）→ 是否真的做成了（verification）→ 产生了什么业务结果（outcome）
 *
 * SQL 侧的等价物是 `kernel_action_lineage` 视图（同一个迁移里建的），
 * 给运维和 PM 直接查；这里的 TS 版给应用用，两边字段一一对应。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun, ActionRunStep, AuthorizationDecision, VerificationResult } from './types'
import { getDecision, getRun, listSteps } from './store'

export interface ActionLineage {
  goal: { id: string; title: string | null } | null
  run: ActionRun
  authorization: AuthorizationDecision | null
  steps: ActionRunStep[]
  verification: VerificationResult | null
  flywheelActionIds: string[]
  outcomes: Array<{ id: string; metric_key: string; verdict: string; window_days: number }>
  /** 一句话说清这条链现在到哪了 —— 给人看，不是给机器解析的。 */
  humanSummary: string
}

export async function loadActionLineage(
  sb: SupabaseClient,
  runId: string,
): Promise<ActionLineage | null> {
  const run = await getRun(sb, runId)
  if (!run) return null

  const [decision, steps] = await Promise.all([
    run.authorization_decision_id ? getDecision(sb, run.authorization_decision_id) : Promise.resolve(null),
    listSteps(sb, runId),
  ])

  let goal: ActionLineage['goal'] = null
  if (run.goal_id) {
    const { data, error } = await sb.from('goals').select('id, title').eq('id', run.goal_id).limit(1)
    // 🔴 读失败不当成「没有目标」。那会让一次数据库抖动看起来像
    //    「这条动作本来就不挂目标」—— 恰好是我们花力气在数据库层禁止的那件事。
    if (error) throw new Error(`[kernel/lineage] 读取目标失败：${error.message}`)
    const row = (data ?? [])[0] as unknown as { id: string; title: string | null } | undefined
    goal = row ? { id: row.id, title: row.title } : null
  }

  const { data: faRows, error: faErr } = await sb
    .from('flywheel_actions')
    .select('id')
    .eq('action_run_id', runId)
  if (faErr) throw new Error(`[kernel/lineage] 读取飞轮动作失败：${faErr.message}`)
  const flywheelActionIds = ((faRows ?? []) as unknown as Array<{ id: string }>).map((r) => r.id)

  let outcomes: ActionLineage['outcomes'] = []
  if (flywheelActionIds.length > 0) {
    const { data: outRows, error: outErr } = await sb
      .from('flywheel_outcomes')
      .select('id, metric_key, verdict, window_days')
      .in('action_id', flywheelActionIds)
    if (outErr) throw new Error(`[kernel/lineage] 读取归因结果失败：${outErr.message}`)
    outcomes = (outRows ?? []) as unknown as ActionLineage['outcomes']
  }

  const verification = steps.reduce<VerificationResult | null>(
    (acc, s) => (s.verification ? s.verification : acc),
    null,
  )

  return {
    goal,
    run,
    authorization: decision,
    steps,
    verification,
    flywheelActionIds,
    outcomes,
    humanSummary: summarise({ run, decision, steps, verification, outcomes }),
  }
}

function summarise(args: {
  run: ActionRun
  decision: AuthorizationDecision | null
  steps: ActionRunStep[]
  verification: VerificationResult | null
  outcomes: ActionLineage['outcomes']
}): string {
  const { run, decision, steps, verification, outcomes } = args
  const done = steps.filter((s) => s.status === 'succeeded').length
  const who =
    decision?.decided_by === 'human'
      ? `${decision.decided_by_user} 点头`
      : decision
        ? '按客户预设规则自动放行'
        : '还没走授权'
  const verified = verification ? (verification.passed ? '验过了' : '验没过') : '没做验证'
  const measured = outcomes.length > 0 ? `已回流 ${outcomes.length} 条业务结果` : '还没有业务结果回流'
  return `${run.action_key}：${who}；${steps.length} 步里做完 ${done} 步，现在是「${run.status}」；${verified}；${measured}`
}
