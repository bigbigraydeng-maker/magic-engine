import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '../types'
import { daysBetween, walkLedger } from '../walk'

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
    doneOn: null,
    doneRef: null,
    verifiedRef: null,
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

  it('done 2 days ago with no verifyBy → none', () => {
    const entry = mk({ status: 'done', doneOn: '2026-09-22' })
    expect(walkLedger([entry], today)).toEqual([])
  })

  it('done with verifyBy equal to today → done_unverified', () => {
    const entry = mk({ status: 'done', doneOn: '2026-09-22', verifyBy: today })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'done_unverified', entry, daysIdle: 2 },
    ])
  })

  it('done 9 days ago → done_unverified with daysIdle 9', () => {
    const entry = mk({ status: 'done', doneOn: '2026-09-15' })
    expect(walkLedger([entry], today)).toEqual([
      { kind: 'done_unverified', entry, daysIdle: 9 },
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

  it('orders failed, then decided_stale by daysIdle desc, then done_unverified', () => {
    const done = mk({ id: 'done', status: 'done', doneOn: '2026-09-14' })
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
