// 供应商回调原始事件入库口的共享类型（P1：只接 Resend 的 system 账号）。
// 设计稿：docs/specs/2026-11-01-me-provider-event-intake-p1-design-v0.md

export const RESEND_ACCOUNTS = ['system'] as const
export type ResendAccount = (typeof RESEND_ACCOUNTS)[number]

export function isResendAccount(value: string): value is ResendAccount {
  return (RESEND_ACCOUNTS as readonly string[]).includes(value)
}

/** 入库白名单（Resend 事件类型）。不含 opened / clicked / received / scheduled。 */
export const RESEND_STORED_EVENT_TYPES = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
] as const

export function isStoredResendEventType(value: string): boolean {
  return (RESEND_STORED_EVENT_TYPES as readonly string[]).includes(value)
}

export interface ProviderEventInput {
  provider: 'resend'
  account: ResendAccount
  providerEventId: string
  eventType: string
  providerMessageId: string | null
  /** ISO 8601 或 null */
  occurredAt: string | null
  payload: Record<string, unknown>
}

export type InsertOutcome = 'inserted' | 'duplicate'

export interface ProviderEventStore {
  /** 重复（唯一冲突）返回 'duplicate'；其它错误抛出（只带错误码，不带库错误详情）。 */
  insert(row: ProviderEventInput): Promise<InsertOutcome>
}

export interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

export interface ResendWebhookInput {
  account: string
  bodyText: string
  svixId: string | null
  svixTimestamp: string | null
  svixSignature: string | null
  env: (name: string) => string | undefined
  /** 仅测试用；缺省取当前时间 */
  nowSec?: number
}
