/**
 * VoIPLine 通话事件的云端消费者（CTS 员工电话 → CRM）。
 *
 * 两个函数：
 *   · process  —— 收到「原始事件已落库」事件，处理那一条（重折整通电话、通话结束后写 CRM）。
 *                 通话刚结束时有 2 分钟静默期（转接的前一段先到会误判），期满再处理一次。
 *   · sweep    —— 每 10 分钟补一轮：①落库了但没处理成的原始事件，**重发处理事件**（让所有处理
 *                 都走 process 的同一个并发闸，不在 sweep 里直接写）；②已结束却迟迟没写 CRM 的通话；
 *                 ③6 小时仍没收到结束事件的通话，标「待确认」。
 *
 * 回执：每个原始事件有 status/attempts/last_error，每通电话有 receipts 数组（见 process.ts）。
 * 没有任何一步发布、扣费或对客外发；转写 / 摘要 / 学习都不在这里（本 PR 未实现）。
 * 一事件一主：该事件名是云端专属，本机 worker 不监听。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { TELEPHONY_RAW_EVENT_RECEIVED } from '@/lib/telephony/voipline/events-contract'
import { CRM_QUIET_MS, NO_END_EVENT_DETAIL, processRawEvent } from '@/lib/telephony/voipline/process'
import { supabaseTelephonyStore } from '@/lib/telephony/voipline/store'
import type { TelephonyStore } from '@/lib/telephony/voipline/types'

export const SWEEP_MIN_AGE_MS = 5 * 60 * 1000
export const SWEEP_MAX_ATTEMPTS = 10
export const SWEEP_BATCH = 50
/** 超过这么久还没收到结束事件的通话，不再等，转人工确认。 */
/** 同一通已结束电话最多被补处理重发这么多次，之后转人工确认。 */
export const MAX_CALL_REDISPATCH = 5
export const NO_END_EVENT_GIVE_UP_MS = 6 * 3600 * 1000

export interface SweepResult {
  rawRedispatched: number
  endedCallsRedispatched: number
  flaggedNoEnd: number
  /** 已达重试上限、没人再会捞的原始事件数（必须有人看；本期还没有页面/待办，见台账卡）。 */
  exhaustedRaw: number
}

export type Dispatch = (rawEventId: string, clientId: string, connectionId: string) => Promise<void>

/** 补处理一轮。`dispatch` 在生产里是「重发处理事件」，试跑里可以直接处理。 */
export async function sweepStaleRawEvents(store: TelephonyStore, dispatch: Dispatch, now: Date = new Date()): Promise<SweepResult> {
  const stale = await store.listStaleRaw(new Date(now.getTime() - SWEEP_MIN_AGE_MS).toISOString(), SWEEP_MAX_ATTEMPTS, SWEEP_BATCH)
  for (const raw of stale) await dispatch(raw.id, raw.clientId, raw.connectionId)

  let endedCallsRedispatched = 0
  let flaggedNoEnd = 0
  const calls = await store.listStaleCalls(new Date(now.getTime() - CRM_QUIET_MS).toISOString(), SWEEP_BATCH)
  for (const stale of calls) {
    // 发之前重读一遍：别人刚写成了就别再动（避免用旧行覆盖新状态）。
    const c = await store.getCall(stale.clientId, stale.provider, stale.providerCallId)
    if (!c || c.crmStatus !== 'pending') continue
    const conn = await store.getConnection(c.connectionId)
    if (!conn || !conn.active) continue
    const redispatched = c.receipts.filter((r) => r.stage === 'sweep').length
    const flag = async (detail: string, why: string) => {
      await store.saveCall({
        ...c,
        crmStatus: 'needs_review',
        crmDetail: detail,
        receipts: [...c.receipts, { stage: 'crm', status: 'needs_review', at: now.toISOString(), detail: why }].slice(-50),
      })
      flaggedNoEnd++
    }
    if (c.stage === 'ended') {
      if (redispatched >= MAX_CALL_REDISPATCH) {
        await flag('补处理多次仍没写进客户记录，需人工确认', 'redispatch_exhausted')
        continue
      }
      const evs = await store.listRawEventsForCall(c.clientId, c.connectionId, c.providerCallId)
      const last = [...evs].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).pop()
      if (last) {
        await store.saveCall({ ...c, receipts: [...c.receipts, { stage: 'sweep', status: 'redispatched', at: now.toISOString() }].slice(-50) })
        await dispatch(last.id, c.clientId, c.connectionId)
        endedCallsRedispatched++
      }
    } else if (now.getTime() - Date.parse(c.startedAt) > NO_END_EVENT_GIVE_UP_MS) {
      await flag(NO_END_EVENT_DETAIL, 'no_end_event')
    }
  }
  await store
    .purgeRejections(new Date(now.getTime() - 14 * 86400_000).toISOString(), new Date(now.getTime() - 7 * 86400_000).toISOString())
    .catch(() => undefined)
  const exhaustedRaw = await store.countExhaustedRaw(SWEEP_MAX_ATTEMPTS)
  return { rawRedispatched: stale.length, endedCallsRedispatched, flaggedNoEnd, exhaustedRaw }
}

export const telephonyVoiplineProcess = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}telephony-voipline-process`,
    name: 'Telephony — VoIPLine raw event → call → CRM',
    retries: 3,
    concurrency: { key: 'event.data.connection_id', limit: 1 },
  },
  { event: TELEPHONY_RAW_EVENT_RECEIVED },
  async ({ event, step }) => {
    const rawEventId = String((event.data as Record<string, unknown>).raw_event_id ?? '')
    if (!rawEventId) return { status: 'invalid_payload' as const }
    const run = () =>
      processRawEvent(supabaseTelephonyStore, rawEventId).then((out) => ({
        status: out ? ('processed' as const) : ('skipped' as const),
        ...(out ?? {}),
        no_publish: true as const,
      }))
    const first = await step.run('process-raw-event', run)
    if ('deferred' in first && first.deferred) {
      await step.sleep('crm-quiet-window', `${Math.ceil(CRM_QUIET_MS / 1000) + 10}s`)
      return step.run('process-raw-event-after-quiet', run)
    }
    return first
  },
)

export const telephonyVoiplineSweep = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}telephony-voipline-sweep`,
    name: 'Telephony — VoIPLine stale raw event sweep',
    retries: 1,
    concurrency: { limit: 1 },
  },
  { cron: '*/10 * * * *' },
  async ({ step }) =>
    step.run('sweep', () =>
      sweepStaleRawEvents(supabaseTelephonyStore, async (rawEventId, clientId, connectionId) => {
        await inngest.send({
          name: TELEPHONY_RAW_EVENT_RECEIVED,
          data: { raw_event_id: rawEventId, client_id: clientId, connection_id: connectionId },
        })
      }),
    ),
)
