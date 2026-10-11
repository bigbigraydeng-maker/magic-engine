import { describe, expect, it } from 'vitest'
import { hashWebhookToken, verifyWebhookToken } from '../auth'
import { buildDedupeKey, classifyEventType, parseVoiplineEvent } from '../events'
import { sweepStaleRawEvents } from '@/lib/inngest/functions/telephony-voipline'
import {
  CLIENT_A, CLIENT_B, CONN_A, CONN_B, CUSTOMER_E164, TOKEN_A, TOKEN_B,
  connA, harness, inboundAnswered, inboundEnded, inboundRecording, inboundStart,
  outboundAnswered, outboundEnded, outboundRecording, outboundStart, ev,
} from './fixtures'

const tpOf = (h: ReturnType<typeof harness>) => [...h.mem.touchpoints.values()]
const callOf = (h: ReturnType<typeof harness>, client = CLIENT_A, id = 'call-1') => h.mem.calls.get(`${client}|${id}`)

describe('令牌校验', () => {
  it('对的通过，错的 / 空的 / 没配的都拒绝', () => {
    const hash = hashWebhookToken('secret-token')
    expect(verifyWebhookToken('secret-token', hash)).toBe(true)
    expect(verifyWebhookToken('secret-tokeN', hash)).toBe(false)
    expect(verifyWebhookToken('', hash)).toBe(false)
    expect(verifyWebhookToken(null, hash)).toBe(false)
    expect(verifyWebhookToken('secret-token', null)).toBe(false)
    expect(verifyWebhookToken('secret-token', 'not-hex')).toBe(false)
  })
})

describe('事件解析', () => {
  it('事件名归类：录音优先，队列/语音信箱不进 CRM', () => {
    expect(classifyEventType('user_inbound_call')).toBe('call_started')
    expect(classifyEventType('user_outbound_call_answered')).toBe('call_answered')
    expect(classifyEventType('user_inbound_call_completion')).toBe('call_ended')
    expect(classifyEventType('Outbound call recording')).toBe('recording_ready')
    expect(classifyEventType('queue_call_summary')).toBe('other')
    expect(classifyEventType('voicemail')).toBe('other')
  })
  it('缺通话编号 / 缺事件名 → 解析失败，不猜', () => {
    expect(parseVoiplineEvent({ type: 'user_inbound_call' })).toEqual({ ok: false, reason: 'missing_call_id' })
    expect(parseVoiplineEvent({ unique_call_id: 'x' })).toEqual({ ok: false, reason: 'missing_event_type' })
    expect(parseVoiplineEvent('x')).toEqual({ ok: false, reason: 'not_an_object' })
  })
  it('方向不明时不猜对方号码', () => {
    const r = parseVoiplineEvent({ type: 'something_call', unique_call_id: 'x', user_number: '021', dest_number: '022' })
    expect(r.ok && r.event.counterpartyNumber).toBe(null)
  })
  it('字节级相同的重发指纹相同，内容不同的不同', () => {
    const a = parseVoiplineEvent(inboundEnded())
    const b = parseVoiplineEvent(inboundEnded({ duration: 99 }))
    if (!a.ok || !b.ok) throw new Error('parse')
    expect(buildDedupeKey('acct', a.event, inboundEnded())).toBe(buildDedupeKey('acct', a.event, { ...inboundEnded() }))
    expect(buildDedupeKey('acct', a.event, inboundEnded())).not.toBe(buildDedupeKey('acct', b.event, inboundEnded({ duration: 99 })))
  })
})

