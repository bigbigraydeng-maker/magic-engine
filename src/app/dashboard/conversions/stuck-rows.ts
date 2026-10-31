/**
 * Which approved rows belong on the conversions page under「需要你动手」.
 *
 * One sale can have two send rows: the original purchase and the later lead
 * stage. Looking at only the first row hides a failed stage behind a confirmed
 * purchase. A quoted lead that is still queued, or that never got a send row,
 * must stay visible so「再试一次」can run. An ordinary queued purchase stays off
 * this list.
 */

import { stageKeyFromQualifiedRef } from '@/lib/conversions/conversion-lead'
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
  /** Deal-stage name for a companion send, when the list already knows it. */
  stage_name?: string | null
  /** 允许名单先停住时为 `{ held: true }`。没有这个标记的排队行不是「需要你动手」。 */
  payload_preview?: { held?: boolean; 事件类型?: unknown } | null
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

/**
 * The API sets companion_expected only when this deal should have sent the
 * lead-stage step and that step is missing, queued, or failed. Ordinary
 * purchases do not get the flag, so a queued purchase stays off this list.
 */
export function companionNeedsRetry(o: Outcome): boolean {
  if (o.companion_expected !== true || o.outcome_kind === 'lead' || o.redacted_at) return false
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
): Outcome[] {
  const rows = failed.filter(isRetryableFailure)
  const seen = new Set(rows.map((o) => o.id))
  for (const o of [...held, ...qualified, ...companions]) {
    if (seen.has(o.id)) continue
    if (!isHeldDeal(o) && !isOpenQualified(o) && !companionNeedsRetry(o)) continue
    rows.push(o)
    seen.add(o.id)
  }
  return rows
}

export function showInStuck(o: Outcome): boolean {
  if (o.review_status !== 'approved') return false
  return isRetryableFailure(o) || isHeldDeal(o) || isOpenQualified(o) || companionNeedsRetry(o)
}

export function stuckExplanation(o: Outcome): string {
  if (companionNeedsRetry(o) && !isRetryableFailure(o) && !isHeldDeal(o)) return companionExplanation(o)
  const wb = sendState(o)
  if (!wb) return '这条已报价还没有发给广告平台。点「再试一次」会补发这一条，不会另记一笔。'
  return writebackExplanation(o, wb)
}

const PLATFORM_EVENT_NAMES = new Set(['Purchase', 'BalancePaid', 'Lead'])

export type DoubtCheck = {
  which: 'stage' | 'deal'
  stageName: string | null
  eventId: string | null
}

/** Which send the person must match on the platform before marking it received. */
export function doubtCheck(o: Outcome): DoubtCheck | null {
  const wb = sendState(o)
  if (!wb || wb.status !== 'in_doubt') return null
  const qualifiedStage = stageKeyFromQualifiedRef(o.source_ref ?? null)
  const stageEvent = (wb.event_id ?? '').endsWith(':conversion-stage') || Boolean(qualifiedStage)
  return {
    which: stageEvent ? 'stage' : 'deal',
    stageName: stageEvent ? stageNameFor(wb, qualifiedStage) : null,
    eventId: cleanText(wb.event_id),
  }
}

export function doubtExplanation(o: Outcome): string {
  const check = doubtCheck(o)
  const tail = '发出去时断线了，不确定平台收到没有。系统不会自己重发 —— 重发一次就是把同一条算成两条，撤不回。'
  if (!check) return `这一笔${tail}`
  const which = check.which === 'stage'
    ? '要核对的是后面那个阶段事件，不是原来的这笔成交。'
    : '要核对的是原来的这笔成交，不是后面的阶段事件。'
  const stage = check.stageName ? `阶段是「${check.stageName}」。` : ''
  const id = check.eventId ? `到广告平台按发送编号「${check.eventId}」对一下。` : ''
  return `${which}${stage}${id}${tail}`
}

export function doubtConfirm(o: Outcome, resolution: 'confirmed' | 'resend'): string {
  const check = doubtCheck(o)
  const which = check?.which === 'stage' ? '后面那个阶段事件' : '原来的这笔成交'
  const head = resolution === 'confirmed'
    ? `你在广告平台后台确认看到的是${which}吗？`
    : `确认平台没有收到${which}，要重新发一次吗？`
  const facts = [
    check?.stageName ? `阶段：${check.stageName}` : '',
    check?.eventId ? `发送编号：${check.eventId}` : '',
  ].filter((line) => line !== '').join('\n')
  const tail = resolution === 'confirmed'
    ? confirmedTail(check?.which === 'stage')
    : '如果其实已经收到了，这一下会让同一条算成两条，而且撤不回。请先在平台后台对一下发送编号，确认真的没有再点。'
  return facts ? `${head}\n\n${facts}\n\n${tail}` : `${head}\n\n${tail}`
}

function confirmedTail(stage: boolean): string {
  if (stage) {
    return '看到的是这一条才点确定。原来的成交已经记下了，不要把它当成这一条。记成「已收到」之后，这一条就不会再发。'
  }
  return '看到的是这一笔才点确定 —— 记成「已收到」之后就不会再发了。'
}

function stageNameFor(wb: Writeback, fromRef: string | null): string | null {
  return cleanText(wb.stage_name) ?? previewStageName(wb.payload_preview) ?? fromRef
}

function previewStageName(preview: Writeback['payload_preview']): string | null {
  if (!preview) return null
  const named = preview.事件类型
  if (typeof named !== 'string') return null
  const trimmed = named.trim()
  if (trimmed === '' || PLATFORM_EVENT_NAMES.has(trimmed)) return null
  return trimmed
}

function cleanText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function companionExplanation(o: Outcome): string {
  const companion = companionWriteback(o)
  if (companion?.status === 'failed') {
    return `同一条线索的下一步上次没发出去：${companion.last_error ?? '未知原因'}。点「再试一次」只补这一步，已经发出去的那笔不会再发。`
  }
  return '这笔成交已经记下，同一条线索的下一步还没发出去。点「再试一次」会补上这一步，已经发出去的那笔不会再发一次。'
}

function writebackExplanation(o: Outcome, wb: Writeback): string {
  if (wb.status === 'in_doubt') return doubtExplanation(o)
  if (isHeldWriteback(wb)) {
    return '这笔已经批准，但按这个客户现在允许发送的名单先停住了，没有发出去。名单改好之后点「再试一次」：还在 7 天内、而且名单允许，才会发出去。'
  }
  if (wb.last_error_code === 'auth') {
    return '连接广告平台的授权失效了，这条还没发出去。重新连接授权后，系统每天早上会自动补发（7 天内有效）；连好后也可以现在点「再试一次」。'
  }
  return `上次发送没成功：${wb.last_error ?? '未知原因'}。可以再试一次。`
}
