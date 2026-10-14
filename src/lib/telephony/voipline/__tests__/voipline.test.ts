import { describe, expect, it } from 'vitest'
import { processRawEvent } from '../process'
import { readCappedBody, MAX_BODY_BYTES } from '../ingest'
import { isHumanFollowup } from '@/lib/crm/lead-followup-due'
import { isUnansweredCall } from '@/lib/crm/segments'
import { hashWebhookToken, verifyWebhookToken } from '../auth'
import { buildDedupeKey, classifyEventType, parseVoiplineEvent } from '../events'
import { sweepStaleRawEvents } from '@/lib/inngest/functions/telephony-voipline'
import {
  CLIENT_A, CLIENT_B, CONN_A, CONN_B, CUSTOMER_E164, TOKEN_A, TOKEN_B, connB,
  connA, harness, inboundAnswered, inboundEnded, inboundRecording, inboundStart,
  outboundAnswered, outboundEnded, outboundRecording, outboundStart, ev,
} from './fixtures'

/** 试跑里把「重发处理事件」直接换成处理（不等静默期）。 */
const direct = (h: ReturnType<typeof harness>) => async (id: string) => {
  await processRawEvent(h.mem.store, id, h.now, { quietMs: 0 })
}
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
    const r = parseVoiplineEvent({ type: 'something_call', unique_call_id: 'x', caller_id: '021', dest_number: '022' })
    expect(r.ok && r.event.counterpartyNumber).toBe(null)
  })
  it('字节级相同的重发指纹相同，内容不同的不同', () => {
    const a = parseVoiplineEvent(inboundEnded())
    const b = parseVoiplineEvent(inboundEnded({ conversation_duration: 99 }))
    if (!a.ok || !b.ok) throw new Error('parse')
    const body = JSON.stringify(inboundEnded())
    expect(buildDedupeKey('acct', a.event, body, 'voipline')).toBe(buildDedupeKey('acct', a.event, body, 'voipline'))
    expect(buildDedupeKey('acct', a.event, body, 'voipline')).not.toBe(buildDedupeKey('acct', b.event, JSON.stringify(inboundEnded({ conversation_duration: 99 })), 'voipline'))
    // 通话编号里带冒号也不会和别的账号撞键
    const x = parseVoiplineEvent({ ...inboundEnded(), unique_call_id: 'a:b' })
    const y = parseVoiplineEvent({ ...inboundEnded(), unique_call_id: 'b' })
    if (!x.ok || !y.ok) throw new Error('parse')
    expect(buildDedupeKey('acct', x.event, body, 'voipline')).not.toBe(buildDedupeKey('acct:a', y.event, body, 'voipline'))
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
    // 令牌通过但读不懂：回 200（不让 PBX 反复重发），载荷留下来校准别名
    expect((await h.send({ type: 'user_inbound_call', note: 'sample' })).status).toBe(200)
    expect(h.mem.rejections.map((x) => x.reason)).toEqual(['invalid_json', 'unparseable:missing_call_id'])
    expect(h.mem.rejections[1].payload).toMatchObject({ note: 'sample' })
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
      connectionId: CONN_A, tokenHeader: TOKEN_A, bodyText: JSON.stringify(inboundStart()), now: () => new Date('2026-10-12T01:00:00.000Z'),
      emit: async () => { throw new Error('inngest down') },
    })
    expect(res.status).toBe(200)
    expect(h.mem.raw.size).toBe(1)
    const sweep = await sweepStaleRawEvents(h.mem.store, direct(h), new Date('2026-10-12T03:00:00.000Z'))
    expect(sweep.rawRedispatched).toBe(1)
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
    expect(tpOf(h)[0]).toMatchObject({ contactId: cid, outcome: 'no_answer', reached: false, staffEmail: null })
    expect(h.mem.lastSeen.has(cid)).toBe(false)
  })
  it('外呼秒挂（接通 3 秒）不算有效联系', async () => {
    const h = harness()
    h.mem.addContact(CLIENT_A, CUSTOMER_E164)
    await h.send(outboundAnswered())
    await h.send(outboundEnded({ conversation_duration: 3 }))
    await h.drain()
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'no_answer', reached: false })
  })
  it('外呼接通有录音：有效联系 + 录音引用待下载 + 转写/摘要未开始 + 不可进学习', async () => {
    const h = harness()
    h.mem.addContact(CLIENT_A, CUSTOMER_E164)
    await h.send(outboundStart())
    await h.send(outboundAnswered())
    await h.send(outboundEnded({ conversation_duration: 240 }))
    await h.send(outboundRecording())
    await h.drain()
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'spoke', reached: true, talkSeconds: 240 })
    expect(callOf(h)).toMatchObject({ recordingRef: 'call:call-1', recordingStatus: 'pending_download', transcriptStatus: 'not_started', summaryStatus: 'not_started', learningEligible: false })
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
    expect(callOf(h)).toMatchObject({ recordingStatus: 'pending_download', recordingRef: 'call:call-1' })
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
    await h.send(inboundStart({ user_number: '101' }))
    await h.send(inboundAnswered({ user_number: '101' }))
    await h.send(inboundEnded({ user_number: '101', conversation_duration: 15 }))
    await h.send(inboundAnswered({ user_number: '102' }))
    await h.send(inboundEnded({ user_number: '102', conversation_duration: 300 }))
    await h.drain()
    const c = callOf(h)!
    expect(c.legs.map((l) => l.extension).sort()).toEqual(['101', '102'])
    expect(c.staffEmail).toBe('staff.two@example.test')
    expect(tpOf(h)).toHaveLength(1)
  })
  it('分机没登记：logged_by 留空，不编员工', async () => {
    const h = harness()
    await h.send(inboundStart({ user_number: '999' })); await h.send(inboundEnded({ user_number: '999' }))
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
    await h.send(inboundStart({ caller_id: 'anonymous' })); await h.send(inboundEnded({ caller_id: 'anonymous' }))
    await h.drain()
    expect(callOf(h)).toMatchObject({ crmStatus: 'skipped' })
    expect(tpOf(h)).toHaveLength(0)
  })
  it('方向不明：进待确认，不猜', async () => {
    const h = harness()
    await h.send(ev('call_completion_generic', { caller_id: '0210000001' }))
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
    await expect(processRawEvent(h.mem.store, ids[0], h.now, { quietMs: 0 })).rejects.toThrow()
    expect(callOf(h)!.crmStatus).toBe('failed')
    expect([...h.mem.raw.values()].some((r) => r.status === 'failed')).toBe(true)
    const sweep = await sweepStaleRawEvents(h.mem.store, direct(h), new Date('2026-10-12T03:00:00.000Z'))
    expect(sweep.rawRedispatched).toBeGreaterThan(0)
    expect(callOf(h)!.crmStatus).toBe('written')
    expect(tpOf(h)).toHaveLength(1)
  })
  it('队列摘要 / 语音信箱这类事件：留档为 ignored，不建通话不进 CRM', async () => {
    const h = harness()
    await h.send(ev('queue_call_summary', { caller_id: '0210000001' }))
    await h.drain()
    expect([...h.mem.raw.values()][0].status).toBe('ignored')
    expect(h.mem.calls.size).toBe(0)
  })
})

