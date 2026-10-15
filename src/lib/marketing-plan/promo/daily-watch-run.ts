/**
 * 推广计划每日检查 —— 读库 + 跑检查 + 出回执（只读）。
 *
 * 把「读哪些计划、怎么跑检查、结果长什么样」收在一个纯读函数里，
 * 让 Inngest 函数（inngest/functions/promo-plan-daily-watch.ts）和
 * 今日待办（pm-todo/promo-plan-watch-items.ts）共用同一份回执。
 *
 * 🔴 本文件一行写库都没有：只读 marketing_plans、只调纯函数 detectWatchFindings。
 *    不发布、不扣费、不外发。回执里的 no_publish 恒为 true，提醒读的人这一点。
 * 🔴 读不到计划列表不算抛错：回执 status='read_failed'、error 带原因，
 *    今日待办会据此出一条「检查没跑成」的待办，而不是安静地什么都不说。
 * 🔴 单份计划算失败（buildPromoBoard 抛错）只把该计划标 error、status 置 'partial'，
 *    不影响其它计划；失败清单单独返回，供待办逐条下发。
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MarketingPlan } from '../types'
import { buildPromoBoard } from './board'
import { detectWatchFindings, type WatchCode, type WatchFinding } from './daily-watch'

/** cron_run_logs 里登记的任务名。 */
export const PROMO_WATCH_JOB = 'promo-plan-daily-watch'
/** 回执事件名：业务可读，回执字段齐全。 */
export const PROMO_WATCH_EVENT = 'promo_plan.watch.checked'
/** 手动触发用的事件名。 */
export const PROMO_WATCH_EVENT_DUE = 'promo_plan.watch.due'

/** 单份计划的回执。 */
export interface WatchPlanReceipt {
  client_id: string
  plan_id: string
  plan_status: string
  findings: WatchCode[]
  error: string | null
}

/** 整轮检查的回执。 */
export interface WatchReceipt {
  request_id: string
  checked_at: string
  status: 'ok' | 'partial' | 'read_failed'
  error: string | null
  no_publish: true
  plans_checked: number
  plans_with_findings: number
  plans: WatchPlanReceipt[]
}

/** 一条待办条目的来源：哪个客户、哪份计划、哪条 finding。 */
export interface WatchItemSource {
  client_id: string
  plan_id: string
  title: string
  finding: WatchFinding
}

/** 单份计划算失败时的记录。 */
export interface WatchPlanFailure {
  client_id: string
  plan_id: string
  title: string
  error: string
}

/** 一轮最多处理多少份计划，避免一次打爆库。 */
const MAX_PLANS = 50

/** 把任意抛出的东西变成一句可读的错误文案。 */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return '未知错误'
}

export async function runPromoPlanWatch(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{
  receipt: WatchReceipt
  sources: WatchItemSource[]
  failures: WatchPlanFailure[]
}> {
  const requestId = randomUUID()
  const checkedAt = now.toISOString()

  const { data, error: queryError } = await supabase
    .from('marketing_plans')
    .select('*')
    .in('status', ['draft', 'approved'])
    .not('plan_data->promo', 'is', null)

  // 读不到计划列表：不抛错，回执带原因，让待办去说。
  if (queryError) {
    return {
      receipt: {
        request_id: requestId,
        checked_at: checkedAt,
        status: 'read_failed',
        error: queryError.message,
        no_publish: true,
        plans_checked: 0,
        plans_with_findings: 0,
        plans: [],
      },
      sources: [],
      failures: [],
    }
  }

  const allPlans = (data ?? []) as MarketingPlan[]
  const plans = allPlans.slice(0, MAX_PLANS)
  const overflow = allPlans.length - plans.length

  const planReceipts: WatchPlanReceipt[] = []
  const sources: WatchItemSource[] = []
  const failures: WatchPlanFailure[] = []
  let status: WatchReceipt['status'] = 'ok'

  // 顺序处理，不并发。
  for (const plan of plans) {
    try {
      const board = await buildPromoBoard(plan, now)
      const findings = detectWatchFindings(board, { title: plan.title })
      for (const finding of findings) {
        sources.push({
          client_id: plan.client_id,
          plan_id: plan.id,
          title: plan.title,
          finding,
        })
      }
      planReceipts.push({
        client_id: plan.client_id,
        plan_id: plan.id,
        plan_status: board.plan_status,
        findings: findings.map(f => f.code),
        error: null,
      })
    } catch (err) {
      const message = messageOf(err)
      planReceipts.push({
        client_id: plan.client_id,
        plan_id: plan.id,
        plan_status: plan.status,
        findings: [],
        error: message,
      })
      failures.push({
        client_id: plan.client_id,
        plan_id: plan.id,
        title: plan.title,
        error: message,
      })
      status = 'partial'
    }
  }

  const plansWithFindings = planReceipts.filter(p => p.findings.length > 0).length

  // 溢出说明：写进 error，并把 status 置 partial。
  const errorParts: string[] = []
  if (overflow > 0) {
    errorParts.push(`还有 ${overflow} 份计划没检查`)
    status = 'partial'
  }
  const overflowNote = errorParts.length > 0 ? errorParts.join('；') : null

  return {
    receipt: {
      request_id: requestId,
      checked_at: checkedAt,
      status,
      error: overflowNote,
      no_publish: true,
      plans_checked: planReceipts.length,
      plans_with_findings: plansWithFindings,
      plans: planReceipts,
    },
    sources,
    failures,
  }
}