describe('接收：fail-closed 与回执', () => {
  it('令牌错 → 401，留拒绝回执，不落原始事件，不发处理事件', async () => {
    const h = harness()
    const r = await h.send(inboundStart(), { token: 'wrong' })
    expect(r.status).toBe(401)
    expect(h.mem.raw.size).toBe(0)
    expect(h.emitted).toHaveLength(0)
    expect(h.mem.rejections).toEqual([{ connectionId: CONN_A, clientId: CLIENT_A, reason: 'bad_token' }])
  })
  it('没带令牌 → 401', async () => {
    const h = harness()
    expect((await h.send(inboundStart(), { token: null })).status).toBe(401)
  })
  it('A 客户的令牌打到 B 客户的连接 → 401（令牌按客户隔离）', async () => {
    const h = harness()
    expect((await h.send(inboundStart(), { conn: CONN_B, token: TOKEN_A })).status).toBe(401)
    expect(h.mem.raw.size).toBe(0)
  })
  it('客户不明（连接不存在 / 格式不对 / 已停用）→ 401 + 回执，不处理', async () => {
    const h = harness([connA({ active: false })])
    expect((await h.send(inboundStart())).status).toBe(401)
    expect((await h.send(inboundStart(), { conn: '99999999-9999-4999-8999-999999999999' })).status).toBe(401)
    expect((await h.send(inboundStart(), { conn: 'not-a-uuid' })).status).toBe(401)
    expect(h.mem.rejections.map((x) => x.reason)).toEqual(['connection_inactive', 'unknown_connection', 'bad_connection_id_format'])
    expect(h.mem.raw.size).toBe(0)
  })
  it('坏 JSON / 缺通话编号 → 400 + 回执', async () => {
    const h = harness()
    expect((await h.send('{oops')).status).toBe(400)
    expect((await h.send({ type: 'user_inbound_call' })).status).toBe(400)
    expect(h.mem.rejections.map((x) => x.reason)).toEqual(['invalid_json', 'unparseable:missing_call_id'])
  })
  it('落库失败 → 503（让 PBX 重发），不发处理事件', async () => {
    const h = harness()
    h.mem.store.insertRawEvent = async () => {
      throw new Error('db down')
    }
    expect((await h.send(inboundStart())).status).toBe(503)
    expect(h.emitted).toHaveLength(0)
  })
  it('发处理事件失败不影响 200，补处理任务能捞起来', async () => {
    const h = harness()
    const res = await (await import('../ingest')).handleVoiplineWebhook(h.mem.store, {
      connectionId: CONN_A, tokenHeader: TOKEN_A, bodyText: JSON.stringify(inboundStart()),
      emit: async () => { throw new Error('inngest down') },
    })
    expect(res.status).toBe(200)
    expect(h.mem.raw.size).toBe(1)
    const sweep = await sweepStaleRawEvents(h.mem.store, new Date('2026-10-12T03:00:00.000Z'))
    expect(sweep.picked).toBe(1)
  })
})

describe('场景：入站接通', () => {
  it('新来电客人 → 建联系人 + 一条触点，员工/方向/时长正确，source 是 voipline 且无 automated', async () => {
    const h = harness()
    await h.send(inboundStart())
    await h.send(inboundAnswered())
    await h.send(inboundEnded())
    await h.drain()
    const c = callOf(h)!
    expect(c).toMatchObject({ stage: 'ended', direction: 'inbound', answered: true, talkSeconds: 95, staffEmail: 'staff.one@example.test', matchStatus: 'created', crmStatus: 'written', counterpartyE164: CUSTOMER_E164, learningEligible: false })
    expect(tpOf(h)).toHaveLength(1)
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'spoke', staffEmail: 'staff.one@example.test', direction: 'inbound', sourceRef: 'acct-a:call-1' })
    expect(JSON.stringify(tpOf(h)[0])).not.toContain('automated')
  })
})

