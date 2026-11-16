import { describe, expect, it } from 'vitest'
import { decideAiPickup, type PickupInput, type PickupTouch } from '../pickup'
import { callReach } from '../call-reach'
import type { ReengageTouch } from '@/lib/crm/dnc-reengage'

const NOW = new Date('2026-11-16T18:45:00.000Z')
const LEAD = '2026-11-12T01:00:00.000Z'
const at = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString()

const call = (minutes: number, metadata: Record<string, unknown>, direction: 'outbound' | 'inbound' = 'outbound'): PickupTouch =>
  ({ channel: 'phone', direction, source: 'twilio', occurredAt: at(LEAD, minutes), metadata })
const voicemail = (m: number) => call(m, { customer_spoke: 'no', outcome: 'spoke', talk_seconds: 36 })
const noAnswer = (m: number) => call(m, { outcome: 'no_answer', talk_seconds: 0 })
const note = (m: number, text = 'please follow up 2027 catalogue'): PickupTouch =>
  ({ channel: 'phone', direction: 'outbound', source: 'me_manual', occurredAt: at(LEAD, m), metadata: { outcome: 'spoke', text } })

function input(touches: PickupTouch[], extra: Partial<PickupInput> = {}): PickupInput {
  return {
    now: NOW, leadAt: LEAD, hasTakeoverHistory: false, eligible: true, hasActiveBooking: false, hasEmail: true,
    qualified: false, newLeadStage: true, callsTrackedSince: '2026-10-12T00:00:00.000Z', reachedBefore: false,
    inbound: [], touches, ...extra,
  }
}

const inboundTouch = (channel: string, source: string, minutes: number, extra: Partial<ReengageTouch> = {}): ReengageTouch => ({
  id: '', source, channel, direction: 'inbound', occurredAt: at(LEAD, minutes), outcome: null, flagged: false,
  subject: null, body: 'Hi, yes please send me more', automated: false, talkSeconds: null, ...extra,
})

describe('callReach：这通电话接没接通客人', () => {
  it('看通话分析：客人开口 / 说不准 = 接通；没开口 = 没接通', () => {
    expect(callReach({ customer_spoke: 'yes' })).toBe('reached')
    expect(callReach({ customer_spoke: 'unclear' })).toBe('reached')
    expect(callReach({ customer_spoke: 'no', outcome: 'spoke', talk_seconds: 40 })).toBe('not_reached')
  })
  it('没分析时看电话系统的结果；说聊上了算接通（留给员工），读不懂的算不知道', () => {
    expect(callReach({ outcome: 'no_answer' })).toBe('not_reached')
    expect(callReach({ outcome: 'missed_inbound' })).toBe('not_reached')
    expect(callReach({ outcome: 'spoke', talk_seconds: 49 })).toBe('reached')
    expect(callReach({})).toBe('unknown')
    expect(callReach({ customer_spoke: 'no', automated: true })).toBe('unknown')
    expect(callReach({ customer_spoke: 'yes', call_analysis_review: 'rejected', outcome: 'no_answer' })).toBe('not_reached')
  })
})

describe('AI 接走：打了没接通', () => {
  it('打了两次都是语音信箱 / 没人接，员工记了「请发目录」→ AI 接走', () => {
    const d = decideAiPickup(input([noAnswer(60), voicemail(120), note(121)]))
    expect(d).toMatchObject({ rule: 'not_reached', leadAt: LEAD })
    expect(d?.why).toContain('打了 2 次')
  })
  it('员工写了「I will follow up」但其实没打通，也交 AI（PM：一律）', () => {
    expect(decideAiPickup(input([voicemail(60), note(61, 'I will follow up Shanghai & beyond')]))?.rule).toBe('not_reached')
  })
  it('员工用自己手机打通了、在笔记里写了聊上了（不是紧跟在没接通的电话后面写的）→ 留给员工', () => {
    expect(decideAiPickup(input([voicemail(60), note(200, 'spoke on her mobile, call back Tuesday')]))).toBeNull()
    // 紧跟在语音信箱后面写的「请发目录」不算
    expect(decideAiPickup(input([voicemail(60), note(62)]))?.rule).toBe('not_reached')
    // 笔记写的是没人接，也不算
    expect(decideAiPickup(input([voicemail(60), { ...note(200, 'no answer again'), metadata: { outcome: 'no_answer' } }]))?.rule).toBe('not_reached')
  })
  it('客人用另一套电话系统（VoIPLine）回拨，没接到也算客人回来 → 留给员工', () => {
    const vl: PickupTouch = { channel: 'phone', direction: 'inbound', source: 'voipline', occurredAt: at(LEAD, 300), metadata: { outcome: 'missed_inbound' } }
    expect(decideAiPickup(input([noAnswer(60), vl]))).toBeNull()
  })
  it('有一通真接通了 → 留给员工', () => {
    expect(decideAiPickup(input([voicemail(60), call(200, { customer_spoke: 'yes', talk_seconds: 202 })]))).toBeNull()
  })
  it('有一通读不懂（没分析、结果不明）→ 留给员工', () => {
    expect(decideAiPickup(input([voicemail(60), call(200, { talk_seconds: 20 })]))).toBeNull()
  })
  it('最后一次打电话还不到 1 小时，等员工今天再试', () => {
    expect(decideAiPickup(input([call(0, { outcome: 'no_answer' })], { now: new Date(Date.parse(LEAD) + 30 * 60_000) }))).toBeNull()
  })
})

