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

export const ev = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  unique_call_id: 'call-1',
  call_start_at: '2026-10-12T01:00:00.000Z',
  user_extension: '101',
  ...over,
})

export const inboundStart = (o: Record<string, unknown> = {}) => ev('user_inbound_call', { user_number: CUSTOMER, user_name: 'Test Caller', ...o })
export const inboundAnswered = (o: Record<string, unknown> = {}) => ev('user_inbound_call_answered', { user_number: CUSTOMER, ...o })
export const inboundEnded = (o: Record<string, unknown> = {}) => ev('user_inbound_call_completion', { user_number: CUSTOMER, duration: 95, answered: true, ...o })
export const outboundStart = (o: Record<string, unknown> = {}) => ev('user_outbound_call', { dest_number: CUSTOMER, ...o })
export const outboundAnswered = (o: Record<string, unknown> = {}) => ev('user_outbound_call_answered', { dest_number: CUSTOMER, ...o })
export const outboundEnded = (o: Record<string, unknown> = {}) => ev('user_outbound_call_completion', { dest_number: CUSTOMER, duration: 0, answered: false, ...o })
export const outboundRecording = (o: Record<string, unknown> = {}) =>
  ev('outbound_call_recording', { dest_number: CUSTOMER, recording_id: 'rec-1', recording_url: 'https://recordings.example.test/rec-1', ...o })
export const inboundRecording = (o: Record<string, unknown> = {}) =>
  ev('inbound_call_recording', { user_number: CUSTOMER, recording_id: 'rec-2', recording_url: 'https://recordings.example.test/rec-2', ...o })

export function harness(conns = [connA(), connB()]) {
  const mem = createMemoryStore(conns)
  const emitted: string[] = []
  let clock = Date.parse('2026-10-12T01:00:00.000Z')
  const now = () => new Date((clock += 1000))
  return {
    mem,
    emitted,
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
    async drain() {
      const ids = emitted.splice(0)
      const outs = []
      for (const id of ids) outs.push(await processRawEvent(mem.store, id, now))
      return outs
    },
  }
}
