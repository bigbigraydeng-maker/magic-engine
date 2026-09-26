/**
 * 「熔断器把自治档位降回只观察」→ 下发到「需要你动手」。
 *
 * 熔断器触发后会把 `ad_strategy_configs.autonomy_mode` 压成 `observe`，并把
 * `autonomy_mode_updated_by` 写成固定标签 `system:ads-circuit-breaker`。这条通道
 * 只给**当前仍然被熔断压着**的客户出待办 —— 判据是「现在还处在熔断状态吗」，
 * 不是时间窗口。熔断可能已经压了三天，用时间窗口会让第二天起这条待办凭空消失，
 * 而问题还在。
 *
 * PM 一旦把开关拨回自动，两条判据就不再成立，待办自动消失 —— 不需要任何
 * 「已处理」标记。
 *
 * 只有 `outcome === 'switched_to_observe'` 才出待办。`frozen_for_day`（当日数据
 * 不全导致的当日冻结）次日数据补全会自动恢复，不需要人点任何东西，塞进待办就是
 * 纯噪音；`no_trigger` / `unknown_data_partial` 同样不出。
 *
 * 本文件一行写操作都没有：只读配置与事件、生成待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

export type AdsCircuitItemKind = 'ads_autonomy_circuit_tripped'

/** 熔断器写进 autonomy_mode_updated_by 的固定标签（跟 circuit-breaker-apply.ts 里的常量同值）。 */
export const CIRCUIT_BREAKER_ACTOR_LABEL = 'system:ads-circuit-breaker'

/** 触发原因 code → 中文短语（跟熔断器里的一致）。 */
const TRIGGER_CODE_LABELS: Record<string, string> = {
  spend_spike: '今天花钱突然暴涨',
  account_over_daily_cap: '账户改动超过了你设的日预算上限',
  kernel_rollback_failed: '有动作撤回失败',
  jev_low_scores: '连续几次质检分数过低',
  data_incomplete: '数据没采全',
}

interface ConfigRow {
  client_id: string
  updated_at: string
}

interface EventRow {
  trigger_code: string
  occurred_on: string
  evidence: unknown
}

export function adsHealthHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

/** 映射表里没有的 code 原样用那个 code 字符串，不要静默丢掉。 */
function labelOf(triggerCode: string): string {
  return TRIGGER_CODE_LABELS[triggerCode] ?? triggerCode
}

/** 把同一天的全部 trigger_code 收成一组中文短语，逗号分隔。 */
function reasonsOf(events: EventRow[]): string {
  const latestDay = events[0].occurred_on
  const codes = events
    .filter((event) => event.occurred_on === latestDay)
    .map((event) => labelOf(event.trigger_code))
  return Array.from(new Set(codes)).join('、')
}

/** 查某个客户最近一条「切回只观察」的熔断事件，拿触发原因。 */
async function fetchRecentEvents(
  supabase: SupabaseClient,
  clientId: string,
): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('ads_circuit_events')
    .select('trigger_code, occurred_on, evidence')
    .eq('client_id', clientId)
    .eq('outcome', 'switched_to_observe')
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) throw new Error(`ads_circuit_events 读取失败：${error.message}`)
  return (data ?? []) as EventRow[]
}

/**
 * 拼 what 那句。查不到事件时仍然出待办 —— 档位确实被熔断器压着，这是已发生的
 * 事实；因为账本缺了一行就不告诉 PM，等于「查不到 = 没发生」。
 */
function whatOf(events: EventRow[]): string {
  const head = '这个客户的广告自治被自动降回「只观察」了'
  const tail =
    '现在系统不会再自动调预算、也不会自动暂停亏钱的广告 —— ' +
    '要么你自己动手，要么把开关拨回自动。'
  if (events.length === 0) {
    return `${head}，但原因没查到（熔断事件没落账）。${tail}`
  }
  const day = events[0].occurred_on
  return `${head}（${day}，原因：${reasonsOf(events)}）。${tail}`
}

export async function pushAdsCircuitItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { data, error } = await supabase
    .from('ad_strategy_configs')
    .select('client_id, updated_at')
    .eq('autonomy_mode', 'observe')
    .eq('autonomy_mode_updated_by', CIRCUIT_BREAKER_ACTOR_LABEL)
  if (error) throw new Error(`ad_strategy_configs 读取失败：${error.message}`)

  const configs = (data ?? []) as ConfigRow[]
  if (configs.length === 0) return

  for (const config of configs) {
    const events = await fetchRecentEvents(supabase, config.client_id)
    items.push({
      kind: 'ads_autonomy_circuit_tripped',
      client_id: config.client_id,
      client_name: nameOf(config.client_id),
      what: whatOf(events),
      how:
        '先在看板上看一眼花费和数据是不是已经恢复正常；' +
        '确认没问题再把「自治开关」拨回自动。没恢复就先别拨回去。',
      href: adsHealthHref(config.client_id),
    })
  }
}
