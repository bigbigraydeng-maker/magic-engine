import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TourSalesLine, groupsOfTour } from '../TourSalesLine'
import { CLIENT, DEP_A, DEP_B, TOUR_A, TOUR_B, makeGroup } from '../../../crm/payments/_components/__tests__/payments-fixtures'

function payload(groups: ReturnType<typeof makeGroup>[]) {
  return {
    summary: {
      groups,
      totals: { orders: 0, partySize: 0, partySizeMissing: 0, depositPaid: 0, balancePaid: 0, unsettled: 0, unsettledOverdue: 0, offlineHandled: 0 },
      hiddenGroupCount: 0,
      hiddenOrders: 0,
      hiddenOfflineOnlyGroups: 0,
      notes: { offlineHandledOrders: 0, snoozedOrders: 0, cancelledOrders: 0 },
    },
    hasBookings: true,
    paidWithoutBooking: { total: 0, rows: [] },
    list: { rows: [], page: 1, pageCount: 1, total: 0 },
    today: '2026-10-13',
  }
}

function stub(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })))
}

afterEach(() => vi.unstubAllGlobals())

describe('TourSalesLine', () => {
  it('counts only this tour: other tours and undecided orders are left out', () => {
    const groups = [
      makeGroup({ key: DEP_A, tourId: TOUR_A }),
      makeGroup({ key: DEP_B, tourId: TOUR_B }),
      makeGroup({ key: 'none', kind: 'undecided', tourId: null }),
    ]
    expect(groupsOfTour(groups, TOUR_A).map((g) => g.key)).toEqual([DEP_A])
  })

  it('shows totals and one line per departure, with no money', async () => {
    stub(200, payload([
      makeGroup({ key: DEP_A, tourId: TOUR_A, departOn: '2027-03-19', orders: 6, depositPaid: 5, balancePaid: 2, unsettled: 4 }),
      makeGroup({ key: DEP_B, tourId: TOUR_A, departOn: '2027-05-21', orders: 2, depositPaid: 1, balancePaid: 0, unsettled: 2 }),
      makeGroup({ key: 'other', tourId: TOUR_B, orders: 99 }),
    ]))
    render(<TourSalesLine clientId={CLIENT} tourId={TOUR_A} />)
    await waitFor(() => expect(screen.getByText(/共 8 单/)).toBeTruthy())
    expect(screen.getByText(/定金已收 6 · 尾款已收 2 · 还没收齐 6/)).toBeTruthy()
    expect(screen.getByText(/2027-03-19：6 单/)).toBeTruthy()
    expect(screen.getByText(/2027-05-21：2 单/)).toBeTruthy()
    expect(screen.queryByText(/99/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/\$|NZD|AUD|金额：/)
  })

  it('says so when the tour has no orders', async () => {
    stub(200, payload([makeGroup({ tourId: TOUR_B })]))
    render(<TourSalesLine clientId={CLIENT} tourId={TOUR_A} />)
    await waitFor(() => expect(screen.getByText('这个团还没有订单。')).toBeTruthy())
  })

  it('renders nothing for people who are not on the CRM access list (403)', async () => {
    stub(403, {})
    const { container } = render(<TourSalesLine clientId={CLIENT} tourId={TOUR_A} />)
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })

  it('tells the person when it cannot read, instead of showing zeros', async () => {
    stub(500, {})
    render(<TourSalesLine clientId={CLIENT} tourId={TOUR_A} />)
    await waitFor(() => expect(screen.getByText(/销售情况暂时读不到/)).toBeTruthy())
    expect(screen.queryByText(/共 0 单|还没有订单/)).toBeNull()
  })
})
