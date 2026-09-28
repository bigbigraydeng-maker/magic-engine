/**
 * 广告支柱的 Inngest 事件名（WP3，spec docs/specs/2026-09-25-ads-impact-wp3-design-v1.md §2.3 / §4.4）。
 * 仓库惯例是点分 `<域>.<对象>.<动词>`。事件只当叫醒铃：payload 只带 client_id，消费者一律回库读当前值。
 */

/** Settings 面板改了 autonomy_mode（或每日 reconcile）→ 同步 worker 把意向翻译进 Kernel 策略表。 */
export const ADS_AUTONOMY_MODE_CHANGED = 'ads.autonomy_mode.changed'

/** 信封放宽（autonomy_mode / daily_budget_cap_cents 变化）→ 3.1b 的 denied 恢复消费；本 WP 只发不收。 */
export const ADS_AUTONOMY_ENVELOPE_RELAXED = 'ads.autonomy_envelope.relaxed'

/**
 * 熔断检查到期（WP3 熔断器运行时调用方）。`google-data-pullback-daily` 在每个
 * 有配置行的客户拉完当天 `ad_daily_insights` 后发一条，每天每客户一条。
 * payload 只带 client_id + date（叫醒铃惯例）；消费者回库读 `autonomy_mode`
 * 与最新花费，不信 payload 里可能过期的值。
 */
export const ADS_CIRCUIT_BREAKER_CHECK_DUE = 'ads.circuit_breaker.check_due'

export interface AdsClientEventData {
  readonly client_id: string
}

/** 幂等事件 id（spec §4.4 / §4.10）：同一个 updated_at 的重复事件 Inngest 24h 内去重。 */
export function adsAutonomySyncEventId(clientId: string, sourceUpdatedAt: string): string {
  return `autonomy_sync:${clientId}:${sourceUpdatedAt}`
}

/** 幂等事件 id：同一客户同一天的重复补跑 Inngest 24h 内去重。 */
export function adsCircuitBreakerCheckEventId(clientId: string, date: string): string {
  return `circuit_breaker_check:${clientId}:${date}`
}
