/**
 * 收口一封「状态不明」的发送（设计稿 §9）：10 分钟后重新对账，结案就**追加**一行 sent / failed 回执。
 * 事件只当叫醒铃——这里只用事件里的三个 id，其余全部回库读那条 unknown 回执，伪造的事件改不了回执内容。
 */

import type { ReconcileOutcome } from '@/lib/microsoft/mail-send-new'
import { isUuid } from '@/lib/crm/email-compose/validate'
import type { InsertReceiptResult } from './receipt-store'
import type { SendReceipt, StoredReceipt } from './types'

export interface UnknownSendIds {
  clientId: string
  contactId: string
  requestId: string
}

export type SettleResult = { status: 'skipped' | 'sent' | 'failed' | 'unresolved' }

export interface SettleDeps {
  findUnknown(ids: UnknownSendIds): Promise<StoredReceipt | null>
  reconcile(ids: UnknownSendIds): Promise<ReconcileOutcome>
  insert(receipt: SendReceipt): Promise<InsertReceiptResult>
}

/** 事件里只认 outcome=unknown 的三个 id；格式不对一律当没看见。 */
export function unknownIdsFromEvent(data: unknown): UnknownSendIds | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (d.outcome !== 'unknown') return null
  const { client_id: clientId, contact_id: contactId, request_id: requestId } = d
  if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 64) return null
  if (typeof contactId !== 'string' || !isUuid(contactId)) return null
  if (typeof requestId !== 'string' || !isUuid(requestId)) return null
  return { clientId, contactId, requestId }
}

function followUp(stored: StoredReceipt, outcome: ReconcileOutcome): SendReceipt | null {
  if (outcome.status === 'unresolved') return null
  const { id: _id, authBasis: _authBasis, createdAt: _createdAt, ...base } = stored
  if (outcome.status === 'sent') {
    return {
      ...base,
      outcome: 'sent',
      blockReason: null,
      blockDetail: null,
      conversationId: outcome.conversationId,
      providerMessageId: outcome.messageId,
    }
  }
  return { ...base, outcome: 'failed', blockReason: 'reconcile_failed', blockDetail: null }
}

export async function settleUnknownSend(ids: UnknownSendIds, deps: SettleDeps): Promise<SettleResult> {
  const stored = await deps.findUnknown(ids)
  if (stored === null) return { status: 'skipped' }
  const outcome = await deps.reconcile(ids)
  const receipt = followUp(stored, outcome)
  if (receipt === null) return { status: 'unresolved' }
  const written = await deps.insert(receipt)
  if (!written.ok) throw new Error(`回执没写进去：${written.message}`) // 让 Inngest 重试
  return { status: receipt.outcome === 'sent' ? 'sent' : 'failed' }
}
