import { beforeEach, describe, expect, it } from 'vitest'
import { computeTwilioSignature, verifyTwilioSignature } from '../signature'
import { parseTwilioEvent } from '../events'
import { _clearConnCache, handleTwilioWebhook, parseForm } from '../ingest'
import { createMemoryStore } from '../../voipline/__tests__/memory-store'
import { processRawEvent } from '../../voipline/process'
import type { TelephonyConnection } from '../../voipline/types'

const CLIENT = '33333333-3333-4333-8333-333333333333'
const CONN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ACCOUNT = 'ACtest0000000000000000000000000001'
const SECRET_ENV = 'TWILIO_AUTH_TOKEN_TEST'
const SECRET = 'test-auth-token-value'
const STAFF = '+64210000099'
const BASE = 'https://app.example.test'
const CUSTOMER = '+64210000001'

const conn = (over: Partial<TelephonyConnection> = {}): TelephonyConnection => ({
  id: CONN, clientId: CLIENT, provider: 'twilio', providerAccountId: ACCOUNT, webhookTokenHash: null,
  secretRef: SECRET_ENV, forwardTo: STAFF, defaultCountry: 'NZ', extensionMap: { [STAFF]: 'staff.one@example.test' }, active: true, ...over,
})

beforeEach(() => _clearConnCache())

function rig(c: TelephonyConnection = conn()) {
  const mem = createMemoryStore([c])
  const emitted: string[] = []
  let clock = Date.parse('2026-10-12T01:00:00.000Z')
  const now = () => new Date((clock += 1000))
  const env = (n: string) => (n === SECRET_ENV ? SECRET : undefined)
  return {
    mem, emitted, now,
    async post(kind: string, params: Record<string, string>, o: { sig?: string | null; connectionId?: string; query?: string; signedQuery?: string } = {}) {
      const connectionId = o.connectionId ?? CONN
      const path = `${BASE}/api/webhooks/twilio/${connectionId}/${kind}`
      const url = `${path}${o.query ?? ''}`
      const body = new URLSearchParams(params).toString()
      const signature = o.sig === undefined ? computeTwilioSignature(SECRET, `${path}${o.signedQuery ?? o.query ?? ''}`, parseForm(body) ?? {}) : o.sig
      return handleTwilioWebhook(mem.store, { connectionId, kind, url, baseUrl: BASE, signature, bodyText: body, env, now, emit: async (id) => { emitted.push(id) } })
    },
    async drain() { for (const id of emitted.splice(0)) await processRawEvent(mem.store, id, now, { quietMs: 0 }) },
  }
}

const base = { AccountSid: ACCOUNT, CallSid: 'CA1', Direction: 'inbound', From: CUSTOMER, To: '+6498000000' }
const touchpoints = (r: ReturnType<typeof rig>) => [...r.mem.touchpoints.values()]
const call = (r: ReturnType<typeof rig>) => r.mem.calls.get(`${CLIENT}|CA1`)

describe('Twilio 签名', () => {
  it('官方文档示例向量一致', () => {
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675310', Digits: '1234', From: '+14158675310', To: '+18005551212' }
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2'
    expect(computeTwilioSignature('12345', url, params)).toBe('GvWf1cFY/Q7PnoempGyD5oXAezc=')
    expect(verifyTwilioSignature('12345', url, params, 'GvWf1cFY/Q7PnoempGyD5oXAezc=')).toBe(true)
    expect(verifyTwilioSignature('12345', url, params, 'wrong')).toBe(false)
    expect(verifyTwilioSignature(undefined, url, params, 'GvWf1cFY/Q7PnoempGyD5oXAezc=')).toBe(false)
    expect(verifyTwilioSignature('12345', url, params, null)).toBe(false)
  })
})

