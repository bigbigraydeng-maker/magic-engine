import { describe, expect, it } from 'vitest'
import { findConnectedCallEvidence, type PhoneTouch } from '@/lib/crm/email-templates/call-evidence'

const HOUR = 3_600_000
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()
const touch = (over: Partial<PhoneTouch>): PhoneTouch => ({
  occurredAt: ago(HOUR),
  source: 'twilio',
  metadata: { reached: true },
  ...over,
})

describe('findConnectedCallEvidence', () => {
  it('finds a system call that reached the guest', () => {
    const at = ago(2 * HOUR)
    expect(findConnectedCallEvidence([touch({ occurredAt: at })], new Date(), 24)).toEqual({ at })
  })

  // The source values are what the telephony writer stores (`source: conn.provider`): 'twilio' is the one production
  // holds today, 'voipline' is the other provider the writer supports.
  it.each(['twilio', 'voipline'])('the telephony provider "%s" is a system call source', (source) => {
    expect(findConnectedCallEvidence([touch({ source })], new Date(), 24)).not.toBeNull()
  })

  it.each(['phone/twilio', 'phone/voipline'])(
    'the "channel/source" kind key "%s" is not a source value: it is how the enquiry rule names a touch, no row stores it',
    (source) => {
      expect(findConnectedCallEvidence([touch({ source })], new Date(), 24)).toBeNull()
    },
  )

  it('reads the three shapes real Twilio call rows have: outbound reached, inbound answered, inbound missed', () => {
    const outbound = touch({ occurredAt: ago(3 * HOUR), metadata: { outcome: 'spoke', reached: true, answered: true, talk_seconds: 52 } })
    const inboundAnswered = touch({ occurredAt: ago(2 * HOUR), metadata: { outcome: 'spoke', reached: false, answered: true, talk_seconds: 31 } })
    const inboundMissed = touch({ occurredAt: ago(HOUR), metadata: { outcome: 'missed_inbound', reached: false, answered: false, talk_seconds: 0 } })
    expect(findConnectedCallEvidence([outbound], new Date(), 24)).toEqual({ at: outbound.occurredAt })
    expect(findConnectedCallEvidence([inboundAnswered], new Date(), 24)).toEqual({ at: inboundAnswered.occurredAt })
    expect(findConnectedCallEvidence([inboundMissed], new Date(), 24)).toBeNull()
  })

  it('also accepts answered with talk time', () => {
    expect(findConnectedCallEvidence([touch({ metadata: { answered: true, talk_seconds: 45 } })], new Date(), 24)).not.toBeNull()
  })

  it('an outcome of "spoke" alone is NOT evidence: it is also the note parser\'s catch-all value', () => {
    expect(findConnectedCallEvidence([touch({ metadata: { outcome: 'spoke' } })], new Date(), 24)).toBeNull()
  })

  it('answered without talk time and unanswered calls are not evidence', () => {
    expect(findConnectedCallEvidence([touch({ metadata: { answered: true, talk_seconds: 0 } })], new Date(), 24)).toBeNull()
    expect(findConnectedCallEvidence([touch({ metadata: { reached: false, outcome: 'no_answer' } })], new Date(), 24)).toBeNull()
    expect(findConnectedCallEvidence([touch({ metadata: null })], new Date(), 24)).toBeNull()
  })

  it('a typed note is never evidence, even when it parsed as spoke (e.g. the bulk "sent a mass email" note)', () => {
    const manual = touch({ source: 'me_manual', metadata: { outcome: 'spoke' } })
    expect(findConnectedCallEvidence([manual], new Date(), 24)).toBeNull()
  })

  it.each([
    ['a spreadsheet follow-up import (parser fallback "spoke", arrival time)', { source: 'sheet_followup', metadata: { outcome: 'spoke', reached: true, time_is_approximate: true } }],
    ['the AI voice agent (automated)', { source: 'voice_agent', metadata: { outcome: 'spoke', reached: true, automated: true } }],
    ['a source nobody listed', { source: 'some_new_dialler', metadata: { reached: true } }],
    ['a touchpoint with no source', { source: null, metadata: { reached: true } }],
  ])('%s is not a staff conversation', (_name, over) => {
    expect(findConnectedCallEvidence([touch(over as Partial<PhoneTouch>)], new Date(), 24)).toBeNull()
  })

  it('a call from the phone system that is flagged automated or approximate is not evidence either', () => {
    expect(findConnectedCallEvidence([touch({ metadata: { reached: true, automated: true } })], new Date(), 24)).toBeNull()
    expect(findConnectedCallEvidence([touch({ metadata: { reached: true, time_is_approximate: true } })], new Date(), 24)).toBeNull()
  })

  it('ignores calls older than the window and picks the most recent one', () => {
    const old = touch({ occurredAt: ago(30 * HOUR) })
    const recent = touch({ occurredAt: ago(3 * HOUR) })
    const newest = touch({ occurredAt: ago(1 * HOUR) })
    expect(findConnectedCallEvidence([old], new Date(), 24)).toBeNull()
    expect(findConnectedCallEvidence([old, recent, newest], new Date(), 24)).toEqual({ at: newest.occurredAt })
  })

  it('the window edge: 23h59m counts, 24h01m does not', () => {
    const inside = touch({ occurredAt: ago(24 * HOUR - 60_000) })
    const outside = touch({ occurredAt: ago(24 * HOUR + 60_000) })
    expect(findConnectedCallEvidence([inside], new Date(), 24)).not.toBeNull()
    expect(findConnectedCallEvidence([outside], new Date(), 24)).toBeNull()
  })

  it('ignores unparsable times and times far in the future', () => {
    expect(findConnectedCallEvidence([touch({ occurredAt: 'not a date' })], new Date(), 24)).toBeNull()
    expect(findConnectedCallEvidence([touch({ occurredAt: new Date(Date.now() + 2 * HOUR).toISOString() })], new Date(), 24)).toBeNull()
  })
})
