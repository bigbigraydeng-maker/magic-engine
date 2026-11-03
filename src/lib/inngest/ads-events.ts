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

/** An O1 budget increase was explicitly approved and is ready for execution. */
export const ADS_O1_BUDGET_SCALE_APPROVED = 'ads.o1_budget_scale.approved'

export interface AdsClientEventData {
  readonly client_id: string
}

/** 幂等事件 id（spec §4.4 / §4.10）：同一个 updated_at 的重复事件 Inngest 24h 内去重。 */
export function adsAutonomySyncEventId(clientId: string, sourceUpdatedAt: string): string {
  return `autonomy_sync:${clientId}:${sourceUpdatedAt}`
}

// ─── 开投前「追踪与环境就绪」检查（docs/specs/2026-10-19-ads-tracking-preflight-workflow.md §3）──────────

/**
 * 请求一次开投前追踪检查（人手触发，或开投前 T-24h / T-2h 的定时叫醒）。
 * payload 见 AdsTrackingPreflightRequestedData：不带 client_id = 所有配置了追踪检查的客户。
 * 🔴 只读检查：不发布、不扣费、不外发。
 */
export const ADS_TRACKING_PREFLIGHT_REQUESTED = 'ads.tracking_preflight.requested'

/** 一个客户查完的机器可读回执（事件 id = 回执 request_id，同一份回执重试时不会重复发出）。 */
export const ADS_TRACKING_PREFLIGHT_CHECKED = 'ads.tracking_preflight.checked'

/** 开投后读回（T+1h / T+24h）。开投时刻只有点开投的那一刻才知道，所以由开投动作或人手发出。 */
export const ADS_TRACKING_POSTLAUNCH_REQUESTED = 'ads.tracking_postlaunch.requested'

export interface AdsTrackingPreflightRequestedData {
  readonly client_id?: string
  /** 谁叫醒的 / 为什么，例如 'T-24h'、'manual'；只进日志，不影响检查内容 */
  readonly reason?: string
}

export interface AdsTrackingPostLaunchRequestedData {
  readonly client_id: string
  readonly phase: 't1h' | 't24h'
  /** 开投时刻（ISO） */
  readonly launched_at: string
}