describe('Twilio 事件解析', () => {
  it('子通话不进事件；缺 CallSid 不猜', () => {
    expect(parseTwilioEvent('status', { ...base, ParentCallSid: 'CA0', CallStatus: 'completed' }, { forwardTo: STAFF })).toEqual({ ok: false, reason: 'child_leg' })
    expect(parseTwilioEvent('status', { Direction: 'inbound' }, { forwardTo: STAFF })).toEqual({ ok: false, reason: 'missing_call_id' })
  })
  it('dial：completed → 接通 + 通话时长；no-answer → 没接', () => {
    const a = parseTwilioEvent('dial', { ...base, DialCallStatus: 'completed', DialCallDuration: '95' }, { forwardTo: STAFF })
    expect(a.ok && a.event).toMatchObject({ eventType: 'call_ended', answered: true, talkSeconds: 95, extension: STAFF, counterpartyNumber: CUSTOMER })
    const b = parseTwilioEvent('dial', { ...base, DialCallStatus: 'no-answer' }, { forwardTo: STAFF })
    expect(b.ok && b.event).toMatchObject({ answered: false, talkSeconds: 0 })
  })
  it('外呼方向取对方号码 To', () => {
    const r = parseTwilioEvent('status', { ...base, Direction: 'outbound-api', CallStatus: 'ringing', To: CUSTOMER, From: '+6498000000' }, { forwardTo: null })
    expect(r.ok && r.event).toMatchObject({ direction: 'outbound', counterpartyNumber: CUSTOMER })
  })
})

describe('Twilio 接收与整条链路', () => {
  it('来电：回带告知语音、转接、录音的 TwiML，并先落库', async () => {
    const r = rig()
    const res = await r.post('voice', { ...base, CallStatus: 'ringing' })
    expect(res.status).toBe(200)
    expect(res.twiml).toContain('may be recorded')
    expect(res.twiml).toContain(`<Number>${STAFF}</Number>`)
    expect(res.twiml).toContain('record="record-from-answer-dual"')
    expect(res.twiml).toContain('callerId="+6498000000"')
    expect(res.twiml).toContain(`${BASE}/api/webhooks/twilio/${CONN}/dial`)
    expect(r.mem.raw.size).toBe(1)
  })
  it('完整接通：voice → status → dial(95s) → recording → 一条触点、员工正确、录音待下载', async () => {
    const r = rig()
    await r.post('voice', { ...base, CallStatus: 'ringing' })
    await r.post('status', { ...base, CallStatus: 'completed', CallDuration: '120', Timestamp: 'Mon, 12 Oct 2026 01:03:00 +0000' })
    await r.post('dial', { ...base, DialCallStatus: 'completed', DialCallDuration: '95', DialCallSid: 'CA2' })
    await r.post('recording', { AccountSid: ACCOUNT, CallSid: 'CA1', RecordingSid: 'RE1', RecordingUrl: 'https://api.twilio.test/rec/RE1', RecordingStatus: 'completed', RecordingDuration: '95' })
    await r.drain()
    expect(call(r)).toMatchObject({ provider: 'twilio', stage: 'ended', answered: true, talkSeconds: 95, staffEmail: 'staff.one@example.test', crmStatus: 'written', recordingStatus: 'pending_download', recordingRef: 'RE1', learningEligible: false })
    expect(touchpoints(r)).toHaveLength(1)
    expect(touchpoints(r)[0]).toMatchObject({ source: 'twilio', outcome: 'spoke', direction: 'inbound' })
    expect(JSON.stringify(call(r))).not.toContain('api.twilio.test')
  })
  it('没人接（dial no-answer）：记漏接来电，不记员工', async () => {
    const r = rig()
    await r.post('voice', { ...base, CallStatus: 'ringing' })
    await r.post('dial', { ...base, DialCallStatus: 'no-answer' })
    await r.drain()
    expect(touchpoints(r)[0]).toMatchObject({ outcome: 'missed_inbound', staffEmail: null })
  })
  it('父通话 completed 先到、员工那段结果后到：触点被更新成已接通，不重复', async () => {
    const r = rig()
    await r.post('voice', { ...base, CallStatus: 'ringing' })
    await r.post('status', { ...base, CallStatus: 'completed' })
    await r.drain()
    expect(touchpoints(r)[0]).toMatchObject({ outcome: 'missed_inbound' })
    await r.post('dial', { ...base, DialCallStatus: 'completed', DialCallDuration: '60' })
    await r.drain()
    expect(touchpoints(r)).toHaveLength(1)
    expect(touchpoints(r)[0]).toMatchObject({ outcome: 'spoke', talkSeconds: 60, staffEmail: 'staff.one@example.test' })
  })
  it('重复回调：只落一行', async () => {
    const r = rig()
    await r.post('status', { ...base, CallStatus: 'ringing' })
    await r.post('status', { ...base, CallStatus: 'ringing' })
    expect(r.mem.raw.size).toBe(1)
  })
})

