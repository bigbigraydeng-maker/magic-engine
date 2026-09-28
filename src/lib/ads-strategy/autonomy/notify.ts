/**
 * 自治开关变化的叫醒铃。发送失败**不影响**保存（每日 reconcile 会追上），
 * 只 `console.warn('[ads-autonomy-sync] …')`。事件 payload 只带 client_id。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import {
  ADS_AUTONOMY_MODE_CHANGED,
  ADS_AUTONOMY_ENVELOPE_RELAXED,
  adsAutonomySyncEventId,
} from '@/lib/inngest/ads-events'

export interface AutonomyNotifyResult {
  readonly sent: boolean
  readonly events: number
  readonly error?: string
}

export interface AutonomyNotifyOptions {
  /** true = 同时发 ads.autonomy_envelope.relaxed（信封放宽：autonomy_mode / daily_budget_cap_cents 变了） */
  readonly relaxed?: boolean
  /** 测试注入 */
  readonly send?: typeof sendInngestEvent
  /**
   * 🔴 Codex P1 复审（round 11）：追加到事件 id 末尾，绕开 Inngest 按
   * `(client_id, updated_at)` 的 24h 去重。默认的幂等 id 假设"同一个
   * updated_at 只需要成功处理一次"，但如果 sync worker 自己重试耗尽后仍然
   * 失败（不是没发出去，是发出去了但没处理成功），`updated_at` 没变、
   * 默认 id 也没变，之后同样内容的补救调用会被 Inngest 直接吞掉，
   * sync worker 永远没有第二次机会——即使它自己基于
   * `ads_autonomy_sync_receipts` 的幂等判据本可以正确重试。用于"这次是
   * 明确要求重新尝试，不管上次内容是否已经处理过"的补救场景（比如
   * release-circuit-breaker 终检发现卡住后的叫醒）。
   */
  readonly idSuffix?: string
}

/** PATCH 写入口调用：意向变了 → 发叫醒铃。幂等 id = autonomy_sync:<client_id>:<updated_at>。 */
export async function notifyAutonomyModeChanged(
  clientId: string,
  sourceUpdatedAt: string,
  options: AutonomyNotifyOptions = {},
): Promise<AutonomyNotifyResult> {
  const send = options.send ?? sendInngestEvent
  const baseId = adsAutonomySyncEventId(clientId, sourceUpdatedAt)
  const events = [
    {
      id: options.idSuffix ? `${baseId}:${options.idSuffix}` : baseId,
      name: ADS_AUTONOMY_MODE_CHANGED,
      data: { client_id: clientId },
    },
    ...(options.relaxed
      ? [
          {
            id: `autonomy_envelope_relaxed:${clientId}:${sourceUpdatedAt}`,
            name: ADS_AUTONOMY_ENVELOPE_RELAXED,
            data: { client_id: clientId },
          },
        ]
      : []),
  ]

  try {
    for (const event of events) {
      await send(event)
    }
    return { sent: true, events: events.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[ads-autonomy-sync] event send failed (reconcile will catch up):', message)
    return { sent: false, events: events.length, error: message }
  }
}

/** 每日 reconcile（pullback 末尾）调用：读 ad_strategy_configs.updated_at 再发同一个幂等 id，Inngest 24h 内去重。 */
export async function reconcileAutonomyMode(
  sb: SupabaseClient,
  clientId: string,
  options: AutonomyNotifyOptions = {},
): Promise<AutonomyNotifyResult> {
  const { data, error } = await sb
    .from('ad_strategy_configs')
    .select('updated_at')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error || !data) {
    return { sent: false, events: 0, error: error?.message ?? 'no_config' }
  }

  return notifyAutonomyModeChanged(clientId, String(data.updated_at), { ...options, relaxed: false })
}
