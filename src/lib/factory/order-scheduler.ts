// 自动下单调度器 — 工厂的「开始按钮」。
//
// 存在理由:整条链是 下单 → 做片 → 审片 → 发布。做片/审片/发布都在跑,但**没有任何东西
// 会自动创建工单**。唯一入口 POST /api/factory/signals 设计上由外部推信号,而仓内没有
// 任何调用方 —— 所以工厂修得再好也不会自己动,库里 10 张工单全是 2026-07 人工塞的。
//
// 做法:每天给「开了自动下单」的客户各发一条 new_campaign 信号,然后走既有的 decideSignal
// 闸门。**不重复实现任何护栏** —— 余额下限、日单量/日花费上限、角度溯源与去重、红线,
// 全部沿用 strategist 那套。这里只负责「按时按一下开始」。
//
// 🔴 为什么必须按客户显式开关(auto_order_enabled,默认关):自动下单 = 自动花钱
// (每单封顶 $2、每客户每天最多 3 单)。默认全客户开跑违反「花钱要 PM 显式 go」。
//
// 不走内部 HTTP 自调用(直接 import evaluateSignal):本仓已根治过这个反模式(PR #297)。

import { supabaseAdmin } from '@/lib/supabase'
import { evaluateSignal, nzDay } from './evaluate'

export interface ScheduleOutcome {
  client_id: string
  client_name: string
  result: 'accepted' | 'rejected' | 'expired' | 'deduped' | 'error'
  detail?: string
}

export interface ScheduleSummary {
  enabled_clients: number
  outcomes: ScheduleOutcome[]
}

interface EnabledClient {
  id: string
  name: string
}

/** 开了自动下单的客户。jsonb 里存的是布尔 true,用 ->> 取出来是字符串 'true'。 */
async function listEnabledClients(): Promise<EnabledClient[]> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, factory_config')
    .not('factory_config', 'is', null)
  if (error) throw new Error(`clients query failed: ${error.message}`)

  return (data ?? [])
    .filter((c) => ((c.factory_config ?? {}) as Record<string, unknown>)['auto_order_enabled'] === true)
    .map((c) => ({ id: c.id as string, name: (c.name as string) ?? c.id }))
}

/**
 * 给一个客户下今天的单。
 *
 * dedupe_key 按 NZ 日切天:同一天重复跑(cron 重试、手动触发)撞唯一索引 → 幂等,
 * 不会重复开单。这一层是「同一天只下一单」的硬保证,不依赖调用方自觉。
 */
async function scheduleOne(client: EnabledClient, now: Date): Promise<ScheduleOutcome> {
  const dedupeKey = `auto-order:${client.id}:${nzDay(now)}`

  const { data: signal, error } = await supabaseAdmin
    .from('content_demand_signals')
    .insert({
      client_id: client.id,
      signal_type: 'new_campaign',
      source: 'factory-order-scheduler',
      dedupe_key: dedupeKey,
      evidence: {},
      // 角度不在这里指定:由 strategist 从 master_brief 的 content_pillars / core_proposition
      // 溯源挑选(护栏 2)。调度器塞角度 = 绕过溯源护栏,正是要避免的。
      request: { notes: '每日自动排产(factory-order-scheduler)' },
    })
    .select('id')
    .single()

  if (error) {
    // 23505 = dedupe_key 唯一索引冲突 = 今天已经下过了
    if (error.code === '23505') return { client_id: client.id, client_name: client.name, result: 'deduped' }
    return { client_id: client.id, client_name: client.name, result: 'error', detail: error.message }
  }

  const r = await evaluateSignal(signal.id)
  return {
    client_id: client.id,
    client_name: client.name,
    result: r.outcome as ScheduleOutcome['result'],
    // rejected 时 reject_reason 是唯一能看出「为什么没出片」的线索(余额低/日配额满/角度用完)
    detail: r.reject_reason ?? r.work_order_id ?? undefined,
  }
}

/** cron 入口:遍历开了开关的客户,各下一单。单个客户失败不拖累其他客户。 */
export async function runOrderScheduler(now: Date = new Date()): Promise<ScheduleSummary> {
  const clients = await listEnabledClients()
  const outcomes: ScheduleOutcome[] = []

  for (const c of clients) {
    try {
      outcomes.push(await scheduleOne(c, now))
    } catch (e) {
      outcomes.push({
        client_id: c.id,
        client_name: c.name,
        result: 'error',
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { enabled_clients: clients.length, outcomes }
}
