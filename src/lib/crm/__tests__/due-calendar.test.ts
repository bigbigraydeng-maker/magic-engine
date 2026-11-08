import { describe, expect, it } from 'vitest'
import { callbackItems, isValidMonth, ledgerDueItems, nzDateOf, sortDueItems } from '../due-calendar'
import type { LedgerEntry } from '@/lib/ledger/types'

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: '2026-11-01-x', title: 't', status: 'decided', owner: 'pm', decidedOn: '2026-11-01',
  source: 'session:a', verifyBy: '2026-11-04', verifyHow: 'h', doneOn: null, doneRef: null,
  verifiedRef: null, lastChecked: null, checkNote: null, body: '', ...over,
})

describe('due-calendar', () => {
  it('converts to the New Zealand date (UTC late evening is already the next day)', () => {
    expect(nzDateOf('2026-11-03T20:00:00Z')).toBe('2026-11-04')
  })
  it('validates month strings', () => {
    expect(isValidMonth('2026-11')).toBe(true)
    expect(isValidMonth('2026-13')).toBe(false)
    expect(isValidMonth(null)).toBe(false)
  })
  it('only schedules ledger cards that still need checking, within the month', () => {
    const items = ledgerDueItems(
      [entry({}), entry({ id: 'b', status: 'verified' }), entry({ id: 'c', verifyBy: '2026-12-01' }), entry({ id: 'd', verifyBy: null }), entry({ id: 'e', status: 'done' })],
      '2026-11',
    )
    expect(items.map((i) => i.refId)).toEqual(['2026-11-01-x', 'e'])
  })
  it('uses the latest callback per contact and skips do-not-contact', () => {
    const contacts = [
      { id: 'c1', display_name: 'Ann', primary_phone: '+64', do_not_contact: false },
      { id: 'c2', display_name: 'Bob', primary_phone: null, do_not_contact: true },
    ]
    const touches = [
      { contact_id: 'c1', occurred_at: '2026-11-01T00:00:00Z', metadata: { callback_at: '2026-11-05T21:00:00Z' } },
      { contact_id: 'c1', occurred_at: '2026-11-02T00:00:00Z', metadata: { callback_at: '2026-11-09T21:00:00Z' } },
      { contact_id: 'c2', occurred_at: '2026-11-01T00:00:00Z', metadata: { callback_at: '2026-11-05T21:00:00Z' } },
      { contact_id: 'c1', occurred_at: '2026-11-03T00:00:00Z', metadata: {} },
    ]
    const items = callbackItems(touches, contacts, '2026-11')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ title: 'Ann', date: '2026-11-10', time: '10:00' })
  })
  it('sorts by date then time, untimed last', () => {
    const base = { kind: 'verify' as const, title: '', refId: '', phone: null, status: null }
    const sorted = sortDueItems([
      { ...base, date: '2026-11-02', time: null },
      { ...base, date: '2026-11-02', time: '09:00' },
      { ...base, date: '2026-11-01', time: null },
    ])
    expect(sorted.map((i) => `${i.date}${i.time ?? ''}`)).toEqual(['2026-11-01', '2026-11-0209:00', '2026-11-02'])
  })
})