describe('审查后补的防线', () => {
  it('转接：前台那段 completion 先到、静默期内不写 CRM；销售那段到了之后再写，记成有效通话', async () => {
    const h = harness()
    await h.send(inboundStart({ user_number: '101' }))
    await h.send(inboundEnded({ user_number: '101', conversation_duration: 8 }))
    const [first] = await h.drain({ quietMs: 120_000 })
    expect(first!.deferred).toBe(true)
    expect(tpOf(h)).toHaveLength(0)
    await h.send(inboundAnswered({ user_number: '102' }))
    await h.send(inboundEnded({ user_number: '102', conversation_duration: 300 }))
    await h.drain({ quietMs: 0 })
    expect(tpOf(h)).toHaveLength(1)
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'spoke', talkSeconds: 300, staffEmail: 'staff.two@example.test' })
  })
  it('事件自报时间离谱（远未来 / 远古）：不采信，用收到时间，不毒化联系人最近出现时间', async () => {
    const h = harness()
    await h.send(inboundStart({ call_start_at: '2999-01-01T00:00:00.000Z' }))
    await h.send(inboundEnded({ call_start_at: '2999-01-01T00:00:00.000Z' }))
    await h.drain()
    expect(Date.parse(callOf(h)!.startedAt)).toBeLessThan(Date.parse('2027-01-01'))
    expect(Date.parse(tpOf(h)[0].occurredAt)).toBeLessThan(Date.parse('2027-01-01'))
  })
  it('分机名叫 constructor / __proto__：不会取到原型链上的东西', async () => {
    const h = harness()
    await h.send(inboundStart({ user_number: 'constructor' })); await h.send(inboundEnded({ user_number: 'constructor' }))
    await h.drain()
    expect(tpOf(h)[0].staffEmail).toBeNull()
  })
  it('深层嵌套的请求体不会让接收口 500', async () => {
    const h = harness()
    const deep = '['.repeat(100_000) + ']'.repeat(100_000)
    const res = await h.send(`{"unique_call_id":"x","type":"user_inbound_call","z":${deep}}`)
    expect([200, 400]).toContain(res.status)
  })
  it('读请求体：声明超限直接拒；分块超限也在累计时拦住；正常的读得出来', async () => {
    const mk = (len: string | null, body: Uint8Array[] | null) => ({
      headers: { get: (k: string) => (k === 'content-length' ? len : null) },
      body: body ? new ReadableStream<Uint8Array>({ start(c) { body.forEach((b) => c.enqueue(b)); c.close() } }) : null,
    })
    expect(await readCappedBody(mk(String(MAX_BODY_BYTES + 1), null))).toBeNull()
    expect(await readCappedBody(mk(null, [new Uint8Array(MAX_BODY_BYTES), new Uint8Array(10)]))).toBeNull()
    expect(await readCappedBody(mk(null, [new TextEncoder().encode('{"a":1}')]))).toBe('{"a":1}')
  })
  it('来电没人接（voipline inbound 且非 spoke）不算「真人跟进过」；接通了才算；外呼未接仍按原规则算尝试', () => {
    const base = { channel: 'phone', source: 'voipline', occurredAt: '2026-10-12T00:00:00Z' } as const
    expect(isHumanFollowup({ ...base, direction: 'inbound', metadata: { outcome: 'missed_inbound' } } as never)).toBe(false)
    expect(isHumanFollowup({ ...base, direction: 'inbound', metadata: { outcome: 'spoke' } } as never)).toBe(true)
    // 电话系统记录的外呼没人接（answered=false）：PM 2026-10-12 拍板不算跟进；手打笔记（无 answered 字段）仍算
    expect(isHumanFollowup({ ...base, direction: 'outbound', metadata: { outcome: 'no_answer', answered: false } } as never)).toBe(false)
    expect(isHumanFollowup({ ...base, source: 'me_manual', direction: 'outbound', metadata: { outcome: 'no_answer' } } as never)).toBe(true)
    expect(isUnansweredCall({ answered: false })).toBe(true)
    expect(isUnansweredCall({ outcome: 'no_answer' })).toBe(false)
  })
  it('补处理：结束了却一直没写 CRM 的通话会被重新派发；6 小时没收到结束事件的转人工确认', async () => {
    const h = harness()
    await h.send(inboundStart()); await h.send(inboundEnded())
    await h.drain({ quietMs: 120_000 })
    const dispatched: string[] = []
    const r = await sweepStaleRawEvents(h.mem.store, async (id) => { dispatched.push(id) }, new Date('2026-10-12T01:30:00.000Z'))
    expect(r.endedCallsRedispatched).toBe(1)
    const g = harness()
    await g.send(inboundStart()); await g.drain({ quietMs: 0 })
    const r2 = await sweepStaleRawEvents(g.mem.store, async () => undefined, new Date('2026-10-12T09:00:00.000Z'))
    expect(r2.flaggedNoEnd).toBe(1)
    expect(g.mem.calls.get(`${CLIENT_A}|call-1`)).toMatchObject({ crmStatus: 'needs_review' })
  })
  it('写 CRM 的错误文字里的长数字串会被打码', async () => {
    const { safeErr } = await import('../process')
    expect(safeErr(new Error('duplicate key (+64210000001) violates'))).not.toContain('64210000001')
  })
})