describe('Twilio fail-closed', () => {
  it('签名错 / 没签名：401、来电回挂断（不转接不录音）、不落库、留回执', async () => {
    const r = rig()
    const a = await r.post('voice', base, { sig: 'bad' })
    expect(a.status).toBe(401)
    expect(a.twiml).toContain('<Hangup/>')
    expect(a.twiml).not.toContain('<Dial')
    expect((await r.post('voice', base, { sig: null })).status).toBe(401)
    expect(r.mem.raw.size).toBe(0)
    expect(r.mem.rejections.map((x) => x.reason)).toEqual(['bad_signature', 'bad_signature'])
  })
  it('服务器没配令牌：拒绝（不会因为「没配」就放行）', async () => {
    const r = rig(conn({ secretRef: 'NOT_SET_ANYWHERE' }))
    expect((await r.post('status', base)).status).toBe(401)
    expect(r.mem.rejections[0].reason).toBe('secret_not_configured')
  })
  it('账号对不上：拒绝', async () => {
    const r = rig()
    expect((await r.post('status', { ...base, AccountSid: 'ACother' })).status).toBe(401)
    expect(r.mem.rejections[0].reason).toBe('account_mismatch')
  })
  it('不是 Twilio 的连接 / 未知连接 / 非法 kind：拒绝', async () => {
    const r = rig(conn({ provider: 'voipline' }))
    expect((await r.post('status', base)).status).toBe(401)
    const r2 = rig()
    expect((await r2.post('status', base, { connectionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })).status).toBe(401)
    expect((await r2.post('hack', base)).status).toBe(401)
  })
  it('没配转接号码：来电直接挂断，不转接、不录音', async () => {
    const r = rig(conn({ forwardTo: null }))
    const res = await r.post('voice', base)
    expect(res.twiml).toContain('<Hangup/>')
    expect(res.twiml).not.toContain('<Dial')
  })
  it('子通话回调：200 空应答，不落库', async () => {
    const r = rig()
    const res = await r.post('status', { ...base, ParentCallSid: 'CA0', CallStatus: 'completed' })
    expect(res.status).toBe(200)
    expect(r.mem.raw.size).toBe(0)
  })
})

describe('审查后补的防线', () => {
  it('变量名不在 TWILIO_AUTH_TOKEN_ 前缀内：当作没配，拒绝（不会读别的环境变量）', async () => {
    const r = rig(conn({ secretRef: 'SUPABASE_SERVICE_ROLE_KEY' }))
    expect((await r.post('status', base)).status).toBe(401)
    expect(r.mem.rejections[0].reason).toBe('secret_not_configured')
  })
  it('数据库短暂不可用：来电仍验签并转接（用最近一次读到的连接），其余回调才回 503', async () => {
    const r = rig()
    await r.post('voice', base) // 先成功一次，缓存连接
    r.mem.store.getConnection = async () => { throw new Error('db down') }
    r.mem.store.insertRawEvent = async () => { throw new Error('db down') }
    const v = await r.post('voice', { ...base, CallSid: 'CA9' })
    expect(v.status).toBe(200)
    expect(v.twiml).toContain(`<Number>${STAFF}</Number>`)
    expect((await r.post('status', { ...base, CallSid: 'CA9', CallStatus: 'completed' })).status).toBe(503)
  })
  it('数据库不可用且没有缓存：不转接（宁可挂断也不在没验签的情况下转接）', async () => {
    const r = rig()
    r.mem.store.getConnection = async () => { throw new Error('db down') }
    const v = await r.post('voice', base)
    expect(v.status).toBe(503)
    expect(v.twiml).toContain('<Hangup/>')
  })
  it('来电：落库失败也先转接', async () => {
    const r = rig()
    r.mem.store.insertRawEvent = async () => { throw new Error('db down') }
    const v = await r.post('voice', base)
    expect(v.status).toBe(200)
    expect(v.twiml).toContain('<Dial')
  })
})

