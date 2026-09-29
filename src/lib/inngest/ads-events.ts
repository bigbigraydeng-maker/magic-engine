/**
 * 广告支柱的 Inngest 事件名（WP3，spec docs/specs/2026-09-25-ads-impact-wp3-design-v1.md §2.3 / §4.4）。
 * 仓库惯例是点分 `<域>.<对象>.<动词>`。事件只当叫醒铃：payload 只带 client_id，消费者一律回库读当前值。
 */

/** Settings 面板改了 autonomy_mode（或每日 reconcile）→ 同步 worker 把意向翻译进 Kernel 策略表。 */
export const ADS_AUTONOMY_MODE_CHANGED = 'ads.autonomy_mode.changed'

/** 信封放宽（autonomy_mode / daily_budget_cap_cents 变化）→ 3.1b 的 denied 恢复消费；本 WP 只发不收。 */
export const ADS_AUTONOMY_ENVELOPE_RELAXED = 'ads.autonomy_envelope.relaxed'

/** A human-submitted campaign-level budget decrease is ready for durable execution. */
export const ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED = 'ads.campaign_budget.decrease_requested'

export interface AdsClientEventData {
  readonly client_id: string
}

/** 幂等事件 id（spec §4.4 / §4.10）：同一个 updated_at 的重复事件 Inngest 24h 内去重。 */
export function adsAutonomySyncEventId(clientId: string, sourceUpdatedAt: string): string {
  return `autonomy_sync:${clientId}:${sourceUpdatedAt}`
}
