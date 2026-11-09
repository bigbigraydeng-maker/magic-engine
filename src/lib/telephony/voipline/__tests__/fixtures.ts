/**
 * 合成样本，**不是** VoIPLine 真实样本：字段名按 events.ts 的别名表取（官方文档只给了
 * webhook_component_event 的字段名，其余在门户样例图片里）。号码都是虚构。
 */

import { createMemoryStore } from './memory-store'
import { generateWebhookToken, hashWebhookToken } from '../auth'
import { handleVoiplineWebhook } from '../ingest'
import { processRawEvent } from '../process'
import type { TelephonyConnection } from '../types'

export const CLIENT_A = '11111111-1111-4111-8111-111111111111'
export const CLIENT_B = '22222222-2222-4222-8222-222222222222'
export const CONN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const CONN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

export const TOKEN_A = generateWebhookToken()
export const TOKEN_B = generateWebhookToken()

export const connA = (over: Partial<TelephonyConnection> = {}): TelephonyConnection => ({
  id: CONN_A,
  clientId: CLIENT_A,
  provider: 'voipline',
  providerAccountId: 'acct-a',
  webhookTokenHash: hashWebhookToken(TOKEN_A),
  secretRef: null,
  forwardTo: null,
  defaultCountry: 'NZ',
  extensionMap: { '101': 'staff.one@example.test', '102': 'staff.two@example.test' },
  active: true,
  ...over,
})

export const connB = (): TelephonyConnection => ({
  ...connA(),
  id: CONN_B,
  clientId: CLIENT_B,
  providerAccountId: 'acct-b',
  webhookTokenHash: hashWebhookToken(TOKEN_B),
  extensionMap: { '101': 'other.staff@example.test' },
})

/** 虚构号码：021 0000xxxx（新西兰手机格式，仅作示例）。 */
export const CUSTOMER = '0210000001'
export const CUSTOMER_E164 = '+64210000001'

/** 真实样例形状（VoIPLine 后台官方示例）：caller_id=来电号码；user_number=员工分机；conversation_duration=通话时长。 */
export const ev = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  unique_call_id: 'call-1',
  call_start_at: '2026-10-12T01:00:00.000Z',
  user_number: '101',
  user_name: 'Staff',
  dest_number: '0900000000',
  ...over,
})

const CONNECTED = '2026-10-12T01:00:05.000Z'
export const inboundStart = (o: Record<string, unknown> = {}) => ev('user_inbound', { caller_id: CUSTOMER, caller_name: 'Test Caller', ...o })
export const inboundAnswered = (o: Record<string, unknown> = {}) => ev('user_inbound_answered', { caller_id: CUSTOMER, connected_at: CONNECTED, ...o })
export const inboundEnded = (o: Record<string, unknown> = {}) =>
  ev('user_inbound_completed', { caller_id: CUSTOMER, connected_at: CONNECTED, call_duration: 100, conversation_duration: 95, ...o })
export const outboundStart = (o: Record<string, unknown> = {}) => ev('user_outbound', { caller_id: '0900000000', dest_number: CUSTOMER, ...o })
export const outboundAnswered = (o: Record<string, unknown> = {}) => ev('user_outbound_answered', { dest_number: CUSTOMER, connected_at: CONNECTED, ...o })
export const outboundEnded = (o: Record<string, unknown> = {}) =>
  ev('user_outbound_completed', { dest_number: CUSTOMER, connected_at: null, call_duration: 20, conversation_duration: 0, ...o })
export const outboundRecording = (o: Record<string, unknown> = {}) => ({
  type: 'recording_outbound', unique_call_id: 'call-1', caller_id: '0900000000', dest_number: CUSTOMER,
  recorded_at: '2026-10-12T01:10:00.000Z', call_recording_link: 'https://recordings.example.test/rec-1', ...o,
})
export const inboundRecording = (o: Record<string, unknown> = {}) => ({
  type: 'recording_inbound', unique_call_id: 'call-1', caller_id: CUSTOMER, dest_number: '0900000000',
  recorded_at: '2026-10-12T01:10:00.000Z', call_recording_link: 'https://recordings.example.test/rec-2', ...o,
})

export function harness(conns = [connA(), connB()]) {
  const mem = createMemoryStore(conns)
  const emitted: string[] = []
  let clock = Date.parse('2026-10-12T01:00:00.000Z')
  const now = () => new Date((clock += 1000))
  return {
    mem,
    emitted,
    now,
    async send(payload: unknown, opts: { conn?: string; token?: string | null } = {}) {
      const connectionId = opts.conn ?? CONN_A
      const token = opts.token === undefined ? (connectionId === CONN_B ? TOKEN_B : TOKEN_A) : opts.token
      const res = await handleVoiplineWebhook(mem.store, {
        connectionId,
        tokenHeader: token,
        bodyText: typeof payload === 'string' ? payload : JSON.stringify(payload),
        now,
        emit: async (id) => {
          emitted.push(id)
        },
      })
      return res
    },
    /** 把所有已发出的处理事件按顺序处理掉（模拟 Inngest 消费）。 */
    async drain(opts: { quietMs?: number } = { quietMs: 0 }) {
      const ids = emitted.splice(0)
      const outs = []
      for (const id of ids) outs.push(await processRawEvent(mem.store, id, now, opts))
      return outs
    },
  }
}