describe('魏征审查后补的防线', () => {
  it('来电没人接：outcome=missed_inbound，不记员工，不被当成「我们尝试过」', async () => {
    const h = harness()
    await h.send(inboundStart()); await h.send(inboundEnded({ conversation_duration: 0, connected_at: null }))
    await h.drain()
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'missed_inbound', staffEmail: null, reached: false })
  })
  it('只有结束事件、没带 answered 标志、时长 28 秒（可能是响铃）：不判接通，不算有效联系', async () => {
    const h = harness()
    h.mem.addContact(CLIENT_A, CUSTOMER_E164)
    await h.send(outboundStart())
    await h.send(ev('user_outbound_completed', { dest_number: '0210000001', conversation_duration: 28 }))
    await h.drain()
    // 不判接通；也不断言「没接」：转人工确认，不写触点
    expect(callOf(h)).toMatchObject({ answered: false, crmStatus: 'needs_review' })
    expect(tpOf(h)).toHaveLength(0)
  })
  it('「没人接」类事件名不会被当成接通事件', () => {
    for (const n of ['inbound_call_no_answer', 'call_unanswered', 'outbound_call_busy', 'call_failed']) {
      expect(classifyEventType(n)).toBe('call_ended')
    }
    const r = parseVoiplineEvent({ type: 'outbound_call_no_answer', unique_call_id: 'x', dest_number: '021' })
    expect(r.ok && r.event.answered).toBe(false)
  })
  it('无时区的时间戳不猜（用收到时间）；epoch 秒能读', () => {
    const a = parseVoiplineEvent(inboundStart({ call_start_at: '2026-10-12 09:15:00' }))
    expect(a.ok && a.event.occurredAt).toBeNull()
    const b = parseVoiplineEvent(inboundStart({ call_start_at: 1760230800 }))
    expect(b.ok && b.event.occurredAt).toBe('2025-10-12T01:00:00.000Z')
    const c = parseVoiplineEvent(inboundStart({ call_start_at: '2026-10-12T09:15:00+13:00' }))
    expect(c.ok && c.event.occurredAt).toBe('2026-10-11T20:15:00.000Z')
  })
  it('一次失败只记一次重试次数', async () => {
    const h = harness()
    h.mem.failures.touchpointWrites = 1
    await h.send(inboundStart()); await h.send(inboundEnded())
    const ids = [...h.emitted]
    await expect(processRawEvent(h.mem.store, ids[0], h.now, { quietMs: 0 })).rejects.toThrow()
    expect(h.mem.raw.get(ids[0])!.attempts).toBe(1)
  })
})

