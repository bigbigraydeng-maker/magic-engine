/**
 * Which approved rows belong on the conversions page under「需要你动手」.
 *
 * One sale can have two send rows: the original purchase and the later lead
 * stage. Looking at only the first row hides a failed stage behind a confirmed
 * purchase. A quoted lead that is still queued, or that never got a send row,
 * must stay visible so「再试一次」can run. An ordinary queued purchase stays off
 * this list.
 */

import { isPastEventWindow } from '@/lib/conversions/event-window'

const QUALIFIED_PREFIX = 'crm_qualified:'

export type Writeback = {
  id: string
  status: string
  last_error: string | null
  /** 'auth' = 授权失效，系统会在令牌修好后自动补发；其它值走「再试一次」文案。 */
  last_error_code: string | null
  next_attempt_at: string | null
  event_id?: string | null
  /** 允许名单先停住时为 `{ held: true }`。收款撤销后带 `paymentRevoked`。 */
  payload_preview?: { held?: boolean; paymentRevoked?: boolean } | null
}

export type Outcome = {
  id: string
  outcome_kind: 'purchase' | 'balance' | 'lead'
  order_ref: string | null
  amount_minor: number | null
  currency: string | null
  occurred_at: string
  review_status: string
  reject_reason: string | null
  redacted_at: string | null
  source_kind: string
  source_ref?: string | null
  created_at: string
  contact_id: string | null
  customer_first: string | null
  /** Set by the list API only when this deal still owes its lead-stage send. */
  companion_expected?: boolean
  /** Set by the list API only when this approved deal has no primary send row. */
  primary_missing?: boolean
  me_conversion_writebacks?: Writeback[]
}

function writebacks(o: Outcome): Writeback[] {
  return o.me_conversion_writebacks ?? []
}

function isFailedLike(wb: Writeback): boolean {
  return wb.status === 'in_doubt' || wb.status === 'failed'
}

function isHeldWriteback(wb: Writeback): boolean {
  return wb.status === 'queued' && wb.payload_preview?.held === true
}

function companionWriteback(o: Outcome): Writeback | undefined {
  return writebacks(o).find((wb) => (wb.event_id ?? '').endsWith(':conversion-stage'))
}

/** The send row a person should look at. An uncertain row wins, then a failed or held one. */
export function sendState(o: Outcome): Writeback | null {
  const rows = writebacks(o)
  return (
    rows.find((wb) => wb.status === 'in_doubt') ??
    rows.find((wb) => wb.status === 'failed') ??
    rows.find(isHeldWriteback) ??
    rows.find((wb) => wb.status === 'queued') ??
    rows[0] ??
    null
  )
}

export function isRetryableFailure(o: Outcome): boolean {
  return writebacks(o).some(isFailedLike)
}

export function isHeldOutcome(o: Outcome): boolean {
  return writebacks(o).some(isHeldWriteback)
}

export function isHeldDeal(o: Outcome): boolean {
  return isHeldOutcome(o) && (o.outcome_kind === 'purchase' || o.outcome_kind === 'balance')
}

/** Quoted lead: still queued, failed, or never given a send row. Not a held or auth row. */
export function isOpenQualified(o: Outcome): boolean {
  if (o.outcome_kind !== 'lead' || o.redacted_at) return false
  if (!o.source_ref?.startsWith(QUALIFIED_PREFIX)) return false
  if (isPastEventWindow(o.occurred_at, Date.now())) return false
  const rows = writebacks(o)
  if (rows.length === 0) return true
  return rows.some((wb) => openQualifiedWriteback(wb))
}

function openQualifiedWriteback(wb: Writeback): boolean {
  if (isHeldWriteback(wb) || wb.last_error_code === 'auth') return false
  return wb.status === 'queued' || wb.status === 'failed'
}

/** Approved purchase whose primary send row was never written. A queued primary stays off. */
export function primaryNeedsRetry(o: Outcome): boolean {
  if (o.primary_missing !== true || o.redacted_at) return false
  if (o.outcome_kind !== 'purchase' && o.outcome_kind !== 'balance') return false
  if (isPastEventWindow(o.occurred_at, Date.now())) return false
  return !writebacks(o).some((wb) => isPrimaryWriteback(o, wb))
}

