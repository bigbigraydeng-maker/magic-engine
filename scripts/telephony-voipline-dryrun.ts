/**
 * VoIPLine 接入「当场试跑」：用合成事件（非真实样本、虚构号码）把整条链路在内存里真跑一遍，
 * 经过真实的 handleVoiplineWebhook → processRawEvent → sweep，不碰网络、不碰数据库、不外发。
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x \
 *     npx tsx scripts/telephony-voipline-dryrun.ts
 */

import { processRawEvent } from '../src/lib/telephony/voipline/process'
import { sweepStaleRawEvents } from '../src/lib/inngest/functions/telephony-voipline'
import {
  CLIENT_A, CONN_A, CONN_B, CUSTOMER_E164, TOKEN_A, harness, inboundAnswered, inboundEnded, inboundRecording,
  inboundStart, outboundAnswered, outboundEnded, outboundRecording, outboundStart,
} from '../src/lib/telephony/voipline/__tests__/fixtures'

type H = ReturnType<typeof harness>
const rows: string[][] = []
const call = (h: H, id = 'call-1') => h.mem.calls.get(`${CLIENT_A}|${id}`)
const tps = (h: H) => [...h.mem.touchpoints.values()]
const line = (name: string, http: string, c: string, extra = '') => rows.push([name, http, c, extra])
const summ = (h: H) => {
  const c = call(h)
  const t = tps(h)
  return c
    ? `stage=${c.stage} crm=${c.crmStatus} match=${c.matchStatus} talk=${c.talkSeconds}s rec=${c.recordingStatus} touchpoints=${t.length}${t[0] ? ` outcome=${t[0].outcome} reached=${t[0].reached} by=${t[0].staffEmail ?? 'null'}` : ''}`
    : `（无通话行）touchpoints=${t.length}`
}

async function main() {
  let h = harness()
  const codes: number[] = []
  for (const e of [inboundStart(), inboundAnswered(), inboundEnded()]) codes.push((await h.send(e)).status)
  await h.drain()
  line('1 入站接通', codes.join('/'), summ(h))

  h = harness(); h.mem.addContact(CLIENT_A, CUSTOMER_E164)
  codes.length = 0
  for (const e of [outboundStart(), outboundEnded()]) codes.push((await h.send(e)).status)
  await h.drain()
  line('2 出站未接（已有联系人）', codes.join('/'), summ(h))

  h = harness(); h.mem.addContact(CLIENT_A, CUSTOMER_E164)
  codes.length = 0
  for (const e of [outboundStart(), outboundAnswered(), outboundEnded({ connected_at: '2026-10-12T01:00:05.000Z', call_duration: 250, conversation_duration: 240 }), outboundRecording()]) codes.push((await h.send(e)).status)
  await h.drain()
  line('3 出站接通有录音', codes.join('/'), summ(h))

  h = harness()
  for (const e of [inboundStart(), inboundAnswered(), inboundEnded()]) await h.send(e)
  await h.drain()
  const before = tps(h).length
  await h.send(inboundRecording()); await h.drain()
  line('4 迟到录音', '200', summ(h), `触点 ${before}→${tps(h).length}（没新增）`)

  h = harness()
  const r1 = await h.send(inboundStart()); const r2 = await h.send(inboundStart())
  line('5 重复事件', `${r1.status}/${r2.status}`, `${r1.body.status}/${r2.body.status}`, `原始事件行数=${h.mem.raw.size}`)

  const inOrder = harness(); const shuffled = harness()
  for (const e of [inboundStart(), inboundAnswered(), inboundEnded(), inboundRecording()]) await inOrder.send(e)
  for (const e of [inboundRecording(), inboundEnded(), inboundAnswered(), inboundStart()]) await shuffled.send(e)
  await inOrder.drain(); await shuffled.drain()
  const sig = (x: H) => { const c = call(x)!; return `${c.stage}|${c.talkSeconds}|${c.crmStatus}|${c.recordingStatus}|${tps(x).length}` }
  line('6 乱序', '200', sig(shuffled), `与顺序到达${sig(inOrder) === sig(shuffled) ? '完全一致' : '不一致!!'}`)

  h = harness()
  const bad = await h.send(inboundStart(), { token: 'wrong-token' })
  line('7 token 错误', String(bad.status), bad.body.status, `原始事件=${h.mem.raw.size} 拒绝回执=${h.mem.rejections.map((x) => x.reason).join(',')}`)

  h = harness()
  const unk = await h.send(inboundStart(), { conn: '99999999-9999-4999-8999-999999999999' })
  const cross = await h.send(inboundStart(), { conn: CONN_B, token: TOKEN_A })
  line('8 客户不明 / 串客户令牌', `${unk.status}/${cross.status}`, 'rejected', `原始事件=${h.mem.raw.size} 回执=${h.mem.rejections.map((x) => x.reason).join(',')}`)

  h = harness()
  h.mem.failures.touchpointWrites = 1
  await h.send(inboundStart()); await h.send(inboundEnded())
  await h.drain().catch((e: Error) => line('9a 写 CRM 失败', '200', `crm=${call(h)?.crmStatus}`, `错误可见：${e.message}`))
  const sw = await sweepStaleRawEvents(h.mem.store, async (id) => { await processRawEvent(h.mem.store, id, h.now, { quietMs: 0 }) }, new Date('2026-10-12T03:00:00.000Z'))
  line('9b 补处理重试', '-', summ(h), `sweep=${JSON.stringify(sw)}`)

  for (const r of rows) console.log(r.join('  |  '))
  console.log(`\nCONN_A=${CONN_A.slice(0, 8)}… 试跑完成，未碰网络/数据库/外发。`)
}
main().catch((e) => { console.error(e); process.exit(1) })