describe('场景：外呼', () => {
  it('外呼未接：不标有效联系，库里没这个人就不新建', async () => {
    const h = harness()
    await h.send(outboundStart())
    await h.send(outboundEnded())
    await h.drain()
    expect(callOf(h)).toMatchObject({ answered: false, crmStatus: 'skipped', matchStatus: 'unmatched_outbound' })
    expect(tpOf(h)).toHaveLength(0)
    expect(h.mem.contactCount(CLIENT_A)).toBe(0)
  })
  it('外呼未接，号码是已有联系人：写一条 no_answer，reached=false，不前移 last_seen', async () => {
    const h = harness()
    const cid = h.mem.addContact(CLIENT_A, CUSTOMER_E164)
    await h.send(outboundStart())
    await h.send(outboundEnded())
    await h.drain()
    expect(tpOf(h)[0]).toMatchObject({ contactId: cid, outcome: 'no_answer', reached: false })
    expect(h.mem.lastSeen.has(cid)).toBe(false)
  })
  it('外呼秒挂（接通 3 秒）不算有效联系', async () => {
    const h = harness()
    h.mem.addContact(CLIENT_A, CUSTOMER_E164)
    await h.send(outboundAnswered())
    await h.send(outboundEnded({ duration: 3, answered: true }))
    await h.drain()
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'no_answer', reached: false })
  })
  it('外呼接通有录音：有效联系 + 录音引用待下载 + 转写/摘要未开始 + 不可进学习', async () => {
    const h = harness()
    h.mem.addContact(CLIENT_A, CUSTOMER_E164)
    await h.send(outboundStart())
    await h.send(outboundAnswered())
    await h.send(outboundEnded({ duration: 240, answered: true }))
    await h.send(outboundRecording())
    await h.drain()
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'spoke', reached: true, talkSeconds: 240 })
    expect(callOf(h)).toMatchObject({ recordingRef: 'rec-1', recordingStatus: 'pending_download', transcriptStatus: 'not_started', summaryStatus: 'not_started', learningEligible: false })
    // 录音链接不进通话表，只留在原始事件行
    expect(JSON.stringify(callOf(h))).not.toContain('recordings.example.test')
  })
})

describe('场景：迟到 / 重复 / 乱序', () => {
  it('结束之后才到的录音：更新原通话，不重复写触点', async () => {
    const h = harness()
    await h.send(inboundStart()); await h.send(inboundAnswered()); await h.send(inboundEnded())
    await h.drain()
    expect(callOf(h)!.recordingStatus).toBe('none')
    await h.send(inboundRecording())
    await h.drain()
    expect(callOf(h)).toMatchObject({ recordingStatus: 'pending_download', recordingRef: 'rec-2' })
    expect(tpOf(h)).toHaveLength(1)
  })
  it('同一事件重发：只留一行原始事件，回 duplicate', async () => {
    const h = harness()
    expect((await h.send(inboundStart())).body.status).toBe('accepted')
    expect((await h.send(inboundStart())).body.status).toBe('duplicate')
    expect(h.mem.raw.size).toBe(1)
  })
  it('乱序（录音→结束→接通→开始）结果与顺序到达完全一致，状态不倒退', async () => {
    const inOrder = harness()
    for (const e of [inboundStart(), inboundAnswered(), inboundEnded(), inboundRecording()]) await inOrder.send(e)
    await inOrder.drain()
    const shuffled = harness()
    for (const e of [inboundRecording(), inboundEnded(), inboundAnswered(), inboundStart()]) await shuffled.send(e)
    await shuffled.drain()
    const strip = (c: ReturnType<typeof callOf>) => ({ ...c!, receipts: undefined, recordingRawEventId: undefined })
    expect(strip(callOf(shuffled))).toEqual(strip(callOf(inOrder)))
    expect(tpOf(shuffled)).toHaveLength(1)
  })
  it('先处理「开始」、后处理「结束」：stage 只前进', async () => {
    const h = harness()
    await h.send(inboundStart()); await h.drain()
    expect(callOf(h)!.stage).toBe('started')
    await h.send(inboundEnded()); await h.drain()
    expect(callOf(h)!.stage).toBe('ended')
    await h.send(inboundStart({ call_start_at: '2026-10-12T01:00:00.500Z' })); await h.drain()
    expect(callOf(h)!.stage).toBe('ended')
  })
  it('转接：同一通合并成一条触点，保留每段员工，接得久的算主处理人', async () => {
    const h = harness()
    await h.send(inboundStart({ user_extension: '101' }))
    await h.send(inboundAnswered({ user_extension: '101' }))
    await h.send(inboundEnded({ user_extension: '101', duration: 15 }))
    await h.send(inboundAnswered({ user_extension: '102' }))
    await h.send(inboundEnded({ user_extension: '102', duration: 300 }))
    await h.drain()
    const c = callOf(h)!
    expect(c.legs.map((l) => l.extension).sort()).toEqual(['101', '102'])
    expect(c.staffEmail).toBe('staff.two@example.test')
    expect(tpOf(h)).toHaveLength(1)
  })
  it('分机没登记：logged_by 留空，不编员工', async () => {
    const h = harness()
    await h.send(inboundStart({ user_extension: '999' })); await h.send(inboundEnded({ user_extension: '999' }))
    await h.drain()
    expect(tpOf(h)[0].staffEmail).toBeNull()
  })
})

