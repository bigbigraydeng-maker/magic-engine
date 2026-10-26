import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { BookingsBlock } from '../BookingsBlock'
import { BookingsErrorBoundary } from '../BookingsErrorBoundary'
import { nzToday } from '../booking-format'
import {
  BOOKING_ID,
  BOOKING_UPDATED_AT,
  CLIENT,
  CONTACT,
  DEP_ID,
  DEPOSIT_UPDATED_AT,
  TOUR_ID,
  installFetch,
  jsonResponse,
  makeBooking,
  makeMilestone,
  makeWarning,
  route,
  type FetchCall,
  type FetchRoute,
} from './booking-test-data'

const SECOND_CONTACT = 'c1a1a1a1-0000-4000-8000-000000000099'

const TOURS = [
  {
    id: TOUR_ID,
    name: '新西兰南北岛',
    durationText: '15 Days',
    departures: [
      { id: DEP_ID, departOn: '2027-03-12', returnOn: '2027-03-26', status: 'open' },
    ],
  },
]

/** Renders the block with a mutable bookings list and returns the fetch calls. */
async function setup(
  bookings: ReturnType<typeof makeBooking>[],
  extraRoutes: FetchRoute[] = [],
): Promise<{ calls: FetchCall[] }> {
  const current = bookings
  const { calls } = installFetch([
    ...extraRoutes,
    route('GET', '/crm/bookings?contactId=', () => jsonResponse({ bookings: current })),
    {
      match: (_url, method) => method !== 'GET',
      respond: () => jsonResponse({ ok: true, needsRefresh: true }),
    },
  ])
  render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)
  await screen.findByTestId('booking-card')
  return { calls }
}

/** Non-GET calls whose url ends with the given suffix. */
function postsTo(calls: FetchCall[], suffix: string): FetchCall[] {
  return calls.filter((c) => c.method !== 'GET' && c.url.endsWith(suffix))
}

function getCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.method === 'GET')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BookingsBlock round3 cancelled card', () => {
  it('shows no payment rows for a cancelled booking', async () => {
    const booking = makeBooking({ status: 'cancelled', cancelNote: 'x' })
    await setup([booking])

    const card = screen.getByTestId('booking-card')
    expect(within(card).getByText('已取消')).toBeTruthy()
    expect(within(card).getByText('原因：x')).toBeTruthy()

    expect(screen.queryByTestId('payment-deposit')).toBeNull()
    expect(screen.queryByTestId('payment-balance')).toBeNull()

    const text = card.textContent ?? ''
    expect(text).not.toContain('到期')
    expect(text).not.toContain('定金')
    expect(text).not.toContain('尾款')

    expect(within(card).getByText(/新西兰南北岛/)).toBeTruthy()
    expect(within(card).getByText(/2027-03-12/)).toBeTruthy()
  })
})

