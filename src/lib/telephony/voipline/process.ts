/**
 * 处理一条已经落库的原始事件：重折整通电话 → 存通话 → 通话结束后写一次 CRM。
 *
 * 全程幂等：同一条事件处理多少遍结果都一样（见 fold.ts 的说明；触点靠
 * `(client_id, source, source_ref)` 唯一键只写一次）。
 *
 * 录音只记「有一条录音、状态待下载」。下载、转写、摘要本 PR 没有实现——状态列
 * 留在 not_started，不会假装做过；`learning_eligible` 在这里永远是 false。
 */

import { describeCall, planCallIngest, type PlannedCall } from '../call-plan'
import { foldCall, toCallRecord, type FoldedCall } from './fold'
import type { CallRow, CrmStatus, MatchStatus, Receipt, TelephonyConnection, TelephonyStore, TouchpointInput } from './types'

const MAX_RECEIPTS = 50

/**
 * 通话「结束」之后再静默这么久才写 CRM：转接时前台那一段的 completion 常常先到，
 * 立刻写会把整通电话永久记成「未接」。静默期内有新事件到达就继续等。
 */
export const CRM_QUIET_MS = 120_000

/** 错误文字落库前把长数字串（可能是客人号码）打码。 */
export function safeErr(err: unknown): string {
  const m = err instanceof Error ? err.message : 'unknown'
  return m.replace(/\+?\d[\d\s-]{5,}\d/g, '[num]').slice(0, 300)
}

export interface ProcessOutcome {
  callId: string
  stage: string
  crmStatus: CrmStatus
  matchStatus: MatchStatus
  recordingStatus: string
  /** true = 通话刚结束、还在静默期，CRM 还没写；稍后再处理一次。 */
  deferred?: boolean
}

function receipt(stage: string, status: string, now: string, detail?: string): Receipt {
  return { stage, status, at: now, ...(detail ? { detail } : {}) }
}

function baseRow(conn: TelephonyConnection, folded: FoldedCall, prev: CallRow | null): CallRow {
  return {
    provider: conn.provider,
    clientId: conn.clientId,
    connectionId: conn.id,
    providerCallId: folded.callId,
    stage: folded.stage,
    direction: folded.direction,
    startedAt: folded.startedAt,
    counterpartyE164: prev?.counterpartyE164 ?? null,
    answered: folded.answered,
    talkSeconds: folded.talkSeconds,
    extension: folded.extension,
    // 没人接的电话不记员工：不能把「谁跟的」填给一个没接起来的人。
    staffEmail: folded.answered ? staffFor(conn, folded.extension) : null,
    legs: folded.legs,
    // 下面这些是 CRM / 录音链路的状态，重折时必须沿用，不能被「重算」冲掉。
    contactId: prev?.contactId ?? null,
    matchStatus: prev?.matchStatus ?? 'pending',
    crmStatus: prev?.crmStatus ?? 'pending',
    crmDetail: prev?.crmDetail ?? null,
    touchpointId: prev?.touchpointId ?? null,
    recordingRef: folded.recording?.ref ?? prev?.recordingRef ?? null,
    recordingRawEventId: folded.recording?.rawEventId ?? prev?.recordingRawEventId ?? null,
    recordingStatus: prev?.recordingStatus ?? 'none',
    transcriptStatus: prev?.transcriptStatus ?? 'not_started',
    summaryStatus: prev?.summaryStatus ?? 'not_started',
    learningEligible: false,
    receipts: prev?.receipts ?? [],
  }
}

/** 只认登记过的分机（自有属性 + 字符串值），`constructor` 之类的怪分机名不会取到原型链上的东西。 */
function staffFor(conn: TelephonyConnection, ext: string | null): string | null {
  if (!ext || !Object.prototype.hasOwnProperty.call(conn.extensionMap, ext)) return null
  const v = conn.extensionMap[ext]
  return typeof v === 'string' && v ? v : null
}

function pushReceipt(row: CallRow, r: Receipt) {
  row.receipts = [...row.receipts, r].slice(-MAX_RECEIPTS)
}


