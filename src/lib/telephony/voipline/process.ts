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
import type { CallRow, CrmStatus, MatchStatus, Receipt, TelephonyConnection, TelephonyStore } from './types'

const MAX_RECEIPTS = 50

export interface ProcessOutcome {
  callId: string
  stage: string
  crmStatus: CrmStatus
  matchStatus: MatchStatus
  recordingStatus: string
}

function receipt(stage: string, status: string, now: string, detail?: string): Receipt {
  return { stage, status, at: now, ...(detail ? { detail } : {}) }
}

function baseRow(conn: TelephonyConnection, folded: FoldedCall, prev: CallRow | null): CallRow {
  return {
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
    staffEmail: folded.extension ? (conn.extensionMap[folded.extension] ?? null) : null,
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

function pushReceipt(row: CallRow, r: Receipt) {
  row.receipts = [...row.receipts, r].slice(-MAX_RECEIPTS)
}

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

  const tp = await store.writeCallTouchpoint({
    clientId: conn.clientId,
    contactId,
    direction: planned.direction,
    occurredAt: planned.occurredAt,
    summary: describeCall(planned),
    sourceRef: `${conn.providerAccountId}:${folded.callId}`,
    staffEmail: row.staffEmail,
    // 有效联系 = call-plan 判断⑤；其余（含未接、秒挂）一律 no_answer，不冒充聊过。
    outcome: planned.countsAsReached || (planned.direction === 'inbound' && planned.answered && planned.talkSeconds >= 10) ? 'spoke' : 'no_answer',
    reached: planned.countsAsReached,
    answered: planned.answered,
    talkSeconds: planned.talkSeconds,
    providerCallId: folded.callId,
  })
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
): Promise<ProcessOutcome | null> {
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

    const prev = await store.getCall(conn.clientId, raw.callId)
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

    if (folded.stage === 'ended' && (row.crmStatus === 'pending' || row.crmStatus === 'failed')) {
      try {
        await writeCrm(store, conn, folded, row, stamp)
      } catch (err) {
        row.crmStatus = 'failed'
        row.crmDetail = err instanceof Error ? err.message.slice(0, 300) : 'unknown'
        pushReceipt(row, receipt('crm', 'failed', stamp, row.crmDetail))
        await store.saveCall(row)
        await store.markRaw(raw.id, 'failed', row.crmDetail)
        throw err
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
    }
  } catch (err) {
    // CRM 失败已在上面落了状态；其余（取数、存通话失败）只标原始事件，留给补处理重试。
    const msg = err instanceof Error ? err.message.slice(0, 300) : 'unknown'
    await store.markRaw(raw.id, 'failed', msg).catch(() => undefined)
    throw err
  }
}
