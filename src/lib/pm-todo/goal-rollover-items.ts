/**
 * 「月循环目标过了月底、没有自动续上」→ 下发到待办（开发栏）。
 *
 * 为什么要有：`goals-expiry-check` 每天自动续建下个月的目标（goal-rollover.ts），
 * 但它失败了只会写进 cron_run_logs —— 没人看。广告自治 / 日报每天都要读"生效中的
 * 目标"，缺了它，涨预算和部分止损动作会被拒（no_active_goal），日报写"没有生效中的目标"。
 *
 * 判据是**现在这条链有没有断**：同一客户同一指标的月循环目标里，最晚结束的那条
 * 已经过了昨天，说明至少一次续建没成。续上之后下一次扫描它自己消失，不需要"已处理"标记。
 * 本文件一行写操作都没有。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

export type GoalRolloverItemKind = 'goal_rollover_missing'

interface MonthlyGoalRow {
  id: string
  client_id: string
  title: string
  primary_metric_key: string
  period_end: string
}

const DAY_MS = 86_400_000

/** 宽限一天：月底当天夜里续建、03:30 UTC 才跑，不能一过 0 点就报。 */
function isoDayMinus(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)
}

export async function pushGoalRolloverItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const { data, error } = await supabase
    .from('goals')
    .select('id, client_id, title, primary_metric_key, period_end')
    .eq('recurrence', 'monthly')
  // 读失败必须炸（外层 catch 会写告警）——当成"没有断档"会把数据库抖动变成一次漏报。
  if (error) throw new Error(`goal-rollover-items: ${error.message}`)

  // 每个 (客户, 指标) 只看最晚结束的那条。
  const latest = new Map<string, MonthlyGoalRow>()
  for (const row of (data ?? []) as MonthlyGoalRow[]) {
    const key = `${row.client_id}::${row.primary_metric_key}`
    const cur = latest.get(key)
    if (!cur || row.period_end > cur.period_end) latest.set(key, row)
  }

  const cutoff = isoDayMinus(today, 1)
  for (const goal of latest.values()) {
    if (goal.period_end >= cutoff) continue
    items.push({
      kind: 'goal_rollover_missing',
      client_id: goal.client_id,
      client_name: nameOf(goal.client_id),
      what:
        `「${goal.title}」这条每月自动续建的目标，在 ${goal.period_end} 结束之后没有续上下一个月。` +
        '现在这个客户没有生效中的目标：广告自治会拒绝涨预算这类动作，日报也会写"没有生效中的目标"。',
      how:
        '让开发看一眼每天自动跑的"目标过期检查"最近一次的运行记录（报错在那里）；' +
        '修好后它第二天会自己补上，不用手动建。着急的话可以让开发手动触发一次。',
      href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(goal.client_id)}/goal/${encodeURIComponent(goal.id)}`,
    })
  }
}