/** 这通电话写进触点的内容。写入和「后到事件改了结论后的更新」共用，保证两处口径一致。 */
function touchpointInput(
  conn: TelephonyConnection,
  folded: FoldedCall,
  planned: PlannedCall,
  contactId: string,
  staffEmail: string | null,
): TouchpointInput {
  return {
    clientId: conn.clientId,
    source: conn.provider,
    contactId,
    direction: planned.direction,
    occurredAt: planned.occurredAt,
    summary: describeCall(planned),
    sourceRef: `${conn.providerAccountId}:${folded.callId}`,
    staffEmail,
    // 有效联系 = call-plan 判断⑤；其余（含未接、秒挂）不冒充聊过。
    // 来电没人接 = 我们漏接了客人（missed_inbound），不是「我们打过没接通」（no_answer），
    // 否则下游会把漏接的人当成已经被我们尝试联系过。
    outcome:
      planned.countsAsReached || (planned.direction === 'inbound' && planned.answered && planned.talkSeconds >= 10)
        ? 'spoke'
        : planned.direction === 'inbound'
          ? 'missed_inbound'
          : 'no_answer',
    reached: planned.countsAsReached,
    answered: planned.answered,
    talkSeconds: planned.talkSeconds,
    providerCallId: folded.callId,
  }
}

/** 通话结束事件迟迟没来、被扫描任务转人工确认时写的说明（结束事件后来到了就重新处理）。 */
export const ANSWERED_UNKNOWN_DETAIL = '没收到接通事件但有通话时长，不确定是否接通'
export const NO_END_EVENT_DETAIL = '超过 6 小时没收到结束事件，需人工确认这通电话'

/** 通话结束且 CRM 还没写成时，做号码匹配 + 写触点。失败抛出，由调用方记失败状态。 */
async function writeCrm(
  store: TelephonyStore,
  conn: TelephonyConnection,
  folded: FoldedCall,
  row: CallRow,
  now: string,
): Promise<void> {
  const record = toCallRecord(folded)
  if (!record) {
    row.crmStatus = 'needs_review'
    row.matchStatus = 'needs_review'
    row.crmDetail = '事件里没有方向（呼入/呼出），不猜，等人确认'
    pushReceipt(row, receipt('crm', 'needs_review', now, 'no_direction'))
    return
  }

  if (folded.answeredUnknown) {
    // 缺接通事件却有通话时长：既不能记成「没接」也不能记成「聊过」，交给人确认。
    row.crmStatus = 'needs_review'
    row.matchStatus = 'needs_review'
    row.crmDetail = ANSWERED_UNKNOWN_DETAIL
    pushReceipt(row, receipt('crm', 'needs_review', now, 'answered_unknown'))
    return
  }

  const plan = planCallIngest([record], { defaultCountry: conn.defaultCountry })
  const planned: PlannedCall | undefined = plan.calls[0]
  if (!planned) {
    row.crmStatus = 'skipped'
    row.matchStatus = 'not_applicable'
    row.crmDetail = plan.dropped[0]?.why ?? '被判断层丢弃'
    pushReceipt(row, receipt('crm', 'skipped', now, row.crmDetail))
    return
  }
  row.counterpartyE164 = planned.phone

  const ids = await store.findContactIdsByPhone(conn.clientId, planned.phone)
  let contactId: string
  if (ids.length > 1) {
    // 同一个号码挂在不止一个人身上：不挑，等人确认，绝不乱挂。
    row.matchStatus = 'needs_review'
    row.crmStatus = 'needs_review'
    row.crmDetail = `号码对应 ${ids.length} 个联系人`
    pushReceipt(row, receipt('crm', 'needs_review', now, 'ambiguous_phone'))
    return
  }
  if (ids.length === 1) {
    contactId = ids[0]
    row.matchStatus = 'matched'
  } else if (planned.customerInitiated) {
    contactId = await store.createContactForInboundCall({
      source: conn.provider,
      clientId: conn.clientId,
      phoneE164: planned.phone,
      name: planned.name,
      seenAt: planned.occurredAt,
      country: conn.defaultCountry,
    })
    row.matchStatus = 'created'
  } else {
    // 纯外呼、库里没这个人：不建人（call-plan 判断④），通话本身仍留在通话表里。
    row.matchStatus = 'unmatched_outbound'
    row.crmStatus = 'skipped'
    row.crmDetail = '外呼的号码不在联系人里，不新建'
    pushReceipt(row, receipt('crm', 'skipped', now, 'unmatched_outbound'))
    return
  }

  const tpInput = touchpointInput(conn, folded, planned, contactId, row.staffEmail)
  const tp = await store.writeCallTouchpoint(tpInput)
  row.contactId = contactId
  row.touchpointId = tp.touchpointId ?? row.touchpointId
  row.crmStatus = 'written'
  row.crmDetail = null
  pushReceipt(row, receipt('crm', tp.created ? 'written' : 'already_written', now))
}

