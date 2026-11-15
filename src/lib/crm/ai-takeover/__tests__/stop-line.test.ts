import { describe, expect, it } from 'vitest'
import { decideStopLine, NOTE_GRACE_MS, type StaffTouch, type StopLineInput } from '../stop-line'
import type { ReengageTouch } from '@/lib/crm/dnc-reengage'

const SINCE = '2026-11-10T01:00:00.000Z'
const NOW = new Date('2026-11-16T18:00:00.000Z')
const after = (minutes: number): string => new Date(Date.parse(SINCE) + minutes * 60_000).toISOString()

function input(over: Partial<StopLineInput> = {}): StopLineInput {
  return { since: SINCE, now: NOW, hasActiveBooking: null, doNotContact: false, stage: null, inbound: [], outboundPhone: [], ...over }
}
const call = (id: string, at: string, metadata: Record<string, unknown>): StaffTouch => ({ id, channel: 'phone', source: 'twilio', occurredAt: at, metadata })
const note = (id: string, at: string, outcome: string | null): StaffTouch => ({ id, channel: 'phone', source: 'me_manual', occurredAt: at, metadata: outcome === null ? {} : { outcome } })
const inboundEmail = (at: string, body = 'Thanks, which dates are left for the Yangtze tour?'): ReengageTouch => ({
  id: '', source: 'microsoft_mail', channel: 'email', direction: 'inbound', occurredAt: at, outcome: null, flagged: false,
  subject: 'Re: 2027 brochure', body, automated: false, talkSeconds: null,
})

describe('decideStopLine', () => {
  it('nothing happened since takeover-on: keep following up', () => {
    expect(decideStopLine(input())).toBeNull()
  })

  it('a call the analysis says the guest spoke on stops the line, unclear counts too', () => {
    expect(decideStopLine(input({ outboundPhone: [call('c1', after(600), { customer_spoke: 'yes' })] }))).toMatchObject({ rule: 'talked', evidenceRef: 'touch:c1' })
    expect(decideStopLine(input({ outboundPhone: [call('c2', after(600), { customer_spoke: 'unclear' })] }))?.rule).toBe('talked')
  })

  it('voicemail does not count, even when the call lasted long or was logged as spoke', () => {
    expect(decideStopLine(input({ outboundPhone: [call('c1', after(600), { customer_spoke: 'no', outcome: 'spoke', talk_seconds: 107 })] }))).toBeNull()
  })

  it('a rejected analysis falls back to the recorded outcome; no analysis and no outcome proves nothing', () => {
    expect(decideStopLine(input({ outboundPhone: [call('c1', after(600), { customer_spoke: 'yes', call_analysis_review: 'rejected', outcome: 'no_answer' })] }))).toBeNull()
    expect(decideStopLine(input({ outboundPhone: [call('c2', after(600), { outcome: 'spoke' })] }))?.rule).toBe('talked')
    expect(decideStopLine(input({ outboundPhone: [call('c3', after(600), {})] }))).toBeNull()
  })

  it('a staff note counts unless it says no answer / bad number; an unparsed note counts (unsure = talked)', () => {
    expect(decideStopLine(input({ outboundPhone: [note('n1', after(120), 'spoke')] }))?.rule).toBe('talked')
    expect(decideStopLine(input({ outboundPhone: [note('n2', after(120), null)] }))?.rule).toBe('talked')
    expect(decideStopLine(input({ outboundPhone: [note('n3', after(120), 'no_answer'), note('n4', after(130), 'bad_number')] }))).toBeNull()
  })

  it('notes in the first hour after takeover-on describe the call that led to the catalogue and are ignored', () => {
    const justInside = after(NOTE_GRACE_MS / 60_000 - 1)
    expect(decideStopLine(input({ outboundPhone: [note('n1', justInside, 'spoke')] }))).toBeNull()
    // a real call in that hour still counts
    expect(decideStopLine(input({ outboundPhone: [call('c1', justInside, { customer_spoke: 'yes' })] }))?.rule).toBe('talked')
  })

  it('only touches strictly after takeover-on, and not in the future, count', () => {
    expect(decideStopLine(input({ outboundPhone: [call('c1', SINCE, { customer_spoke: 'yes' })] }))).toBeNull()
    expect(decideStopLine(input({ outboundPhone: [call('c2', '2026-11-20T00:00:00.000Z', { customer_spoke: 'yes' })] }))).toBeNull()
  })

  it('the earliest qualifying staff touch is the evidence', () => {
    const d = decideStopLine(input({ outboundPhone: [note('late', after(900), 'spoke'), call('early', after(300), { customer_spoke: 'yes' })] }))
    expect(d?.evidenceRef).toBe('touch:early')
  })

  it('the guest came back by email', () => {
    const d = decideStopLine(input({ inbound: [inboundEmail(after(200))] }))
    expect(d).toMatchObject({ rule: 'came_back', at: after(200) })
    expect(d?.why).toContain('回了邮件')
  })

  it('facts win over judgements, in a fixed order: booked > dnc > stage > came back > talked', () => {
    const all = input({
      hasActiveBooking: { id: 'b1' },
      doNotContact: true,
      stage: { key: 'won', label: '已成交', stopsMarketing: true },
      inbound: [inboundEmail(after(200))],
      outboundPhone: [call('c1', after(100), { customer_spoke: 'yes' })],
    })
    expect(decideStopLine(all)?.rule).toBe('booked')
    expect(decideStopLine({ ...all, hasActiveBooking: null })?.rule).toBe('dnc')
    expect(decideStopLine({ ...all, hasActiveBooking: null, doNotContact: false })).toMatchObject({ rule: 'stage', evidenceRef: 'stage:won' })
    expect(decideStopLine({ ...all, hasActiveBooking: null, doNotContact: false, stage: null })?.rule).toBe('came_back')
  })

  it('only the telephony system\'s own call records are calls; AI voice, imports and automated rows never count', () => {
    const voipline: StaffTouch = { id: 'v1', channel: 'phone', source: 'voipline', occurredAt: after(600), metadata: { customer_spoke: 'yes' } }
    expect(decideStopLine(input({ outboundPhone: [voipline] }))?.rule).toBe('talked')
    const aiVoice: StaffTouch = { id: 'a1', channel: 'phone', source: 'voice', occurredAt: after(600), metadata: { outcome: 'spoke', automated: true } }
    const imported: StaffTouch = { id: 'i1', channel: 'phone', source: 'sheet_import', occurredAt: after(600), metadata: { outcome: 'spoke' } }
    const approx = note('n1', after(600), 'spoke')
    approx.metadata = { outcome: 'spoke', time_is_approximate: true }
    const automatedNote = note('n2', after(600), 'spoke')
    automatedNote.metadata = { outcome: 'spoke', automated: true }
    expect(decideStopLine(input({ outboundPhone: [aiVoice, imported, approx, automatedNote] }))).toBeNull()
  })

  it('the reason says when "talked" rests on the phone system\'s outcome rather than a call analysis', () => {
    expect(decideStopLine(input({ outboundPhone: [call('c1', after(600), { outcome: 'spoke' })] }))?.why).toContain('按电话系统的结果推断')
    expect(decideStopLine(input({ outboundPhone: [call('c2', after(600), { customer_spoke: 'yes' })] }))?.why).toContain('通话分析')
  })

  it('a stage that keeps marketing does not stop the line', () => {
    expect(decideStopLine(input({ stage: { key: 'contacted', label: '已联系', stopsMarketing: false } }))).toBeNull()
  })
})
