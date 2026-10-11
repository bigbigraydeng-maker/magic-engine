/**
 * VoIPLine 通话事件的云端消费者（CTS 员工电话 → CRM）。
 *
 * 两个函数：
 *   · process  —— 收到「原始事件已落库」事件，处理那一条（重折整通电话、通话结束后写 CRM）。
 *   · sweep    —— 每 10 分钟捞「落库了但没处理成」的事件重处理，兜住「发事件失败」和
 *                 「处理中途失败」两种情况（webhook 回 200 的承诺靠它兑现）。
 *
 * 回执：每个原始事件有 status/attempts/last_error，每通电话有 receipts 数组（见 process.ts）。
 * 没有任何一步发布、扣费或对客外发；转写 / 摘要 / 学习都不在这里（本 PR 未实现）。
 *
 * 一事件一主：该事件名是云端专属，本机 worker 不监听。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { TELEPHONY_RAW_EVENT_RECEIVED } from '@/lib/telephony/voipline/events-contract'
import { processRawEvent } from '@/lib/telephony/voipline/process'
import { supabaseTelephonyStore } from '@/lib/telephony/voipline/store'
import type { TelephonyStore } from '@/lib/telephony/voipline/types'

export const SWEEP_MIN_AGE_MS = 5 * 60 * 1000
export const SWEEP_MAX_ATTEMPTS = 5
export const SWEEP_BATCH = 50

/** 补处理一轮；可注入存储，便于不碰真库地试跑。 */
export async function sweepStaleRawEvents(
  store: TelephonyStore,
  now: Date = new Date(),
): Promise<{ picked: number; processed: number; failed: number }> {
  const stale = await store.listStaleRaw(new Date(now.getTime() - SWEEP_MIN_AGE_MS).toISOString(), SWEEP_MAX_ATTEMPTS, SWEEP_BATCH)
  let processed = 0
  let failed = 0
  for (const raw of stale) {
    try {
      await processRawEvent(store, raw.id, () => now)
      processed++
    } catch {
      failed++
    }
  }
  return { picked: stale.length, processed, failed }
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
    return step.run('process-raw-event', async () => {
      const out = await processRawEvent(supabaseTelephonyStore, rawEventId)
      return { status: out ? ('processed' as const) : ('skipped' as const), ...(out ?? {}), no_publish: true as const }
    })
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
  async ({ step }) => step.run('sweep', () => sweepStaleRawEvents(supabaseTelephonyStore)),
)