describe('BookingsBlock round3 cancel form', () => {
  it('places the warning sentence before the confirm button', async () => {
    await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '取消订单' }))
    const panel = await screen.findByRole('group', { name: '取消订单' })

    const sentence = within(panel).getByText(/取消后不能恢复/)
    const confirm = within(panel).getByRole('button', { name: '确认取消订单' })

    const position = sentence.compareDocumentPosition(confirm)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('BookingsBlock round3 paid wording', () => {
  it('shows the paid date and keeps the unpaid button', async () => {
    const booking = makeBooking({
      milestones: [
        makeMilestone('deposit', { state: 'paid', paidOn: '2026-10-08' }),
        makeMilestone('balance'),
      ],
    })
    await setup([booking])

    expect(screen.getByText('✅ 已收 2026-10-08')).toBeTruthy()
    expect(screen.queryByText(/已收到款 2026/)).toBeNull()
    expect(screen.getByRole('button', { name: '尾款已收到款' })).toBeTruthy()
  })
})

describe('BookingsBlock round3 fully paid', () => {
  it('hides the lead note when both milestones are paid', async () => {
    const booking = makeBooking({
      milestones: [
        makeMilestone('deposit', { state: 'paid', paidOn: '2026-10-08' }),
        makeMilestone('balance', { state: 'paid', paidOn: '2026-10-09' }),
      ],
      warnings: [
        makeWarning('cruise_not_ticked', '尾款按出发前 90 天算（没勾邮轮）'),
      ],
    })
    await setup([booking])

    expect(screen.getByText('已付清')).toBeTruthy()
    expect(screen.queryByText('尾款按出发前 90 天算（没勾邮轮）')).toBeNull()
  })

  it('shows the lead note when only the deposit is paid', async () => {
    const booking = makeBooking({
      milestones: [
        makeMilestone('deposit', { state: 'paid', paidOn: '2026-10-08' }),
        makeMilestone('balance'),
      ],
      warnings: [
        makeWarning('cruise_not_ticked', '尾款按出发前 90 天算（没勾邮轮）'),
      ],
    })
    await setup([booking])

    expect(screen.queryByText('已付清')).toBeNull()
    expect(screen.getByText('尾款按出发前 90 天算（没勾邮轮）')).toBeTruthy()
  })
})

describe('BookingsBlock round3 departure warnings', () => {
  it('shows the departure_missing warning text as given', async () => {
    const text =
      '团目录里已找不到这个出发日期（原为 2027-03-12），请点「改团/出发日期」重新选'
    const booking = makeBooking({
      warnings: [makeWarning('departure_missing', text)],
    })
    await setup([booking])

    expect(screen.getByText(text)).toBeTruthy()
  })

  it('shows the departure_not_set warning once and the balance due note', async () => {
    const text = '出发日期还没定，补上才有到期日'
    const booking = makeBooking({
      departureId: null,
      departOn: null,
      warnings: [makeWarning('departure_not_set', text)],
      milestones: [
        makeMilestone('deposit'),
        makeMilestone('balance', { dueOn: null, dueNote: '出发日期未定' }),
      ],
    })
    await setup([booking])

    expect(screen.getAllByText(text)).toHaveLength(1)
    const balanceRow = screen.getByTestId('payment-balance')
    expect(within(balanceRow).getByText(/出发日期未定/)).toBeTruthy()
  })
})

describe('BookingsBlock round3 paid date guard', () => {
  it('blocks a future paid date', async () => {
    const { calls } = await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    const dateInput = within(panel).getByLabelText('收款日期') as HTMLInputElement
    expect(dateInput.getAttribute('max')).toBe(nzToday())

    fireEvent.change(dateInput, { target: { value: '2999-01-01' } })
    const confirm = within(panel).getByRole('button', { name: '确认已收到款' })
    expect(confirm).toBeDisabled()

    fireEvent.click(confirm)
    expect(postsTo(calls, '/milestones/deposit/paid')).toHaveLength(0)
  })
})

describe('BookingsBlock round3 double click', () => {
  it('sends only one paid request on a double click', async () => {
    const { calls } = await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    const confirm = within(panel).getByRole('button', { name: '确认已收到款' })

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(postsTo(calls, '/milestones/deposit/paid')).toHaveLength(1)
    })
  })
})

describe('BookingsBlock round3 write errors', () => {
  it('handles booking_not_active on a write', async () => {
    const { calls } = await setup([makeBooking()], [
      route('POST', '/milestones/deposit/paid', () =>
        jsonResponse({ error: 'booking_not_active' }, 409),
      ),
    ])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    expect(await screen.findByText('这张订单刚刚有变化，已为你刷新')).toBeTruthy()
    expect(screen.queryByText('booking_not_active')).toBeNull()
    await waitFor(() => {
      expect(getCalls(calls).length).toBeGreaterThanOrEqual(2)
    })
  })

  it('handles not_found on a write', async () => {
    const { calls } = await setup([makeBooking()], [
      route('POST', '/milestones/deposit/paid', () =>
        jsonResponse({ error: 'not_found' }, 404),
      ),
    ])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    expect(await screen.findByText('这张订单刚刚有变化，已为你刷新')).toBeTruthy()
    expect(screen.queryByText('not_found')).toBeNull()
    await waitFor(() => {
      expect(getCalls(calls).length).toBeGreaterThanOrEqual(2)
    })
  })

  it('still shows the stale message for a stale conflict', async () => {
    await setup([makeBooking()], [
      route('POST', '/milestones/deposit/paid', () => jsonResponse({ error: 'stale' }, 409)),
    ])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    expect(await screen.findByText('别人刚改过，已为你刷新')).toBeTruthy()
  })
})