describe('归属与隔离', () => {
  it('同一号码挂了两个联系人：进待确认，不挑、不写触点', async () => {
    const h = harness()
    h.mem.addContact(CLIENT_A, CUSTOMER_E164); h.mem.addContact(CLIENT_A, CUSTOMER_E164)
    await h.send(inboundStart()); await h.send(inboundEnded())
    await h.drain()
    expect(callOf(h)).toMatchObject({ matchStatus: 'needs_review', crmStatus: 'needs_review' })
    expect(tpOf(h)).toHaveLength(0)
  })
  it('两个客户、同号码同通话编号：各写各的，互不串', async () => {
    const h = harness()
    const a = h.mem.addContact(CLIENT_A, CUSTOMER_E164)
    const b = h.mem.addContact(CLIENT_B, CUSTOMER_E164)
    await h.send(inboundStart()); await h.send(inboundEnded())
    await h.send(inboundStart(), { conn: CONN_B }); await h.send(inboundEnded(), { conn: CONN_B })
    await h.drain()
    const tps = tpOf(h)
    expect(tps).toHaveLength(2)
    expect(tps.find((t) => t.clientId === CLIENT_A)!.contactId).toBe(a)
    expect(tps.find((t) => t.clientId === CLIENT_B)!.contactId).toBe(b)
    expect(tps.find((t) => t.clientId === CLIENT_B)!.staffEmail).toBe('other.staff@example.test')
    expect(TOKEN_B).not.toBe(TOKEN_A)
  })
  it('认不出的号码 / 隐藏号码：通话留档，不进 CRM', async () => {
    const h = harness()
    await h.send(inboundStart({ user_number: 'anonymous' })); await h.send(inboundEnded({ user_number: 'anonymous' }))
    await h.drain()
    expect(callOf(h)).toMatchObject({ crmStatus: 'skipped' })
    expect(tpOf(h)).toHaveLength(0)
  })
  it('方向不明：进待确认，不猜', async () => {
    const h = harness()
    await h.send(ev('call_completion_generic', { user_number: '0210000001' }))
    await h.drain()
    expect(callOf(h)).toMatchObject({ crmStatus: 'needs_review' })
    expect(tpOf(h)).toHaveLength(0)
  })
})

describe('失败可见 + 可重试', () => {
  it('写 CRM 失败：通话标 failed、原始事件标 failed；补处理后成功且只写一条', async () => {
    const h = harness()
    h.mem.failures.touchpointWrites = 1
    await h.send(inboundStart()); await h.send(inboundEnded())
    const ids = [...h.emitted]
    h.emitted.length = 0
    const { processRawEvent } = await import('../process')
    await expect(processRawEvent(h.mem.store, ids[0])).rejects.toThrow()
    expect(callOf(h)!.crmStatus).toBe('failed')
    expect([...h.mem.raw.values()].some((r) => r.status === 'failed')).toBe(true)
    const sweep = await sweepStaleRawEvents(h.mem.store, new Date('2026-10-12T03:00:00.000Z'))
    expect(sweep.picked).toBeGreaterThan(0)
    expect(callOf(h)!.crmStatus).toBe('written')
    expect(tpOf(h)).toHaveLength(1)
  })
  it('队列摘要 / 语音信箱这类事件：留档为 ignored，不建通话不进 CRM', async () => {
    const h = harness()
    await h.send(ev('queue_call_summary', { user_number: '0210000001' }))
    await h.drain()
    expect([...h.mem.raw.values()][0].status).toBe('ignored')
    expect(h.mem.calls.size).toBe(0)
  })
})
