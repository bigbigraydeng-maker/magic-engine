/**
 * 「广告熔断了、可能需要你动手解除」→ 下发到「需要你动手」。
 *
 * spec v2.5 §6.2 派生态熔断（`readCircuitState` / `listActiveCircuitTrips`）
 * 落地之后接手这条通道；替换的是旧设计（v2.1 §3 G11、上一轮已作废）里靠
 * `ad_strategy_configs.autonomy_mode='observe'` 判断的那份同名文件。
 *
 * 判据是**现在还处在熔断中吗**，不是时间窗口——熔断可能已经压了三天，
 * 用时间窗口会让第二天起这条待办凭空消失，而问题还在。非 sticky 的熔断
 * 24 小时后自然解除、待办自动消失，不需要任何「已处理」标记；sticky 的
 * 只能靠后台解除接口解，PM 拨了就消失。
 *
 * 🔴 **本文件只覆盖 `circuit:` 前缀**（真熔断，需要人看/解除）。
 *    `facts:` 前缀（信封事实读取本身失败）和 `manual_only:`（设计上就是人工
 *    专属的动作，如挪预算）是 Kernel 授权层/执行层的拒绝原因，走的是
 *    `pushKernelItems` 那条既有通道（denied / dead_letter 的展示），
 *    不在这里重复处理——两边都读同样的原因字符串会让同一件事在待办里
 *    出现两次，也会让"改一处漏改另一处"这种分家风险平白多一处。
 *
 * 本文件一行写操作都没有：只读事件、生成待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { listActiveCircuitTrips, type ActiveCircuitTrip } from '@/lib/ads-strategy/circuit-state'
import { APP_BASE } from './binding-request-items'

export type AdsCircuitItemKind = 'ads_circuit_tripped'

/** `reason` 去掉 `circuit:` 前缀之后的 code → 中文短语。 */
const CIRCUIT_CODE_LABELS: Record<string, string> = {
  absolute_spend_cap: '今天这个账户花的钱超过了设定的绝对上限',
  spend_spike: '今天这个账户花的钱比平时暴涨了 3 倍以上',
  client_daily_cap_exceeded: '这个客户全部账户加起来今天花的钱超过了日预算上限',
}

const ROLLBACK_FAILED_PREFIX = 'rollback_failed:'

/**
 * `reason` 原文形如 `circuit:spend_spike` 或 `circuit:rollback_failed:<run_id>`。
 * 映射表里没有的 code **原样用那个 code 字符串**，不静默丢掉——查不到中文短语
 * 不该变成"这条待办干脆不说原因"。
 */
function labelOf(reason: string): string {
  const code = reason.startsWith('circuit:') ? reason.slice('circuit:'.length) : reason
  if (code.startsWith(ROLLBACK_FAILED_PREFIX)) {
    const runId = code.slice(ROLLBACK_FAILED_PREFIX.length)
    return `有一个广告动作撤回失败了（动作编号 ${runId}），这条广告可能还停在改动之后、没改完整的状态`
  }
  return CIRCUIT_CODE_LABELS[code] ?? code
}

function adsHealthHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

function whatOf(trip: ActiveCircuitTrip): string {
  const head = `账户 ${trip.adAccountId} 的广告自治被自动冻住了`
  const reason = labelOf(trip.reason)
  const countNote = trip.openTripCount > 1 ? `（另外还有 ${trip.openTripCount - 1} 条没解除的原因）` : ''
  const tail = trip.sticky
    ? '这一种系统不会自己解除，必须你确认之后手动解除。'
    : '这一种 24 小时后系统会自己解除，不需要你做任何事。'
  return `${head}：${reason}${countNote}。现在这个账户不会再自动调预算、也不会自动暂停亏钱的广告。${tail}`
}

function howOf(trip: ActiveCircuitTrip): string {
  if (!trip.sticky) {
    return (
      '先看一眼这个账户最近的花费和数据是不是已经恢复正常——' +
      '不用你做任何事，24 小时后系统会自己解除；如果你已经确认没问题、不想等，' +
      '可以让开发帮你现在就解除。'
    )
  }
  return (
    '先看一眼这个账户最近的花费和数据、以及那条撤回失败的广告改成了什么样，' +
    '确认问题已经解决。确认没问题后告诉开发帮你调用后台的"解除熔断"接口——' +
    '这一种系统不会自己解除，没恢复就先别解除。'
  )
}

export async function pushAdsCircuitItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const trips = await listActiveCircuitTrips(supabase)
  for (const trip of trips) {
    items.push({
      kind: 'ads_circuit_tripped',
      client_id: trip.clientId,
      client_name: nameOf(trip.clientId),
      what: whatOf(trip),
      how: howOf(trip),
      href: adsHealthHref(trip.clientId),
    })
  }
}
