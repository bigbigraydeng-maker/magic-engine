import { describe, expect, it } from 'vitest'
import { selectOverviewListPage, toOverviewListRows } from '../booking-overview-list'
import { buildOverviewEntries } from '../booking-overview'
import { TODAY, depId, factsOf, itemOf } from './booking-overview-fixtures'
import { TEST_RULE } from './booking-fixtures'

const FACTS = factsOf([{ id: depId(1), departOn: '2027-03-19' }])

function rowsFor(over: { isCruise?: boolean; durationText?: string; snapshot?: string }) {
  const item = itemOf({ n: 1, departureId: depId(1), snapshot: over.snapshot, deposit: {}, balance: {} })
  const booking = { ...item.booking, isCruise: over.isCruise ?? false }
  const facts = over.durationText
    ? {
        ...FACTS,
        tours: new Map(
          [...FACTS.tours].map(([id, t]) => [id, { ...t, durationText: over.durationText as string }]),
        ),
      }
    : FACTS
  const entries = buildOverviewEntries([{ ...item, booking }], facts, TEST_RULE, TODAY)
  const page = selectOverviewListPage(entries, { status: 'all', page: 1 }, TODAY)
  return toOverviewListRows(page.entries, new Map())
}

const leadTexts = (rows: ReturnType<typeof rowsFor>) =>
  rows.flatMap((r) => r.warnings).filter((w) => /尾款按出发前/.test(w.text)).map((w) => w.text)

describe('list rows: lead-time note only when it is not the default (D1)', () => {
  it('drops the default 「没勾邮轮」 lead-time note', () => {
    expect(leadTexts(rowsFor({}))).toEqual([])
  })

  it('keeps the note for a ticked cruise', () => {
    const texts = leadTexts(rowsFor({ isCruise: true }))
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('（邮轮）')
  })

  it('keeps the note for a long tour (longer lead time)', () => {
    const texts = leadTexts(rowsFor({ durationText: '17 Days 16 Nights' }))
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('天以上')
  })

  it('keeps the other warnings of a row', () => {
    const codes = rowsFor({ snapshot: '2027-03-18' })[0]?.warnings.map((w) => w.code)
    expect(codes).toContain('departure_changed')
    expect(codes).not.toContain('cruise_not_ticked')
  })
})