describe('AI 接走：7 天没人打', () => {
  it('询价超过 7 天、系统里一条电话和笔记都没有 → AI 接走', () => {
    expect(decideAiPickup(input([], { leadAt: '2026-11-08T01:00:00.000Z' }))?.rule).toBe('never_called')
  })
  it('不到 7 天 → 先等员工打', () => {
    expect(decideAiPickup(input([]))).toBeNull()
  })
  it('员工已经把阶段改了（例如「已联系」），说明在系统外联系过 → 留给员工', () => {
    expect(decideAiPickup(input([], { leadAt: '2026-11-08T01:00:00.000Z', newLeadStage: false }))).toBeNull()
  })
  it('电话接进系统之前进来的，查不到电话不说明没打过 → 留给员工', () => {
    expect(decideAiPickup(input([], { leadAt: '2026-10-01T01:00:00.000Z' }))).toBeNull()
    expect(decideAiPickup(input([], { leadAt: '2026-11-08T01:00:00.000Z', callsTrackedSince: null }))).toBeNull()
  })
  it('有员工笔记但系统里没电话（可能用别的电话打的）→ 留给员工', () => {
    expect(decideAiPickup(input([note(60, 'spoke to her on mobile')], { leadAt: '2026-11-01T01:00:00.000Z' }))).toBeNull()
  })
})

describe('留给员工的情况', () => {
  const tried = [noAnswer(60), voicemail(120)]
  it('客人回拨（接没接到都算）、回邮件、发 WhatsApp → 不接', () => {
    expect(decideAiPickup(input(tried, { inbound: [inboundTouch('phone', 'twilio', 300, { outcome: 'missed_inbound', talkSeconds: 0 })] }))).toBeNull()
    expect(decideAiPickup(input(tried, { inbound: [inboundTouch('email', 'microsoft_mail', 300, { subject: 'Re: your enquiry' })] }))).toBeNull()
    expect(decideAiPickup(input(tried, { inbound: [inboundTouch('whatsapp', 'whatsapp', 300)] }))).toBeNull()
  })
  it('员工发过 WhatsApp / 私信 → 不接', () => {
    const wa: PickupTouch = { channel: 'whatsapp', direction: 'outbound', source: 'whatsapp', occurredAt: at(LEAD, 200), metadata: {} }
    expect(decideAiPickup(input([...tried, wa]))).toBeNull()
  })
  it('这次询价之前跟员工真聊过、又来填表 → 不接（有兴趣的信号）', () => {
    expect(decideAiPickup(input(tried, { reachedBefore: true }))).toBeNull()
  })
  it('员工亲自发过邮件 → 不接；Mailchimp 群发不算', () => {
    const staffMail: PickupTouch = { channel: 'email', direction: 'outbound', source: 'microsoft_mail', occurredAt: at(LEAD, 200), metadata: {} }
    const mailchimp: PickupTouch = { ...staffMail, source: 'mailchimp' }
    expect(decideAiPickup(input([...tried, staffMail]))).toBeNull()
    expect(decideAiPickup(input([...tried, mailchimp]))?.rule).toBe('not_reached')
  })
  it('以前被员工或系统处理过、别再联系 / 阶段不对、已订团、没有邮箱、已报价及以后 → 不接', () => {
    expect(decideAiPickup(input(tried, { hasTakeoverHistory: true }))).toBeNull()
    expect(decideAiPickup(input(tried, { eligible: false }))).toBeNull()
    expect(decideAiPickup(input(tried, { hasActiveBooking: true }))).toBeNull()
    expect(decideAiPickup(input(tried, { hasEmail: false }))).toBeNull()
    expect(decideAiPickup(input(tried, { qualified: true }))).toBeNull()
    expect(decideAiPickup(input(tried, { leadAt: null }))).toBeNull()
  })
  it('只有客人打进来、员工没打出去 → 不接', () => {
    expect(decideAiPickup(input([call(60, { outcome: 'missed_inbound' }, 'inbound')]))).toBeNull()
  })
})
