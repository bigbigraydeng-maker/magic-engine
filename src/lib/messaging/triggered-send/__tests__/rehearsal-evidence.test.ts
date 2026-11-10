import { describe, expect, it } from 'vitest'
import type { ShadowRowForCompare } from '../compare'
import {
  REHEARSAL_DAYS_SHOWN,
  decisionFingerprint,
  matchingProposalIds,
  parseSweepReceipt,
  receiptFacts,
  shiftDay,
  summarizeRehearsal,
  switchDaysOf,
  type RehearsalInput,
} from '../rehearsal-evidence'
import { sendableRule } from './authorization-fakes'

const TODAY = '2026-11-20'
let n = 0

function row(day: string, over: Partial<ShadowRowForCompare> = {}, annotations: Record<string, unknown> = {}): ShadowRowForCompare {
  n += 1
  return {
    contactId: `contact-${n}`,
    status: 'shadow',
    reasonCode: null,
    annotations: { gate_contract_version: 1, lead_local_day: day, would_send: true, legacy_welcomed: true, legacy_batch_seen: true, ...annotations },
    ...over,
  }
}

function days(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d)
  return out
}

function input(over: Partial<RehearsalInput> = {}): RehearsalInput {
  return {
    today: TODAY,
    gateContractVersion: 1,
    rows: [],
    otherRuleDays: new Set(),
    switchDays: new Set(),
    sweptDays: new Set(),
    batches: [],
    proposalsCounted: 1,
    ...over,
  }
}

const consistentRows = (from: string, to: string) => days(from, to).map((d) => row(d))