function isPrimaryWriteback(o: Outcome, wb: Writeback): boolean {
  if ((wb.event_id ?? '').endsWith(':conversion-stage')) return false
  return wb.event_id == null || wb.event_id === o.id
}

/**
 * The API sets companion_expected only when this deal should have sent the
 * lead-stage step and that step is missing, queued, or failed. Ordinary
 * purchases do not get the flag, so a queued purchase stays off this list.
 */
export function companionNeedsRetry(o: Outcome): boolean {
  if (o.companion_expected !== true || o.outcome_kind === 'lead' || o.redacted_at) return false
  if (writebacks(o).some((wb) => wb.payload_preview?.paymentRevoked === true)) return false
  const companion = companionWriteback(o)
  if (!companion) return true
  if (isHeldWriteback(companion) || companion.last_error_code === 'auth') return false
  return companion.status === 'queued' || companion.status === 'failed' || companion.status === 'in_doubt'
}

export function mergeStuck(
  failed: Outcome[],
  held: Outcome[],
  qualified: Outcome[],
  companions: Outcome[],
  unsent: Outcome[] = [],
): Outcome[] {
  const rows = failed.filter(isRetryableFailure)
  const seen = new Set(rows.map((o) => o.id))
  for (const o of [...held, ...qualified, ...unsent, ...companions]) {
    if (seen.has(o.id)) continue
    if (!isHeldDeal(o) && !isOpenQualified(o) && !companionNeedsRetry(o) && !primaryNeedsRetry(o)) continue
    rows.push(o)
    seen.add(o.id)
  }
  return rows
}

export function showInStuck(o: Outcome): boolean {
  if (o.review_status !== 'approved') return false
  return isRetryableFailure(o) || isHeldDeal(o) || isOpenQualified(o) || companionNeedsRetry(o) || primaryNeedsRetry(o)
}

export function stuckExplanation(o: Outcome): string {
  const wb = sendState(o)
  if (wb?.payload_preview?.paymentRevoked === true) {
    return '收款已撤销。这笔可能已经发给广告平台，撤不回来，不要再发。'
  }
  if (primaryNeedsRetry(o) && !isRetryableFailure(o) && !isHeldDeal(o)) {
    return '这笔已经自动通过，但发送记录当时没写成，所以还没发给广告平台。点「再试一次」会补发这一次。'
  }
  if (companionNeedsRetry(o) && !isRetryableFailure(o) && !isHeldDeal(o)) return companionExplanation(o)
  if (!wb) return '这条已报价还没有发给广告平台。点「再试一次」会补发这一条，不会另记一笔。'
  return writebackExplanation(wb)
}

function companionExplanation(o: Outcome): string {
  const companion = companionWriteback(o)
  if (companion?.status === 'failed') {
    return `同一条线索的下一步上次没发出去：${companion.last_error ?? '未知原因'}。点「再试一次」只补这一步，已经发出去的那笔不会再发。`
  }
  return '这笔成交已经记下，同一条线索的下一步还没发出去。点「再试一次」会补上这一步，已经发出去的那笔不会再发一次。'
}

function writebackExplanation(wb: Writeback): string {
  if (wb.status === 'in_doubt') {
    return '这一笔发出去时断线了，不确定平台收到没有。系统不会自己重发 —— 重发一次就是把同一笔算成两笔，撤不回。'
  }
  if (isHeldWriteback(wb)) {
    return '这笔已经批准，但按这个客户现在允许发送的名单先停住了，没有发出去。名单改好之后点「再试一次」：还在 7 天内、而且名单允许，才会发出去。'
  }
  if (wb.last_error_code === 'auth') {
    return '连接广告平台的授权失效了，这条还没发出去。重新连接授权后，系统每天早上会自动补发（7 天内有效）；连好后也可以现在点「再试一次」。'
  }
  return `上次发送没成功：${wb.last_error ?? '未知原因'}。可以再试一次。`
}