describe('BookingsBlock round3 refetch failure', () => {
  it('tells the user the save worked but the refresh did not', async () => {
    let listCalls = 0
    await setup([makeBooking()], [
      route('POST', '/milestones/deposit/paid', () => jsonResponse({ ok: true })),
      {
        match: (url, method) => method === 'GET' && url.includes('/crm/bookings?contactId='),
        respond: () => {
          listCalls += 1
          if (listCalls === 1) return jsonResponse({ bookings: [makeBooking()] })
          return jsonResponse({ error: 'boom' }, 500)
        },
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '确认已收到款' }))

    expect(await screen.findByText('已保存，刷新没成功，请手动刷新')).toBeTruthy()
    expect(screen.queryByText('没有成功，请稍后再试')).toBeNull()
  })
})

describe('BookingsBlock round3 malformed data', () => {
  it('shows an alert when the tour options are malformed', async () => {
    await setup([makeBooking()], [
      route('GET', '/bookings/options', () => jsonResponse({ tours: 'oops' })),
    ])

    fireEvent.click(screen.getByRole('button', { name: '＋ 加订单' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('读不到团目录，请稍后再试')
  })

  it('renders only the good card when one booking has no milestones', async () => {
    const good = makeBooking()
    const broken = { id: 'x' } as ReturnType<typeof makeBooking>
    await setup([broken, good])

    expect(screen.getAllByTestId('booking-card')).toHaveLength(1)
    expect(screen.getByText(/新西兰南北岛/)).toBeTruthy()
  })

  it('renders nothing for a 200 response with an unexpected body', async () => {
    installFetch([
      route('GET', '/crm/bookings?contactId=', () => jsonResponse({ foo: 1 })),
    ])
    render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)

    await waitFor(() => {
      expect(screen.queryByTestId('bookings-block')).toBeNull()
    })
    expect(screen.queryByTestId('booking-card')).toBeNull()
  })

  it('renders nothing when a child throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom(): JSX.Element {
      throw new Error('boom')
    }
    const { container } = render(
      <BookingsErrorBoundary>
        <Boom />
      </BookingsErrorBoundary>,
    )

    expect(container.innerHTML).toBe('')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('BookingsBlock round3 accessibility', () => {
  it('uses the right heading levels and accessible names', async () => {
    await setup([
      makeBooking({
        milestones: [makeMilestone('deposit', { state: 'paid', paidOn: '2026-10-08' }), makeMilestone('balance')],
      }),
    ])

    expect(screen.getByRole('heading', { level: 3, name: '订单与付款' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 4 })).toBeTruthy()
    expect(screen.getByRole('button', { name: '改到期日（尾款）' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /撤销/ })).toBeTruthy()
  })

  it('returns focus to the opener after closing the paid panel', async () => {
    await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '定金已收到款' }))
    const panel = await screen.findByRole('group', { name: '确认定金已收到款' })
    fireEvent.click(within(panel).getByRole('button', { name: '先不勾' }))

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '定金已收到款' }))
    })
  })

  it('returns focus to the note opener after cancelling', async () => {
    await setup([makeBooking()])

    fireEvent.click(screen.getByRole('button', { name: '改备注' }))
    const cancel = await screen.findByRole('button', { name: '取消' })
    fireEvent.click(cancel)

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '改备注' }))
    })
  })
})

describe('BookingsBlock round3 out-of-order responses', () => {
  it('ignores a slow response for a previous contact', async () => {
    let releaseA: () => void = () => {}
    const pendingA = new Promise<void>((resolve) => {
      releaseA = resolve
    })

    installFetch([
      {
        match: (url, method) =>
          method === 'GET' && url.includes(`contactId=${CONTACT}`),
        respond: async () => {
          await pendingA
          return jsonResponse({ bookings: [makeBooking({ tourName: 'A团' })] })
        },
      },
      {
        match: (url, method) =>
          method === 'GET' && url.includes(`contactId=${SECOND_CONTACT}`),
        respond: () => jsonResponse({ bookings: [makeBooking({ tourName: 'B团' })] }),
      },
    ])

    const { rerender } = render(
      <BookingsBlock clientId={CLIENT} contactId={CONTACT} />,
    )

    rerender(<BookingsBlock clientId={CLIENT} contactId={SECOND_CONTACT} />)

    expect(await screen.findByText(/B团/)).toBeTruthy()

    releaseA()

    await waitFor(() => {
      expect(screen.queryByText(/A团/)).toBeNull()
    })
    expect(screen.getByText(/B团/)).toBeTruthy()
  })
})