describe('第二轮审查后补的防线', () => {
  it('转接间隔很长：前台 15 秒那段先写，销售 10 分钟那段几分钟后才到 → 原触点被更新，不冻结', async () => {
    const h = harness()
    await h.send(inboundStart({ user_number: '101' })); await h.send(inboundAnswered({ user_number: '101' }))
    await h.send(inboundEnded({ user_number: '101', conversation_duration: 15 }))
    await h.drain({ quietMs: 0 })
    expect(tpOf(h)[0]).toMatchObject({ talkSeconds: 15, staffEmail: 'staff.one@example.test' })
    await h.send(inboundAnswered({ user_number: '102' })); await h.send(inboundEnded({ user_number: '102', conversation_duration: 600 }))
    await h.drain({ quietMs: 0 })
    expect(tpOf(h)).toHaveLength(1)
    expect(tpOf(h)[0]).toMatchObject({ talkSeconds: 600, staffEmail: 'staff.two@example.test', outcome: 'spoke' })
    expect(callOf(h)!.receipts.some((r) => r.status === 'updated')).toBe(true)
  })
  it('振铃组：先有人 no_answer，后面另一个分机才接起来 → 触点从漏接更新成已接通', async () => {
    const h = harness()
    await h.send(inboundStart({ user_number: '101' }))
    await h.send(ev('user_inbound_no_answer', { caller_id: '0210000001', user_number: '101' }))
    await h.drain({ quietMs: 0 })
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'missed_inbound' })
    await h.send(inboundAnswered({ user_number: '102' })); await h.send(inboundEnded({ user_number: '102', conversation_duration: 600 }))
    await h.drain({ quietMs: 0 })
    expect(tpOf(h)[0]).toMatchObject({ outcome: 'spoke', talkSeconds: 600 })
  })
  it('没有接通事件、没有 answered 标志、但有 95 秒时长：不断言「没接」，转人工确认', async () => {
    const h = harness()
    await h.send(inboundStart()); await h.send(ev('user_inbound_completed', { caller_id: '0210000001', conversation_duration: 95 }))
    await h.drain()
    expect(callOf(h)).toMatchObject({ crmStatus: 'needs_review', answered: false })
    expect(tpOf(h)).toHaveLength(0)
  })
  it('6 小时被标「没结束」之后结束事件才到：重新处理并写 CRM', async () => {
    const h = harness()
    await h.send(inboundStart()); await h.drain()
    await sweepStaleRawEvents(h.mem.store, async () => undefined, new Date('2026-10-12T09:00:00.000Z'))
    expect(callOf(h)!.crmStatus).toBe('needs_review')
    await h.send(inboundAnswered()); await h.send(inboundEnded()); await h.drain()
    expect(callOf(h)!.crmStatus).toBe('written')
    expect(tpOf(h)).toHaveLength(1)
  })
  it('已结束却一直写不成：补处理重发 5 次后转人工，不无限重发', async () => {
    const h = harness()
    await h.send(inboundStart()); await h.send(inboundEnded()); await h.drain({ quietMs: 120_000 })
    let sent = 0
    for (let i = 0; i < 8; i++) await sweepStaleRawEvents(h.mem.store, async () => { sent++ }, new Date('2026-10-12T02:00:00.000Z'))
    expect(sent).toBe(5)
    expect(callOf(h)!.crmStatus).toBe('needs_review')
  })
  it('连接被停用后，补处理不再重发它的通话', async () => {
    const h = harness([connA({ active: false }), connB()])
    h.mem.calls.set(`${CLIENT_A}|x`, { clientId: CLIENT_A, connectionId: CONN_A, providerCallId: 'x', stage: 'ended', direction: 'inbound', startedAt: '2026-10-12T00:00:00.000Z', crmStatus: 'pending', receipts: [] } as never)
    let sent = 0
    await sweepStaleRawEvents(h.mem.store, async () => { sent++ }, new Date('2026-10-12T02:00:00.000Z'))
    expect(sent).toBe(0)
  })
})
