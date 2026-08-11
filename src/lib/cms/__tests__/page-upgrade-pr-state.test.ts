import { describe, expect, it } from 'vitest'
import { readPrNumber, resolvePageUpgradePrTransition } from '../page-upgrade-pr-state'

describe('resolvePageUpgradePrTransition', () => {
  it('keeps an open PR outside attribution', () => {
    expect(
      resolvePageUpgradePrTransition(
        { state: 'open', merged: false, mergedAt: null },
        '2026-08-05T00:00:00Z',
      ),
    ).toBeNull()
  })

  it('starts page attribution at the actual merge time', () => {
    expect(
      resolvePageUpgradePrTransition(
        { state: 'closed', merged: true, mergedAt: '2026-08-05T01:02:03Z' },
        '2026-08-05T02:00:00Z',
      ),
    ).toEqual({
      status: 'live',
      occurredAt: '2026-08-05T01:02:03Z',
      expectedMetric: 'seo.gsc.page_clicks',
      expectedDelta: 1,
    })
  })

  it('marks a closed unmerged PR rejected without attribution', () => {
    expect(
      resolvePageUpgradePrTransition(
        { state: 'closed', merged: false, mergedAt: null },
        '2026-08-05T02:00:00Z',
      ),
    ).toEqual({
      status: 'rejected',
      occurredAt: '2026-08-05T02:00:00Z',
      expectedMetric: null,
      expectedDelta: null,
    })
  })

  it('accepts only positive integer PR numbers', () => {
    expect(readPrNumber({ pr_number: 839 })).toBe(839)
    expect(readPrNumber({ pr_number: '839' })).toBeNull()
    expect(readPrNumber({ pr_number: 0 })).toBeNull()
  })
})
