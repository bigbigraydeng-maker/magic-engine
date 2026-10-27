import { describe, expect, it } from 'vitest'
import { findConnectedCallEvidence, type PhoneTouch } from '@/lib/crm/email-templates/call-evidence'

const HOUR = 3_600_000
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()
const touch = (over: Partial<PhoneTouch>): PhoneTouch => ({
  occurredAt: ago(HOUR),
  source: 'voipline',
  metadata: { reached: true },
  ...over,
})

describe('findConnectedCallEvidence', () => {
  it('finds a system call that reached the guest', () => {
    const at = ago(2 * HOUR)
    expect(findConnectedCallEvidence([touch({ occurredAt: at })], new Date(), 24)).toEqual({ at })
  })

  it('also accepts answered with talk time, and a system outcome spoke', () => {
    expect(findConnectedCallEvidence([touch({ metadata: { answered: true, talk_seconds: 45 } })], new Date(), 24)).not.toBeNull()
    expect(findConnectedCallEvidence([touch({ metadata: { outcome: 'spoke' } })], new Date(), 24)).not.toBeNull()
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