export async function processRawEvent(
  store: TelephonyStore,
  rawEventId: string,
  now: () => Date = () => new Date(),
  opts: { quietMs?: number } = {},
): Promise<ProcessOutcome | null> {
  const quietMs = opts.quietMs ?? CRM_QUIET_MS
  const raw = await store.getRawEvent(rawEventId)
  if (!raw) return null
  const conn = await store.getConnection(raw.connectionId)
  const stamp = now().toISOString()

  // 连接被停用 / 删除：不处理，原因留在原始事件上，不静默。
  if (!conn || !conn.active || conn.clientId !== raw.clientId) {
    await store.markRaw(raw.id, 'failed', 'connection_inactive_or_mismatched')
    return null
  }

  try {
    const events = await store.listRawEventsForCall(conn.clientId, conn.id, raw.callId)
    const folded = foldCall(events.map((e) => ({ rawEventId: e.id, receivedAt: e.receivedAt, event: e.event })))
    if (!folded) {
      await store.markRaw(raw.id, 'ignored', 'no_events')
      return null
    }

    const prev = await store.getCall(conn.clientId, conn.provider, raw.callId)
    const row = baseRow(conn, folded, prev)

    if (raw.event.eventType === 'other') {
      // 队列摘要 / 语音信箱等：留档，不进 CRM。
      await store.markRaw(raw.id, 'ignored', `unhandled_event:${raw.event.rawType}`)
      if (!prev) return null
    }

    if (folded.recording && row.recordingStatus === 'none') {
      row.recordingStatus = 'pending_download'
      pushReceipt(row, receipt('recording', 'pending_download', stamp))
    }

    const lastReceived = Math.max(...events.map((e) => Date.parse(e.receivedAt)))
    const recoverableReview = row.crmStatus === 'needs_review' && (row.crmDetail === NO_END_EVENT_DETAIL || row.crmDetail === ANSWERED_UNKNOWN_DETAIL)
    const inQuietWindow = folded.stage === 'ended' && now().getTime() - lastReceived < quietMs
    if (folded.stage === 'ended' && !inQuietWindow && (row.crmStatus === 'pending' || row.crmStatus === 'failed' || (row.crmStatus === 'needs_review' && (row.crmDetail === NO_END_EVENT_DETAIL || row.crmDetail === ANSWERED_UNKNOWN_DETAIL)))) {
      try {
        await writeCrm(store, conn, folded, row, stamp)
      } catch (err) {
        row.crmStatus = 'failed'
        row.crmDetail = safeErr(err)
        pushReceipt(row, receipt('crm', 'failed', stamp, row.crmDetail))
        await store.saveCall(row)
        throw new Error(safeErr(err))
      }
    }

    // 已写过触点、但后到的事件改变了结论（例如转接：前台那段先结束，销售那段 5 分钟后才到）→ 更新原触点。
    if (prev && prev.crmStatus === 'written' && row.crmStatus === 'written' && row.contactId && folded.stage === 'ended' &&
        (row.talkSeconds !== prev.talkSeconds || row.answered !== prev.answered || row.staffEmail !== prev.staffEmail)) {
      const rec = toCallRecord(folded)
      const planned = rec ? planCallIngest([rec], { defaultCountry: conn.defaultCountry }).calls[0] : undefined
      if (planned) {
        await store.updateCallTouchpoint(touchpointInput(conn, folded, planned, row.contactId, row.staffEmail))
        pushReceipt(row, receipt('crm', 'updated', stamp, 'later_events_changed_outcome'))
      }
    }
    await store.saveCall(row)
    if (raw.event.eventType !== 'other') await store.markRaw(raw.id, 'processed', null)
    return {
      callId: folded.callId,
      stage: row.stage,
      crmStatus: row.crmStatus,
      matchStatus: row.matchStatus,
      recordingStatus: row.recordingStatus,
      ...(inQuietWindow && (row.crmStatus === 'pending' || recoverableReview) ? { deferred: true } : {}),
    }
  } catch (err) {
    // CRM 失败已在上面落了状态；其余（取数、存通话失败）只标原始事件，留给补处理重试。
    const msg = safeErr(err)
    await store.markRaw(raw.id, 'failed', msg).catch(() => undefined)
    throw new Error(msg)
  }
}
