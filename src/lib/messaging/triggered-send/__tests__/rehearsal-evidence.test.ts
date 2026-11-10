import { describe, expect, it } from 'vitest'
import type { ShadowRowForCompare } from '../compare'
import { TRIGGERED_SEND_SWEEP_JOB } from '@/lib/inngest/functions/triggered-send-welcome-sweep'
import {
  REHEARSAL_DAYS_SHOWN,
  REHEARSAL_SWEEP_JOB,
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
    noLeadDays: new Set(),
    partialDays: new Set(),
    batches: [],
    proposalsCounted: 1,
    timeZone: 'Pacific/Auckland',
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
    // The real sweep of 11-16 proved 11-15 had no new leads (see receiptFacts).
    expect(summarizeRehearsal(input({ rows, noLeadDays: new Set(['2026-11-15']) }))).toMatchObject({ consecutiveDays: 7, runFrom: '2026-11-12' })
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
    const e = summarizeRehearsal(input({ rows: consistentRows('2026-11-18', '2026-11-19'), otherRuleDays: new Set(['2026-11-17']), noLeadDays: new Set(['2026-11-16']) }))
    expect(e.calendar).toHaveLength(REHEARSAL_DAYS_SHOWN)
    expect(e.calendar[0].day).toBe('2026-11-06')
    expect(e.calendar.at(-1)).toMatchObject({ day: '2026-11-19', kind: 'consistent' })
    expect(e.calendar.find((d) => d.day === '2026-11-17')?.kind).toBe('other_rule')
    expect(e.calendar.find((d) => d.day === '2026-11-16')?.kind).toBe('no_leads')
    expect(e.calendar.find((d) => d.day === '2026-11-10')?.kind).toBe('not_compared')
  })

  it('yesterday before this morning\'s sweep is "not yet", not a break; a proposal submitted today is flagged', () => {
    const e = summarizeRehearsal(input({ rows: consistentRows('2026-11-14', '2026-11-18'), switchDays: new Set([TODAY]) }))
    expect(e.calendar.at(-1)).toMatchObject({ day: '2026-11-19', kind: 'not_yet' })
    expect(e).toMatchObject({ consecutiveDays: 5, switchToday: true })
  })

  it('a batch whose leads came in on a switch day is marked: part of its gap is the switch', () => {
    const e = summarizeRehearsal(
      input({
        rows: [row('2026-11-18', {}, { legacy_campaign_ids: ['c1'] })],
        switchDays: new Set(['2026-11-18']),
        batches: [{ campaignId: 'c1', title: 'batch_1119', sentAt: '2026-11-18T19:01:00Z', emailsSent: 5 }],
      }),
    )
    expect(e.batches[0]).toMatchObject({ campaignId: 'c1', gap: 4, partialDay: true })
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

  const receipt = (startedAt: string, over: Record<string, unknown> = {}) => ({
    startedAt,
    status: 'swept',
    dryRun: false,
    authorizationId: 'p1',
    deferred: 0,
    legacyBatches: [] as Array<{ campaignId: string; title: string; sentAt: string | null; emailsSent: number }>,
    ...over,
  })
  const P1_EARLY = new Map([['p1', '2026-10-31T11:00:00.000Z']])

  it('sweep receipts: only these decisions count; old batches are dropped; the latest receipt of a batch wins', () => {
    const facts = receiptFacts(
      [
        receipt('2026-11-17T20:01:00Z', { legacyBatches: [{ campaignId: 'old', title: 't0', sentAt: '2026-10-30T19:00:00Z', emailsSent: 9 }] }),
        receipt('2026-11-18T20:01:00Z', { legacyBatches: [{ campaignId: 'c1', title: 't1', sentAt: '2026-11-18T19:00:00Z', emailsSent: 4 }] }),
        receipt('2026-11-19T20:01:00Z', { authorizationId: 'trial', legacyBatches: [{ campaignId: 'c2', title: 't2', sentAt: '2026-11-19T19:00:00Z', emailsSent: 3 }] }),
        receipt('2026-11-19T22:01:00Z', { legacyBatches: [{ campaignId: 'c1', title: 't1', sentAt: '2026-11-18T19:00:00Z', emailsSent: 5 }] }),
      ],
      P1_EARLY,
      'Pacific/Auckland',
    )
    // Sweeps on NZ 11-18, 11-19 and 11-20 were clean: lead days 11-17, 11-18, 11-19 had no new leads (when no rows).
    expect([...facts.noLeadDays].sort()).toEqual(['2026-11-17', '2026-11-18', '2026-11-19'])
    expect(facts.batches).toEqual([{ campaignId: 'c1', title: 't1', sentAt: '2026-11-18T19:00:00Z', emailsSent: 5 }])
  })

  it('🔴 a dry run proves nothing about a day (it writes no rows); a receipt without the field counts as a dry run', () => {
    const facts = receiptFacts([receipt('2026-11-18T20:01:00Z', { dryRun: true })], P1_EARLY, 'Pacific/Auckland')
    expect(facts.noLeadDays.size + facts.partialDays.size).toBe(0)
    expect(parseSweepReceipt('2026-11-18T20:01:00Z', { status: 'swept', authorization_id: 'p1', deferred: 0 })?.dryRun).toBe(true)
    expect(parseSweepReceipt('2026-11-18T20:01:00Z', { status: 'swept', dry_run: false })?.dryRun).toBe(false)
  })

  it('🔴 a clean sweep of a proposal submitted that morning proves nothing about the day before', () => {
    // Proposal at NZ 11-20 08:00, clean sweep at 09:00: yesterday's leads came before the proposal and were never judged.
    const late = receiptFacts([receipt('2026-11-19T20:01:00Z')], new Map([['p1', '2026-11-19T19:00:00.000Z']]), 'Pacific/Auckland')
    expect(late.noLeadDays.has('2026-11-19')).toBe(false)
    // Submitted at midnight starting 11-19: the whole of 11-19 was judged.
    const midnight = receiptFacts([receipt('2026-11-19T20:01:00Z')], new Map([['p1', '2026-11-18T11:00:00.000Z']]), 'Pacific/Auckland')
    expect(midnight.noLeadDays.has('2026-11-19')).toBe(true)
  })

  it('🔴 a day whose latest real sweep set people aside (or did not finish) was only partly compared', () => {
    const setAside = receiptFacts([receipt('2026-11-18T20:01:00Z', { deferred: 4 })], P1_EARLY, 'Pacific/Auckland')
    expect([...setAside.partialDays]).toEqual(['2026-11-18'])
    // The 11:00 retry finished the job: the latest real sweep of the day is clean.
    const retried = receiptFacts([receipt('2026-11-18T20:01:00Z', { deferred: 4 }), receipt('2026-11-18T22:01:00Z')], P1_EARLY, 'Pacific/Auckland')
    expect(retried.partialDays.size).toBe(0)
    expect(summarizeRehearsal(input({ rows: consistentRows('2026-11-15', '2026-11-19'), partialDays: new Set(['2026-11-18']) })).consecutiveDays).toBe(1)
  })

  it('🔴 yesterday that this morning\'s real sweeps set aside entirely (so no rows) is "not finished": a break, never "not yet"', () => {
    // NZ 11-20 09:00 and 11:00: both real sweeps set everyone aside (say the salespeople's mailboxes could not be read).
    const facts = receiptFacts([receipt('2026-11-19T20:01:00Z', { deferred: 3 }), receipt('2026-11-19T22:01:00Z', { deferred: 3 })], P1_EARLY, 'Pacific/Auckland')
    expect([...facts.partialDays]).toEqual(['2026-11-19'])
    const e = summarizeRehearsal(input({ rows: consistentRows('2026-11-14', '2026-11-18'), partialDays: facts.partialDays }))
    expect(e.calendar.at(-1)).toMatchObject({ day: '2026-11-19', kind: 'partial', stats: null })
    expect(e).toMatchObject({ consecutiveDays: 0, runFrom: null })
    // An older day with no rows that a sweep set aside is "not finished" too (it broke the run before as well).
    const older = summarizeRehearsal(input({ rows: [...consistentRows('2026-11-14', '2026-11-16'), ...consistentRows('2026-11-18', '2026-11-19')], partialDays: new Set(['2026-11-17']) }))
    expect(older.calendar.find((d) => d.day === '2026-11-17')?.kind).toBe('partial')
    expect(older.consecutiveDays).toBe(2)
  })

  it('the run-log job name is the sweep function\'s own (a rename would silently hide every receipt)', () => {
    expect(REHEARSAL_SWEEP_JOB).toBe(TRIGGERED_SEND_SWEEP_JOB)
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
