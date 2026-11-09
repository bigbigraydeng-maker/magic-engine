/**
 * CRM「发邮件」的 Inngest 事件（设计稿 docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §9）。
 * 仓库惯例是点分 `<域>.<对象>.<动词>`。事件只当叫醒铃：回执才是记录，事件丢了不影响已发出的信。
 * payload 里没有客人的邮箱地址、没有正文。
 */

import { sendInngestEvent, type InngestOutboundEvent } from '@/lib/workflows/inngest-event'
import type { CallBasis, ReceiptOutcome, SendReceipt } from '@/lib/crm/email-templates/types'

/** 一次「点发送」有了结果（发出 / 被拦 / 失败 / 状态不明）。 */
export const CRM_EMAIL_SEND_ATTEMPTED = 'crm.email_send.attempted'

const EMIT_TIMEOUT_MS = 2000
const MAX_ATTEMPTS = 2

export type CrmEmailSendAttemptedData = {
  request_id: string
  client_id: string
  contact_id: string
  actor_email: string
  template_key: string | null
  template_version: number | null
  catalog_version: number | null
  call_basis: CallBasis
  outcome: ReceiptOutcome
  block_reason: string | null
  mailbox: string | null
  conversation_id: string | null
  provider_message_id: string | null
  edited_after_render: boolean | null
  warnings: string[]
  rendered_sha256: string | null
  final_sha256: string | null
  /** 销售点了「发送」就是授权；没有人点击就没有这个事件。 */
  auth_basis: 'human_click'
  created_at: string
}

/** 幂等事件 id：同一次尝试的同一个结果重复发出，Inngest 24h 内去重。 */
export function crmEmailSendEventId(
  receipt: Pick<SendReceipt, 'clientId' | 'contactId' | 'requestId' | 'outcome' | 'blockReason'>,
): string {
  const reason = receipt.blockReason === null || receipt.blockReason === '' ? '-' : receipt.blockReason
  return `crm_email_send:${receipt.clientId}:${receipt.contactId}:${receipt.requestId}:${receipt.outcome}:${reason}`
}

export function buildSendAttemptedEvent(
  receipt: SendReceipt,
  createdAt: string,
): InngestOutboundEvent<CrmEmailSendAttemptedData> {
  return {
    id: crmEmailSendEventId(receipt),
    name: CRM_EMAIL_SEND_ATTEMPTED,
    data: {
      request_id: receipt.requestId,
      client_id: receipt.clientId,
      contact_id: receipt.contactId,
      actor_email: receipt.actorEmail,
      template_key: receipt.templateKey,
      template_version: receipt.templateVersion,
      catalog_version: receipt.catalogVersion,
      call_basis: receipt.callBasis,
      outcome: receipt.outcome,
      block_reason: receipt.blockReason,
      mailbox: receipt.mailbox,
      conversation_id: receipt.conversationId,
      provider_message_id: receipt.providerMessageId,
      edited_after_render: receipt.editedAfterRender,
      warnings: receipt.warnings,
      rendered_sha256: receipt.renderedSha256,
      final_sha256: receipt.finalSha256,
      auth_basis: 'human_click',
      created_at: createdAt,
    },
  }
}

const timeoutFetcher: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(EMIT_TIMEOUT_MS) })

export interface EmitDeps {
  send?: typeof sendInngestEvent
  now?: () => Date
}

/**
 * 发事件：2 秒超时、最多试 2 次，之后只记日志。**永不抛错**——信已经发出，事件丢失不能影响返回。
 * 返回 true = 事件已被 Inngest 收下。
 */
export async function emitSendAttempted(receipt: SendReceipt, deps: EmitDeps = {}): Promise<boolean> {
  const send = deps.send ?? sendInngestEvent
  const event = buildSendAttemptedEvent(receipt, (deps.now ?? (() => new Date()))().toISOString())
  let lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await send(event, { fetcher: timeoutFetcher })
      return true
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (lastError.startsWith('INNGEST_EVENT_KEY_MISSING')) break // retrying cannot help
    }
  }
  console.error('[crm-email-events] 事件没发出去（发送结果以回执为准）:', event.id, lastError)
  return false
}
