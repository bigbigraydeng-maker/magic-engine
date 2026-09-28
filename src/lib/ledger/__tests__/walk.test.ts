import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '../types'
import { daysBetween, shiftDate, walkLedger } from '../walk'

const today = '2026-09-24'

function mk(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'x',
    title: 'x',
    status: 'decided',
    owner: 'pm',
    decidedOn: '2026-09-20',
    source: 'session:1',
    verifyBy: null,
    verifyHow: '',
    onHold: false,
    doneOn: null,
    doneRef: null,
    verifiedRef: null,
    lastChecked: null,
    checkNote: null,
    body: '',
    ...over,
  }
}

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-09-20', '2026-09-24')).toBe(4)
  })

  it('crosses a month boundary', () => {
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3)
  })
})

describe('shiftDate', () => {
  it('adds days across a month boundary', () => {
    expect(shiftDate('2026-09-24', 7)).toBe('2026-10-01')
  })

  it('adds days within a month', () => {
    expect(shiftDate('2026-08-30', 3)).toBe('2026-09-02')
  })
})

describe('walkLedger', () => {
  it('decided 4 days ago with no verify_by → no findings', () => {
    expect(walkLedger([mk({ decidedOn: '2026-09-20' })], today)).toEqual([])
  })

  it('decided 8 days ago → decided_stale with daysIdle 8', () => {
    const entry = mk({ decidedOn: '2026-09-16' })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'decided_stale', entry, daysIdle: 8 },
    ])
  })

  it('decided 2 days ago with verifyBy in the past → decided_stale', () => {
    const entry = mk({ decidedOn: '2026-09-22', verifyBy: '2026-09-23' })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'decided_stale', entry, daysIdle: 2 },
    ])
  })

  it('decided 8 days ago but onHold → none, indefinite pause never nags', () => {
    const entry = mk({ decidedOn: '2026-09-16', onHold: true })
    expect(walkLedger([entry], today)).toEqual([])
  })

  it('decided with onHold and overdue verifyBy → still none', () => {
    const entry = mk({ decidedOn: '2026-09-16', verifyBy: '2026-09-17', onHold: true })
    expect(walkLedger([entry], today)).toEqual([])
  })

  it('done 2 days ago with no verifyBy → none (derived due date not yet reached)', () => {
    const entry = mk({ status: 'done', doneOn: '2026-09-22' })
    expect(walkLedger([entry], today)).toEqual([])
  })

  it('done, verifyBy null, doneOn 14 days ago, never checked → patrol_missing daysSilent 7', () => {
    const entry = mk({
      status: 'done',
      doneOn: '2026-09-10',
      verifyBy: null,
      lastChecked: null,
    })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'patrol_missing', entry, daysSilent: 7 },
    ])
  })

  it('done, verifyBy null, doneOn 14 days ago, checked yesterday → done_unverified', () => {
    const entry = mk({
      status: 'done',
      doneOn: '2026-09-10',
      verifyBy: null,
      lastChecked: '2026-09-23',
    })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'done_unverified', entry, daysIdle: 14 },
    ])
  })

  it('done, verifyBy null, doneOn 4 days ago (derived due 09-27) → none', () => {
    const entry = mk({
      status: 'done',
      doneOn: '2026-09-20',
      verifyBy: null,
      lastChecked: null,
    })
    expect(walkLedger([entry], today)).toEqual([])
  })

  it('done with verifyBy equal to today → done_unverified', () => {
    const entry = mk({ status: 'done', doneOn: '2026-09-22', verifyBy: today })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'done_unverified', entry, daysIdle: 2 },
    ])
  })

  it('done 9 days ago with no verifyBy → patrol_missing daysSilent 2 (derived due 09-22)', () => {
    const entry = mk({ status: 'done', doneOn: '2026-09-15' })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'patrol_missing', entry, daysSilent: 2 },
    ])
  })

  it('verified → none', () => {
    const entry = mk({ status: 'verified', doneOn: '2026-09-01' })
    expect(walkLedger([entry], today)).toEqual([])
  })

  it('failed → verification_failed', () => {
    const entry = mk({ status: 'failed', doneOn: '2026-09-01' })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'verification_failed', entry },
    ])
  })

  it('done, verifyBy 2 days ago, never checked → patrol_missing daysSilent 2', () => {
    const entry = mk({
      status: 'done',
      doneOn: '2026-09-22',
      verifyBy: '2026-09-22',
      lastChecked: null,
    })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'patrol_missing', entry, daysSilent: 2 },
    ])
  })

  it('done, verifyBy 4 days ago but checked yesterday → done_unverified', () => {
    const entry = mk({
      status: 'done',
      doneOn: '2026-09-20',
      verifyBy: '2026-09-20',
      lastChecked: '2026-09-23',
    })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'done_unverified', entry, daysIdle: 4 },
    ])
  })

  it('done, verifyBy 4 days ago, last checked 3 days ago → patrol_missing daysSilent 3', () => {
    const entry = mk({
      status: 'done',
      doneOn: '2026-09-20',
      verifyBy: '2026-09-20',
      lastChecked: '2026-09-21',
    })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'patrol_missing', entry, daysSilent: 3 },
    ])
  })

  it('done, verifyBy only 1 day ago, never checked → done_unverified', () => {
    const entry = mk({
      status: 'done',
      doneOn: '2026-09-23',
      verifyBy: '2026-09-23',
      lastChecked: null,
    })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'done_unverified', entry, daysIdle: 1 },
    ])
  })

  it('orders failed, then patrol_missing, then done_unverified', () => {
    const done = mk({
      id: 'done',
      status: 'done',
      doneOn: '2026-09-14',
      verifyBy: '2026-09-30',
    })
    const patrol = mk({
      id: 'patrol',
      status: 'done',
      doneOn: '2026-09-20',
      verifyBy: '2026-09-20',
      lastChecked: null,
    })
    const failed = mk({ id: 'failed', status: 'failed' })

    const result = walkLedger([done, patrol, failed], today)

    expect(result.map((f) => f.kind)).toEqual([
      'verification_failed',
      'patrol_missing',
      'done_unverified',
    ])
    expect(result.map((f) => f.entry.id)).toEqual(['failed', 'patrol', 'done'])
  })

  it('orders failed, then decided_stale by daysIdle desc, then done_unverified', () => {
    const done = mk({
      id: 'done',
      status: 'done',
      doneOn: '2026-09-14',
      verifyBy: '2026-09-30',
    })
    const decided10 = mk({ id: 'd10', decidedOn: '2026-09-14' })
    const failed = mk({ id: 'failed', status: 'failed' })
    const decided20 = mk({ id: 'd20', decidedOn: '2026-09-04' })

    const result = walkLedger([done, decided10, failed, decided20], today)

    expect(result.map((f) => f.kind)).toEqual([
      'verification_failed',
      'decided_stale',
      'decided_stale',
      'done_unverified',
    ])
    expect(result.map((f) => f.entry.id)).toEqual([
      'failed',
      'd20',
      'd10',
      'done',
    ])
  })
})