describe('第二轮审查后补的防线', () => {
  it('员工那段结果（dial）一直没到、只有父通话 completed 且总时长 600 秒：不记漏接，转人工确认', async () => {
    const r = rig()
    await r.post('voice', { ...base, CallStatus: 'ringing' })
    await r.post('status', { ...base, CallStatus: 'completed', CallDuration: '600' })
    await r.drain()
    expect(call(r)).toMatchObject({ crmStatus: 'needs_review' })
    expect(touchpoints(r)).toHaveLength(0)
  })
  it('转人工之后员工那段结果才到：重新处理并写成已接通', async () => {
    const r = rig()
    await r.post('voice', { ...base, CallStatus: 'ringing' })
    await r.post('status', { ...base, CallStatus: 'completed', CallDuration: '600' })
    await r.drain()
    await r.post('dial', { ...base, DialCallStatus: 'completed', DialCallDuration: '580' })
    await r.drain()
    expect(call(r)).toMatchObject({ crmStatus: 'written', talkSeconds: 580 })
    expect(touchpoints(r)[0]).toMatchObject({ outcome: 'spoke' })
  })
  it('父通话 busy/failed/canceled：没接；通话时长不会被父通话总时长撑大', async () => {
    for (const st of ['busy', 'failed', 'canceled']) {
      const r = rig()
      await r.post('status', { ...base, CallStatus: st })
      await r.drain()
      expect(touchpoints(r)[0]).toMatchObject({ outcome: 'missed_inbound' })
    }
    const r = rig()
    await r.post('status', { ...base, CallStatus: 'completed', CallDuration: '700' })
    await r.post('dial', { ...base, DialCallStatus: 'completed', DialCallDuration: '90' })
    await r.drain()
    expect(call(r)).toMatchObject({ talkSeconds: 90 })
  })
  it('外呼方向的回调只留档，不写 CRM', async () => {
    const r = rig()
    await r.post('status', { ...base, Direction: 'outbound-api', To: CUSTOMER, CallStatus: 'completed' })
    await r.drain()
    expect(touchpoints(r)).toHaveLength(0)
  })
  it('同名参数：拒绝（400），不落库', async () => {
    const r = rig()
    const url = `${BASE}/api/webhooks/twilio/${CONN}/status`
    const body = 'CallSid=CA1&CallSid=CA2&AccountSid=' + ACCOUNT
    const res = await handleTwilioWebhook(r.mem.store, { connectionId: CONN, kind: 'status', url, baseUrl: BASE, signature: 'x', bodyText: body, env: () => SECRET, emit: async () => undefined })
    expect(res.status).toBe(400)
    expect(r.mem.raw.size).toBe(0)
  })
  it('同一请求换参数顺序 / 换编码重放：签名仍过，但指纹相同，不会多写一行', async () => {
    const r = rig()
    const p = { ...base, CallStatus: 'ringing' }
    await r.post('status', p)
    const url = `${BASE}/api/webhooks/twilio/${CONN}/status`
    const reordered = 'To=%2B6498000000&CallStatus=ringing&From=%2B64210000001&Direction=inbound&CallSid=CA1&AccountSid=' + ACCOUNT
    const sig = computeTwilioSignature(SECRET, url, parseForm(reordered) ?? {})
    await handleTwilioWebhook(r.mem.store, { connectionId: CONN, kind: 'status', url, baseUrl: BASE, signature: sig, bodyText: reordered, env: (n) => (n === SECRET_ENV ? SECRET : undefined), emit: async () => undefined })
    expect(r.mem.raw.size).toBe(1)
  })
})

describe('公网地址还原', () => {
  const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null })
  it('固定地址优先；转发头取第一个值', async () => {
    const { resolvePublicBase } = await import('../url')
    expect(resolvePublicBase(h({}), 'https://app.example.test/', 'x')).toBe('https://app.example.test')
    expect(resolvePublicBase(h({ 'x-forwarded-host': 'a.example.test, b.example.test', 'x-forwarded-proto': 'https,http' }), undefined, 'x')).toBe('https://a.example.test')
    expect(resolvePublicBase(h({ host: 'h.example.test' }), undefined, 'x')).toBe('https://h.example.test')
  })
})