describe('decisionFingerprint and matchingProposalIds', () => {
  it('ignores the send block (how and when), but not who would be welcomed', () => {
    const rehearsalOnly: Record<string, unknown> = { ...sendableRule() }
    delete rehearsalOnly.send
    const withSend = sendableRule()
    expect(decisionFingerprint(withSend)).toBe(decisionFingerprint(rehearsalOnly as never))
    expect(decisionFingerprint(sendableRule({ recipient_allowlist: ['hello@example.com'] }))).not.toBe(decisionFingerprint(withSend))
    expect(decisionFingerprint(sendableRule({ gate_contract_version: 2 }))).not.toBe(decisionFingerprint(withSend))
  })

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

describe('summarizeRehearsal — calendar days in a row, ending yesterday', () => {
  it('five consistent days ending yesterday count five, with their dates', () => {
    expect(summarizeRehearsal(input({ rows: consistentRows('2026-11-15', '2026-11-19') }))).toMatchObject({
      consecutiveDays: 5,
      runFrom: '2026-11-15',
      runTo: '2026-11-19',
    })
  })

  it('before this morning\'s sweep has compared yesterday, the run may end the day before', () => {
    expect(summarizeRehearsal(input({ rows: consistentRows('2026-11-14', '2026-11-18') }))).toMatchObject({ consecutiveDays: 5, runTo: '2026-11-18' })
  })

  it('🔴 old evidence does not count: five days long ago and nothing since is zero', () => {
    expect(summarizeRehearsal(input({ rows: consistentRows('2026-11-01', '2026-11-05') })).consecutiveDays).toBe(0)
  })

  it('🔴 a day nobody compared breaks the run; a day the sweep shows had no new leads does not', () => {
    const rows = [...consistentRows('2026-11-12', '2026-11-14'), ...consistentRows('2026-11-16', '2026-11-19')]
    expect(summarizeRehearsal(input({ rows })).consecutiveDays).toBe(4)
    // The sweep of 11-16 (deciding 11-15's leads) ran under these decisions with nothing set aside: 11-15 had no leads.
    expect(summarizeRehearsal(input({ rows, sweptDays: new Set(['2026-11-16']) }))).toMatchObject({ consecutiveDays: 7, runFrom: '2026-11-12' })
  })

  it('🔴 a day under another rule (a trial) or a switch day breaks the run', () => {
    const rows = consistentRows('2026-11-10', '2026-11-19')
    expect(summarizeRehearsal(input({ rows, otherRuleDays: new Set(['2026-11-17']) })).consecutiveDays).toBe(2)
    expect(summarizeRehearsal(input({ rows, switchDays: new Set(['2026-11-16']) })).consecutiveDays).toBe(3)
  })

  it('an unexplained difference breaks the run; rows of another gate version are left out', () => {
    const rows = [...consistentRows('2026-11-15', '2026-11-19'), row('2026-11-17', { reasonCode: 'nope' }, { would_send: false })]
    expect(summarizeRehearsal(input({ rows })).consecutiveDays).toBe(2)
    const other = [...consistentRows('2026-11-15', '2026-11-19'), row('2026-11-18', {}, { gate_contract_version: 2, would_send: false })]
    expect(summarizeRehearsal(input({ rows: other }))).toMatchObject({ consecutiveDays: 5, rowsCounted: 5 })
  })

  it('🔴 a row whose lead day cannot be read stops the count altogether', () => {
    const rows = [...consistentRows('2026-11-15', '2026-11-19'), row('unknown')]
    expect(summarizeRehearsal(input({ rows }))).toMatchObject({ consecutiveDays: 0, undatedRows: 1, runFrom: null })
  })

  it('lists the last 14 calendar days, oldest first, with what happened on each', () => {
    const e = summarizeRehearsal(input({ rows: consistentRows('2026-11-18', '2026-11-19'), otherRuleDays: new Set(['2026-11-17']), sweptDays: new Set(['2026-11-17']) }))
    expect(e.calendar).toHaveLength(REHEARSAL_DAYS_SHOWN)
    expect(e.calendar[0].day).toBe('2026-11-06')
    expect(e.calendar.at(-1)).toMatchObject({ day: '2026-11-19', kind: 'consistent' })
    expect(e.calendar.find((d) => d.day === '2026-11-17')?.kind).toBe('other_rule')
    expect(e.calendar.find((d) => d.day === '2026-11-16')?.kind).toBe('no_leads')
    expect(e.calendar.find((d) => d.day === '2026-11-10')?.kind).toBe('not_compared')
  })

  it('batch totals: the old batch\'s recipients against the leads ME matched to it, newest first, gap summed', () => {
    const rows = [row('2026-11-18', {}, { legacy_campaign_ids: ['c1'] }), row('2026-11-18', {}, { legacy_campaign_ids: ['c1'] }), row('2026-11-19', {}, { legacy_campaign_ids: ['c2'] })]
    const e = summarizeRehearsal(
      input({
        rows,
        batches: [
          { campaignId: 'c1', title: 'batch_1119', sentAt: '2026-11-18T19:01:00Z', emailsSent: 5 },
          { campaignId: 'c2', title: 'batch_1120', sentAt: '2026-11-19T19:01:00Z', emailsSent: 1 },
        ],
      }),
    )
    expect(e.batches.map((b) => [b.campaignId, b.matchedContacts, b.gap])).toEqual([['c2', 1, 0], ['c1', 2, 3]])
    expect(e.batchGap).toBe(3)
  })
})

describe('the production facts behind it', () => {
  it('a proposal at local midnight covers the whole day; one later in the day makes it a switch day', () => {
    // 2026-11-01 00:00 New Zealand (UTC+13) and 2026-11-01 14:00 New Zealand.
    expect([...switchDaysOf([{ proposedAt: '2026-10-31T11:00:00.000Z' }], 'Pacific/Auckland')]).toEqual([])
    expect([...switchDaysOf([{ proposedAt: '2026-11-01T01:00:00.000Z' }], 'Pacific/Auckland')]).toEqual(['2026-11-01'])
  })

  it('sweep receipts: only these decisions count, a sweep that set people aside is not a clean day, old batches are dropped', () => {
    const receipts = [
      { startedAt: '2026-11-17T20:01:00Z', status: 'swept', authorizationId: 'p1', deferred: 0, legacyBatches: [{ campaignId: 'old', title: 't0', sentAt: '2026-10-30T19:00:00Z', emailsSent: 9 }] },
      { startedAt: '2026-11-18T20:01:00Z', status: 'swept', authorizationId: 'p1', deferred: 2, legacyBatches: [{ campaignId: 'c1', title: 't1', sentAt: '2026-11-18T19:00:00Z', emailsSent: 4 }] },
      { startedAt: '2026-11-19T20:01:00Z', status: 'swept', authorizationId: 'trial', deferred: 0, legacyBatches: [{ campaignId: 'c2', title: 't2', sentAt: '2026-11-19T19:00:00Z', emailsSent: 3 }] },
      { startedAt: '2026-11-19T22:01:00Z', status: 'swept', authorizationId: 'p1', deferred: 0, legacyBatches: [{ campaignId: 'c1', title: 't1', sentAt: '2026-11-18T19:00:00Z', emailsSent: 5 }] },
    ]
    const facts = receiptFacts(receipts, new Set(['p1']), '2026-10-31T11:00:00.000Z', 'Pacific/Auckland')
    expect([...facts.sweptDays].sort()).toEqual(['2026-11-18', '2026-11-20'])
    expect(facts.batches).toEqual([{ campaignId: 'c1', title: 't1', sentAt: '2026-11-18T19:00:00Z', emailsSent: 5 }])
  })

  it('a receipt it cannot read is left out, never guessed', () => {
    expect(parseSweepReceipt(null, {})).toBeNull()
    expect(parseSweepReceipt('2026-11-19T20:00:00Z', 'nope')).toBeNull()
    expect(parseSweepReceipt('2026-11-19T20:00:00Z', { status: 'swept', legacy_batches: [{ campaignId: 'x' }, 'bad'] })).toMatchObject({
      status: 'swept',
      authorizationId: null,
      deferred: -1,
      legacyBatches: [],
    })
  })
})
