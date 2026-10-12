/** 存储层契约。生产实现见 store.ts（Supabase），测试用 __tests__/memory-store.ts。 */

import type { NormalisedCallEvent } from './events'
import type { CallLeg, CallStage } from './fold'

export interface TelephonyConnection {
  id: string
  clientId: string
  provider: 'voipline' | 'twilio'
  providerAccountId: string
  /** VoIPLine：令牌的 SHA-256。Twilio 不用（签名用账号令牌，见 secretRef）。 */
  webhookTokenHash: string | null
  /** Twilio：存放账号令牌的服务器环境变量名（令牌本身不进库）。 */
  secretRef: string | null
  /** Twilio 呼入：转到哪个员工号码（E.164）。分机表的键用同一种号码。 */
  forwardTo: string | null
  defaultCountry: 'NZ' | 'AU'
  /** 分机号 → 员工登录邮箱。没登记的分机不假装知道是谁。 */
  extensionMap: Record<string, string>
  active: boolean
}

export type RawStatus = 'pending' | 'processed' | 'failed' | 'ignored'

export interface RawEventRow {
  id: string
  clientId: string
  connectionId: string
  callId: string
  dedupeKey: string
  receivedAt: string
  status: RawStatus
  attempts: number
  event: NormalisedCallEvent
}

export type MatchStatus = 'pending' | 'matched' | 'created' | 'needs_review' | 'unmatched_outbound' | 'not_applicable'
export type CrmStatus = 'pending' | 'written' | 'needs_review' | 'skipped' | 'failed'
export type RecordingStatus = 'none' | 'pending_download' | 'downloaded' | 'failed'
export type StepStatus = 'not_started' | 'pending' | 'done' | 'failed'

export interface Receipt {
  stage: string
  status: string
  at: string
  detail?: string
}

export interface CallRow {
  provider: 'voipline' | 'twilio'
  clientId: string
  connectionId: string
  providerCallId: string
  stage: CallStage
  direction: 'inbound' | 'outbound' | null
  startedAt: string
  counterpartyE164: string | null
  answered: boolean
  talkSeconds: number
  extension: string | null
  staffEmail: string | null
  legs: CallLeg[]
  contactId: string | null
  matchStatus: MatchStatus
  crmStatus: CrmStatus
  crmDetail: string | null
  touchpointId: string | null
  recordingRef: string | null
  recordingRawEventId: string | null
  recordingStatus: RecordingStatus
  transcriptStatus: StepStatus
  summaryStatus: StepStatus
  /** 永远 false，直到转写与摘要都真实成功并经人复核（本 PR 不会置 true）。 */
  learningEligible: boolean
  receipts: Receipt[]
}

export interface TouchpointInput {
  /** 触点来源 = 供应商（voipline / twilio）。 */
  source: string
  clientId: string
  contactId: string
  direction: 'inbound' | 'outbound'
  occurredAt: string
  summary: string
  /** 幂等键：`<account>:<callId>`。 */
  sourceRef: string
  staffEmail: string | null
  outcome: 'spoke' | 'no_answer' | 'missed_inbound'
  reached: boolean
  answered: boolean
  talkSeconds: number
  providerCallId: string
}

export interface TelephonyStore {
  getConnection(id: string): Promise<TelephonyConnection | null>
  /** 先落库再说。dedupeKey 冲突 → inserted=false。 */
  insertRawEvent(row: {
    provider: 'voipline' | 'twilio'
    clientId: string
    connectionId: string
    callId: string
    dedupeKey: string
    receivedAt: string
    rawType: string
    event: NormalisedCallEvent
    payload: unknown
  }): Promise<{ inserted: boolean; id: string | null }>
  /** 被拒绝的请求也留回执（不存载荷）。 */
  insertRejection(row: { connectionId: string | null; clientId: string | null; reason: string; receivedAt: string; payload?: unknown }): Promise<void>
  getRawEvent(id: string): Promise<RawEventRow | null>
  listRawEventsForCall(clientId: string, connectionId: string, callId: string): Promise<RawEventRow[]>
  markRaw(id: string, status: RawStatus, error: string | null): Promise<void>
  listStaleRaw(olderThanIso: string, maxAttempts: number, limit: number): Promise<RawEventRow[]>
  countExhaustedRaw(maxAttempts: number): Promise<number>
  getCall(clientId: string, provider: string, callId: string): Promise<CallRow | null>
  /** CRM 还没写（pending）且开始时间早于给定时刻的通话——补处理用。 */
  listStaleCalls(startedBeforeIso: string, limit: number): Promise<CallRow[]>
  saveCall(row: CallRow): Promise<void>
  findContactIdsByPhone(clientId: string, phoneE164: string): Promise<string[]>
  createContactForInboundCall(input: { source: string; clientId: string; phoneE164: string; name: string | null; seenAt: string; country: 'NZ' | 'AU' }): Promise<string>
  writeCallTouchpoint(input: TouchpointInput): Promise<{ touchpointId: string | null; created: boolean }>
  /** 同一通电话后到的事件改变了结论（转接后才接通等）：更新原触点，不新增。 */
  updateCallTouchpoint(input: TouchpointInput): Promise<void>
  /** 清理过期的拒绝回执（保留期）。返回删除条数。 */
  purgeRejections(olderThanIso: string, payloadOlderThanIso: string): Promise<number>
}