describe('魏征第二轮补的防线（真实静默期下）', () => {
  it('转人工确认之后员工结果才到：在真实静默期下先推迟、静默期过后补写成已接通', async () => {
    const r = rig()
    await r.post('voice', { ...base, CallStatus: 'ringing' })
    await r.post('status', { ...base, CallStatus: 'completed', CallDuration: '600' })
    await r.drain()
    expect(call(r)).toMatchObject({ crmStatus: 'needs_review' })
    await r.post('dial', { ...base, DialCallStatus: 'completed', DialCallDuration: '580' })
    const id = r.emitted.splice(0)[0]
    let clock = 0
    // 事件刚到：落在静默期内 → 推迟（不丢），状态保持待确认
    const justArrived = await processRawEvent(r.mem.store, id, () => new Date(Date.parse(r.mem.raw.get(id)!.receivedAt) + 1000), { quietMs: 120_000 })
    expect(justArrived?.deferred).toBe(true)
    expect(call(r)).toMatchObject({ crmStatus: 'needs_review' })
    // 静默期过后再处理 → 写成已接通
    clock = Date.parse(r.mem.raw.get(id)!.receivedAt) + 200_000
    await processRawEvent(r.mem.store, id, () => new Date(clock), { quietMs: 120_000 })
    expect(call(r)).toMatchObject({ crmStatus: 'written', talkSeconds: 580 })
    expect(touchpoints(r)).toHaveLength(1)
  })
  it('外呼回调：原始事件类型是 other、已有联系人也不写触点', async () => {
    const r = rig()
    r.mem.addContact(CLIENT, CUSTOMER)
    await r.post('status', { ...base, Direction: 'outbound-api', To: CUSTOMER, CallStatus: 'completed', CallDuration: '40' })
    expect([...r.mem.raw.values()][0].event.eventType).toBe('other')
    await r.drain()
    expect(touchpoints(r)).toHaveLength(0)
  })
})

describe('点击外呼的回调', () => {
  const OUT = { AccountSid: ACCOUNT, CallSid: 'CA1', Direction: 'outbound-api', From: '+6498000000', To: STAFF }
  const CP = `?cp=${encodeURIComponent(CUSTOMER)}`

  it('带验签后的客户号码：进 CRM，对方是客户、员工按分机表认出', async () => {
    const r = rig()
    r.mem.addContact(CLIENT, CUSTOMER)
    await r.post('status', { ...OUT, CallStatus: 'completed', CallDuration: '70' }, { query: CP })
    await r.post('dial', { ...OUT, DialCallStatus: 'completed', DialCallDuration: '40' }, { query: CP })
    await r.drain()
    expect(call(r)).toMatchObject({ direction: 'outbound', counterpartyE164: CUSTOMER, talkSeconds: 40, crmStatus: 'written', staffEmail: 'staff.one@example.test' })
    expect(touchpoints(r)).toHaveLength(1)
  })

  it('客户没接：记成外呼没接通', async () => {
    const r = rig()
    r.mem.addContact(CLIENT, CUSTOMER)
    await r.post('dial', { ...OUT, DialCallStatus: 'no-answer' }, { query: CP })
    await r.drain()
    expect(call(r)).toMatchObject({ direction: 'outbound', answered: false })
  })

  it('客户号码被改过（和签名的地址不一致）→ 401，不落库', async () => {
    const r = rig()
    const res = await r.post('dial', { ...OUT, DialCallStatus: 'completed' }, { query: '?cp=%2B64210000002', signedQuery: CP })
    expect(res.status).toBe(401)
    expect(r.mem.raw.size).toBe(0)
  })

  it('cp 不是合格号码：当没有，外呼回调只留档', async () => {
    const r = rig()
    r.mem.addContact(CLIENT, CUSTOMER)
    await r.post('status', { ...OUT, CallStatus: 'completed' }, { query: '?cp=abc' })
    await r.drain()
    expect(touchpoints(r)).toHaveLength(0)
  })

  it('notice：验签通过回告知语音、不落库；签名错 → 401', async () => {
    const r = rig()
    const ok = await r.post('notice', { ...OUT, CallStatus: 'in-progress' })
    expect(ok.status).toBe(200)
    expect(ok.twiml).toContain('<Say')
    expect(ok.twiml).toContain('may be recorded')
    expect(r.mem.raw.size).toBe(0)
    const bad = await r.post('notice', { ...OUT }, { sig: 'wrong' })
    expect(bad.status).toBe(401)
  })
})
