import { describe, expect, it } from 'vitest'
import type { ShadowRowForCompare } from '../compare'
import { REHEARSAL_REQUIRED_DAYS, decisionFingerprint, matchingProposalIds, summarizeRehearsal } from '../rehearsal-evidence'
import { sendableRule } from './authorization-fakes'

function row(day: string, over: Partial<ShadowRowForCompare> = {}, annotations: Record<string, unknown> = {}): ShadowRowForCompare {
  return {
    contactId: `contact-${day}-${Math.random()}`,
    status: 'shadow',
    reasonCode: null,
    annotations: { gate_contract_version: 1, lead_local_day: day, would_send: true, legacy_welcomed: true, legacy_batch_seen: true, ...annotations },
    ...over,
  }
}

describe('decisionFingerprint', () => {
  it('ignores the send block (how and when), but not who would be welcomed', () => {
    const rehearsalOnly: Record<string, unknown> = { ...sendableRule() }
    delete rehearsalOnly.send
    const withSend = sendableRule()
    expect(decisionFingerprint(withSend)).toBe(decisionFingerprint(rehearsalOnly as never))
    expect(decisionFingerprint(sendableRule({ recipient_allowlist: ['hello@example.com'] }))).not.toBe(decisionFingerprint(withSend))
    expect(decisionFingerprint(sendableRule({ gate_contract_version: 2 }))).not.toBe(decisionFingerprint(withSend))
    expect(decisionFingerprint(sendableRule({ frequency_cap: { max: 1, window_days: 7 } }))).not.toBe(decisionFingerprint(withSend))
  })
})

describe('matchingProposalIds', () => {
  it('counts proposals that decide the same way, never one whose stored rule does not parse', () => {
    const rehearsalOnly: Record<string, unknown> = { ...sendableRule() }
    delete rehearsalOnly.send
    const ids = matchingProposalIds(
      [
        { id: 'old-rehearsal', rule: rehearsalOnly },
        { id: 'trial', rule: sendableRule({ recipient_allowlist: ['hello@example.com'] }) },
        { id: 'broken', rule: { nonsense: true } },
        { id: 'same', rule: sendableRule() },
      ],
      sendableRule(),
    )
    expect(ids).toEqual(['old-rehearsal', 'same'])
  })
})

describe('summarizeRehearsal', () => {
  it('counts back from the latest day; an unexplained difference breaks the run', () => {
    const rows = [
      row('2026-11-01'),
      row('2026-11-02', { reasonCode: 'nope' }, { would_send: false }),
      row('2026-11-03'),
      row('2026-11-04'),
      row('2026-11-05', { reasonCode: 'sales_email_exists' }, { would_send: false }),
    ]
    const evidence = summarizeRehearsal(rows, 1, 1)
    expect(evidence.requiredDays).toBe(REHEARSAL_REQUIRED_DAYS)
    expect(evidence.consecutiveDays).toBe(3)
    expect(evidence.days.map((d) => d.leadLocalDay)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
    expect(evidence.days[1].unexplainedContactIds).toHaveLength(1)
  })

  it('leaves out rows decided by another gate version (contract ④)', () => {
    const rows = [row('2026-11-01'), row('2026-11-02', {}, { gate_contract_version: 2, would_send: false })]
    const evidence = summarizeRehearsal(rows, 1, 1)
    expect(evidence.rowsCounted).toBe(1)
    expect(evidence.consecutiveDays).toBe(1)
  })

  it('no rows = no evidence, never a pass', () => {
    expect(summarizeRehearsal([], 1, 0)).toMatchObject({ consecutiveDays: 0, rowsCounted: 0, days: [] })
  })

  it('lists the latest 14 days only, but counts the whole run', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`2026-10-${String(i + 1).padStart(2, '0')}`))
    const evidence = summarizeRehearsal(rows, 1, 1)
    expect(evidence.days).toHaveLength(14)
    expect(evidence.consecutiveDays).toBe(20)
  })
})
