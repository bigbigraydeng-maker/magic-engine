import { describe, expect, it } from 'vitest'

import type { OverviewGroup, OverviewMilestoneCell } from '@/lib/crm/booking-overview-types'
import {
  NO_DEPARTURE,
  STATUS_OPTIONS,
  parsePaymentsQuery,
  toSearchString,
  withChange,
  type PaymentsQuery,
} from '../payments-query'
import {
  groupTitle,
  milestoneCellText,
  stageText,
  unitLabel,
  unsettledText,
  warningText,
} from '../payments-format'

/** A tiny ParamReader over a plain record, mirroring URLSearchParams.get. */
function reader(params: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => (name in params ? params[name] : null) }
}

const DEFAULT_QUERY: PaymentsQuery = {
  departureId: null,
  tourId: null,
  status: 'all',
  page: 1,
  includePastPaid: false,
}

function sortedEntries(search: string): Array<[string, string]> {
  return [...new URLSearchParams(search).entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )
}

describe('parsePaymentsQuery', () => {
  it('returns defaults for empty params', () => {
    expect(parsePaymentsQuery(reader({}))).toEqual(DEFAULT_QUERY)
  })

  it('reads a full query', () => {
    const parsed = parsePaymentsQuery(
      reader({
        departureId: 'd',
        tourId: 't',
        status: 'settled',
        page: '3',
        includePastPaid: 'true',
      }),
    )
    expect(parsed).toEqual({
      departureId: 'd',
      tourId: 't',
      status: 'settled',
      page: 3,
      includePastPaid: true,
    })
  })

  it('treats includePastPaid=1 as true and =false as false', () => {
    expect(parsePaymentsQuery(reader({ includePastPaid: '1' })).includePastPaid).toBe(true)
    expect(parsePaymentsQuery(reader({ includePastPaid: 'false' })).includePastPaid).toBe(false)
  })

  it('is forgiving of malformed values', () => {
    expect(parsePaymentsQuery(reader({ status: 'bogus' })).status).toBe('all')
    for (const page of ['0', '-2', 'abc', '1.5']) {
      expect(parsePaymentsQuery(reader({ page })).page).toBe(1)
    }
    expect(parsePaymentsQuery(reader({ departureId: '' })).departureId).toBeNull()
  })
})

describe('toSearchString', () => {
  it('omits defaults', () => {
    expect(toSearchString(DEFAULT_QUERY)).toBe('')
  })

  it('round-trips a full query', () => {
    const full: PaymentsQuery = {
      departureId: 'd',
      tourId: 't',
      status: 'settled',
      page: 3,
      includePastPaid: true,
    }
    const search = toSearchString(full)
    expect(sortedEntries(search)).toEqual(sortedEntries(toSearchString(parsePaymentsQuery(reader({
      departureId: 'd',
      tourId: 't',
      status: 'settled',
      page: '3',
      includePastPaid: 'true',
    })))))
  })
})

describe('withChange', () => {
  const base: PaymentsQuery = {
    departureId: 'd',
    tourId: 't',
    status: 'unsettled',
    page: 4,
    includePastPaid: true,
  }

  it('resets page to 1 when a filter changes', () => {
    expect(withChange(base, { status: 'settled' }).page).toBe(1)
    expect(withChange(base, { tourId: 'other' }).page).toBe(1)
    expect(withChange(base, { departureId: null }).page).toBe(1)
    expect(withChange(base, { includePastPaid: false }).page).toBe(1)
  })

  it('keeps other fields and sets the page when only page changes', () => {
    const next = withChange(base, { page: 7 })
    expect(next).toEqual({ ...base, page: 7 })
  })
})

describe('payments-format wording', () => {
  it('formats unit and unsettled counts', () => {
    expect(unitLabel(3)).toBe('3单')
    expect(unsettledText(4, 1)).toBe('4单（1单已过期）')
    expect(unsettledText(4, 0)).toBe('4单')
  })

  it('formats milestone cells', () => {
    const today = '2026-10-12'
    const paid: OverviewMilestoneCell = {
      kind: 'deposit',
      label: '定金',
      state: 'paid',
      paidOn: '2026-10-08',
      dueOn: null,
      dueNote: null,
      overdue: false,
      quiet: false,
    }
    expect(milestoneCellText(paid, today)).toBe('✅ 10月08日')

    const upcoming: OverviewMilestoneCell = {
      kind: 'balance',
      label: '尾款',
      state: 'unpaid',
      paidOn: null,
      dueOn: '2026-12-19',
      dueNote: null,
      overdue: false,
      quiet: false,
    }
    expect(milestoneCellText(upcoming, today)).toBe('⬜ 到期 12月19日')

    const overdue: OverviewMilestoneCell = {
      kind: 'balance',
      label: '尾款',
      state: 'unpaid',
      paidOn: null,
      dueOn: '2026-10-09',
      dueNote: null,
      overdue: true,
      quiet: false,
    }
    expect(milestoneCellText(overdue, today)).toBe('⬜ 已过期3天')

    const noDue: OverviewMilestoneCell = {
      kind: 'balance',
      label: '尾款',
      state: 'unpaid',
      paidOn: null,
      dueOn: null,
      dueNote: '出发日期未定',
      overdue: false,
      quiet: false,
    }
    expect(milestoneCellText(noDue, today)).toBe('⬜ 出发日期未定')

    const quiet: OverviewMilestoneCell = {
      kind: 'balance',
      label: '尾款',
      state: 'unpaid',
      paidOn: null,
      dueOn: '2026-12-19',
      dueNote: null,
      overdue: false,
      quiet: true,
    }
    expect(milestoneCellText(quiet, today).endsWith(' · 线下已处理')).toBe(true)

    expect(milestoneCellText(null, today)).toBe('—')
  })

  it('formats group titles', () => {
    const base: OverviewGroup = {
      key: 'k',
      kind: 'departure',
      tourId: 't',
      tourName: '云南团',
      departureId: 'd',
      departOn: '2027-03-19',
      departed: false,
      orders: 0,
      partySize: 0,
      partySizeMissing: 0,
      depositPaid: 0,
      balancePaid: 0,
      fullyPaid: 0,
      unsettled: 0,
      unsettledOverdue: 0,
      offlineHandled: 0,
      nearestDueOn: null,
      unpaidItems: 0,
      openItems: 0,
      dateAmbiguous: false,
      warningCodes: [],
    }

    expect(groupTitle({ ...base, kind: 'undecided', key: 'none' })).toEqual({
      tour: '出发日期还没定',
      date: '',
    })
    expect(groupTitle({ ...base, kind: 'unknown_date' }).date).toBe('日期不明的出发')
    expect(groupTitle({ ...base, tourName: null }).tour).toBe('（团目录里已找不到这个团）')
    expect(groupTitle(base).date).toBe('2027-03-19 出发')
  })

  it('maps warning and stage codes', () => {
    expect(warningText('departure_changed')).toBe('出发日变了，请确认')
    expect(warningText('pay_in_full')).toBeNull()
    expect(stageText('deposit_paid')).toBe('已付定金')
    expect(stageText('paid_full')).toBe('已付全款')
    expect(stageText('traveling_soon')).toBe('即将出行')
    expect(stageText('something_else')).toBe('已付款')
  })

  it('exposes the status options and the no-departure sentinel', () => {
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual(['all', 'unsettled', 'settled', 'offline', 'cancelled'])
    expect(NO_DEPARTURE).toBe('none')
  })
})
