/**
 * 把一次「点发送」的结果记成回执并发事件（设计稿 §9）。
 * 回执同步写、不依赖 Inngest；写回执或发事件失败都只记日志，**永不抛错**——否则会让已经发出的信看起来像失败。
 * 旧配置（没有版本化设置）的客户，`sendMailNew` 不给 meta，这里什么也不写，行为和以前一样。
 */

import type { SendMailNewResult } from '@/lib/microsoft/mail-send-new'
import { isUuid } from '@/lib/crm/email-compose/validate'
import type { InsertReceiptResult } from './receipt-store'
import type { ReceiptOutcome, SendReceipt } from './types'

const MAX_WARNINGS = 20
const MAX_WARNING_LEN = 60
const MAX_DETAIL_LEN = 300

export interface RecordDeps {
  insert(receipt: SendReceipt): Promise<InsertReceiptResult>
  emit(receipt: SendReceipt): Promise<boolean>
}

export interface RecordArgs {
  clientId: string
  contactId: string
  requestId: unknown
  actorEmail: string
  result: SendMailNewResult
}

const FAILED_REASONS: ReadonlySet<string> = new Set(['graph_failed', 'audit_failed', 'internal_error'])

/** 结果 → 回执里的 outcome 与原因。被规则拦下 = blocked；系统出错 = failed；信可能已发出 = unknown。 */
export function outcomeOf(result: SendMailNewResult): { outcome: ReceiptOutcome; reason: string | null } {
  if (result.ok) return { outcome: 'sent', reason: null }
  if (result.reason === 'send_unknown') return { outcome: 'unknown', reason: result.reason }
  if (FAILED_REASONS.has(result.reason)) return { outcome: 'failed', reason: result.reason }
  return { outcome: 'blocked', reason: result.reason }
}

function cap(text: string | null, max: number): string | null {
  if (text === null) return null
  return text.length > max ? text.slice(0, max) : text
}

/** 没有 meta（旧配置）、重复请求的回放、请求 id 不合法 —— 都不记。 */
export function receiptFromResult(args: RecordArgs): SendReceipt | null {
  const { result } = args
  if (result.meta === undefined) return null
  if (result.ok && result.duplicate === true) return null
  if (typeof args.requestId !== 'string' || !isUuid(args.requestId)) return null
  const { outcome, reason } = outcomeOf(result)
  const meta = result.meta
  return {
    clientId: args.clientId,
    contactId: args.contactId,
    requestId: args.requestId,
    actorEmail: args.actorEmail,
    templateKey: meta.templateKey,
    templateVersion: meta.templateVersion,
    catalogVersion: meta.catalogVersion,
    callBasis: meta.callBasis,
    outcome,
    blockReason: reason,
    blockDetail: cap(meta.blockDetail, MAX_DETAIL_LEN),
    mailbox: meta.mailbox,
    conversationId: result.ok ? result.conversationId : null,
    providerMessageId: result.ok ? result.messageId : null,
    editedAfterRender: meta.editedAfterRender,
    warnings: meta.warnings.slice(0, MAX_WARNINGS).map((w) => w.slice(0, MAX_WARNING_LEN)),
    renderedSha256: meta.renderedSha256,
    finalSha256: meta.finalSha256,
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function recordSendAttempt(deps: RecordDeps, args: RecordArgs): Promise<void> {
  try {
    const receipt = receiptFromResult(args)
    if (receipt === null) return
    const written = await deps.insert(receipt)
    if (!written.ok) {
      // 信已发出的以审计行为准；被拦的尝试回执写失败只剩这条日志（已知缺口，PR 里写明）。
      console.error('[send-record] 回执没写进去:', receipt.requestId, receipt.outcome, written.message)
    } else if (written.duplicate) {
      return // 这个结果之前已经记过、事件也发过
    }
    await deps.emit(receipt)
  } catch (err) {
    console.error('[send-record] 记回执时出错（不影响发送结果）:', errorText(err))
  }
}
