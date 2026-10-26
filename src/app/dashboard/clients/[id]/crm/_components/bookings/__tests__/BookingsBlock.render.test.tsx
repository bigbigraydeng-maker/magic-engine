/**
 * Render-level tests for the CRM "订单与付款" block (BookingsBlock).
 *
 * These tests exercise the block through the real child components and a
 * stubbed `fetch` (see ./booking-test-data). They cover the loading / hidden /
 * error / ready states, the card contents, warning wording, ordering, the
 * forbidden-vocabulary guard and basic touch/keyboard affordances.
 */

import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BookingsBlock } from '../BookingsBlock'
import {
  CLIENT,
  CONTACT,
  FORBIDDEN_WORDS,
  installFetch,
  jsonResponse,
  makeBooking,
  makeMilestone,
  makeWarning,
  route,
} from './booking-test-data'

const BOOKINGS_URL = `/api/clients/${CLIENT}/crm/bookings?contactId=${CONTACT}`

/** Install the bookings GET route and render the block. */
function setup(bookings: ReturnType<typeof makeBooking>[]): {
  container: HTMLElement
} {
  installFetch([
    route('GET', `/api/clients/${CLIENT}/crm/bookings?contactId=${CONTACT}`, () =>
      jsonResponse({ bookings }),
    ),
  ])
  const { container } = render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)
  return { container }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BookingsBlock render states', () => {
  it('renders nothing when the booking tracker is not enabled (404)', async () => {
    const { calls } = installFetch([
      route('GET', `/api/clients/${CLIENT}/crm/bookings?contactId=${CONTACT}`, () =>
        jsonResponse({ error: 'booking_tracker_not_enabled' }, 404),
      ),
    ])
    const { container } = render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)

    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the request is forbidden (403)', async () => {
    const { calls } = installFetch([
      route('GET', `/api/clients/${CLIENT}/crm/bookings?contactId=${CONTACT}`, () =>
        jsonResponse({ error: 'Forbidden' }, 403),
      ),
    ])
    const { container } = render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)

    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing while the request is pending', async () => {
    const { calls } = installFetch([
      route(
        'GET',
        `/api/clients/${CLIENT}/crm/bookings?contactId=${CONTACT}`,
        () => new Promise<Response>(() => {}),
      ),
    ])
    const { container } = render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)

    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(container.innerHTML).toBe('')
  })

  it('shows a friendly alert and a retry button on server failure', async () => {
    installFetch([
      route('GET', `/api/clients/${CLIENT}/crm/bookings?contactId=${CONTACT}`, () =>
        jsonResponse({ error: 'booking_failed' }, 500),
      ),
    ])
    render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('没有成功，请稍后再试')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.queryByText(/booking_failed/)).not.toBeInTheDocument()
  })

  it('renders the heading, add button and empty hint for an empty list', async () => {
    setup([])

    expect(await screen.findByText('订单与付款')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '＋ 加订单' })).toBeInTheDocument()
    expect(screen.getByText(/还没有订单/)).toBeInTheDocument()
  })
})

describe('BookingsBlock card content', () => {
  it('renders tour, departure, milestone states and badges', async () => {
    setup([
      makeBooking({
        milestones: [
          makeMilestone('deposit', {
            state: 'paid',
            paidOn: '2026-10-08',
            autoByEmail: true,
          }),
          makeMilestone('balance', {
            state: 'unpaid',
            dueOn: '2026-12-12',
            dueInDays: 61,
            overdue: false,
          }),
        ],
      }),
    ])

    expect((await screen.findAllByRole('heading', { name: /新西兰南北岛/ })).length).toBeGreaterThan(0)
    expect(screen.getByText(/2027-03-12 出发/)).toBeInTheDocument()

    const deposit = screen.getByTestId('payment-deposit')
    expect(within(deposit).getByText(/✅ 已收 2026-10-08/)).toBeInTheDocument()
    expect(
      within(deposit).getByRole('button', { name: '撤销定金收款' }),
    ).toBeInTheDocument()
    expect(
      within(deposit).queryByRole('button', { name: '定金已收到款' }),
    ).not.toBeInTheDocument()

    const balance = screen.getByTestId('payment-balance')
    expect(
      within(balance).getByText(/未收到 · 到期 2026-12-12（还有 61 天）/),
    ).toBeInTheDocument()
    expect(
      within(balance).getByRole('button', { name: '尾款已收到款' }),
    ).toBeInTheDocument()
    expect(
      within(balance).getByRole('button', { name: '改到期日（尾款）' }),
    ).toBeInTheDocument()

    expect(screen.getByText('邮件自动')).toBeInTheDocument()
  })

  it('shows an overdue milestone in plain words', async () => {
    setup([
      makeBooking({
        milestones: [
          makeMilestone('deposit', {
            state: 'unpaid',
            dueOn: '2026-10-01',
            dueInDays: -5,
            overdue: true,
          }),
          makeMilestone('balance'),
        ],
      }),
    ])

    const deposit = await screen.findByTestId('payment-deposit')
    expect(within(deposit).getByText(/已逾期 5 天/)).toBeInTheDocument()
  })
})

describe('BookingsBlock warnings', () => {
  it('renders every warning in plain words and confirms the departure change', async () => {
    setup([
      makeBooking({
        warnings: [
          makeWarning(
            'departure_changed',
            '出发日变了：原 2027-03-12 现 2027-03-19，到期日已重算，请确认',
            { needsConfirm: true },
          ),
          makeWarning('departure_missing', '出发日期没填'),
          makeWarning('departure_cancelled', '这个出发日期已取消'),
          makeWarning('departure_not_set', '还没定出发日期'),
          makeWarning('holiday_table_missing', '假期表没配，按默认算'),
          makeWarning('tour_length_mismatch', '行程天数和出发日期对不上'),
          makeWarning('override_stale', '手动改的到期日已过期', { kind: 'balance' }),
          makeWarning('cruise_not_ticked', '未勾邮轮按 90 天算'),
        ],
      }),
    ])

    expect(
      await screen.findByText('出发日变了：原 2027-03-12 现 2027-03-19，到期日已重算，请确认'),
    ).toBeInTheDocument()
    expect(screen.getByText('出发日期没填')).toBeInTheDocument()
    expect(screen.getByText('这个出发日期已取消')).toBeInTheDocument()
    expect(screen.getByText('还没定出发日期')).toBeInTheDocument()
    expect(screen.getByText('假期表没配，按默认算')).toBeInTheDocument()
    expect(screen.getByText('行程天数和出发日期对不上')).toBeInTheDocument()
    expect(screen.getByText('未勾邮轮按 90 天算')).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: '确认新的出发日期' }),
    ).toBeInTheDocument()

    const balance = screen.getByTestId('payment-balance')
    expect(within(balance).getByText('手动改的到期日已过期')).toBeInTheDocument()
  })

  it('shows the pay-in-full sentence exactly once', async () => {
    setup([
      makeBooking({
        payInFull: true,
        warnings: [
          makeWarning('pay_in_full', '这单离出发太近，需一次付清'),
        ],
      }),
    ])

    await screen.findAllByRole('heading', { name: /新西兰南北岛/ })
    expect(screen.getAllByText('这单离出发太近，需一次付清')).toHaveLength(1)
  })
})

describe('BookingsBlock cancelled bookings', () => {
  it('renders a compact read-only summary with no action buttons', async () => {
    setup([
      makeBooking({
        status: 'cancelled',
        cancelNote: '客人改期，定金已线下处理',
      }),
    ])

    expect(await screen.findByText('已取消')).toBeInTheDocument()
    expect(screen.getByText('原因：客人改期，定金已线下处理')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消订单' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '改团/出发日期' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '改备注' })).not.toBeInTheDocument()
  })

  it('renders active bookings before cancelled ones', async () => {
    setup([
      makeBooking({
        id: '30000000-0000-4000-8000-0000000000c1',
        status: 'cancelled',
        cancelNote: '客人改期',
      }),
      makeBooking({
        id: '30000000-0000-4000-8000-0000000000a2',
        status: 'active',
      }),
    ])

    await screen.findAllByRole('heading', { name: /新西兰南北岛/ })
    const cards = screen.getAllByTestId('booking-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).queryByText('已取消')).not.toBeInTheDocument()
    expect(within(cards[1]).getByText('已取消')).toBeInTheDocument()
  })
})

describe('BookingsBlock vocabulary and affordances', () => {
  it('never leaks forbidden words in text or attributes', async () => {
    installFetch([
      route('GET', `/api/clients/${CLIENT}/crm/bookings/options`, () =>
        jsonResponse({
          tours: [
            {
              id: '10000000-0000-4000-8000-0000000000a1',
              name: '新西兰南北岛',
              durationText: '10 天',
              departures: [
                {
                  id: '20000000-0000-4000-8000-0000000000a1',
                  departOn: '2027-03-12',
                  returnOn: '2027-03-21',
                  status: 'open',
                },
              ],
            },
          ],
        }),
      ),
      route('GET', `/api/clients/${CLIENT}/crm/bookings/nudge-list`, () =>
        jsonResponse({
          nudge: { rows: [], more: false, collapsedOverdue: 0, truncated: false },
        }),
      ),
      route('GET', `/api/clients/${CLIENT}/crm/bookings?contactId=${CONTACT}`, () =>
        jsonResponse({
          bookings: [
            makeBooking({
              warnings: [
                makeWarning(
                  'departure_changed',
                  '出发日变了：原 2027-03-12 现 2027-03-19，到期日已重算，请确认',
                  { needsConfirm: true },
                ),
                makeWarning('departure_missing', '出发日期没填'),
                makeWarning('departure_cancelled', '这个出发日期已取消'),
                makeWarning('departure_not_set', '还没定出发日期'),
                makeWarning('holiday_table_missing', '假期表没配，按默认算'),
                makeWarning('tour_length_mismatch', '行程天数和出发日期对不上'),
                makeWarning('override_stale', '手动改的到期日已过期', { kind: 'balance' }),
                makeWarning('cruise_not_ticked', '未勾邮轮按 90 天算'),
              ],
            }),
            makeBooking({
              id: '30000000-0000-4000-8000-0000000000c1',
              status: 'cancelled',
              cancelNote: '客人改期',
            }),
          ],
        }),
      ),
    ])

    const user = userEvent.setup()
    render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)

    await screen.findAllByRole('heading', { name: /新西兰南北岛/ })

    await user.click(screen.getByRole('button', { name: '＋ 加订单' }))
    await screen.findAllByRole('heading', { name: /新西兰南北岛/ })

    const more = screen.queryByRole('button', { name: '更多' })
    if (more) {
      await user.click(more)
    }

    expect(document.body.textContent ?? '').not.toMatch(FORBIDDEN_WORDS)

    const nodes = document.querySelectorAll(
      '[aria-label],[data-testid],[placeholder],[title]',
    )
    nodes.forEach((node) => {
      const values = [
        node.getAttribute('aria-label'),
        node.getAttribute('data-testid'),
        node.getAttribute('placeholder'),
        node.getAttribute('title'),
      ]
      values.forEach((value) => {
        if (value !== null) {
          expect(value).not.toMatch(FORBIDDEN_WORDS)
        }
      })
    })
  })

  it('gives every button a type and every field a label', async () => {
    installFetch([
      route('GET', `/api/clients/${CLIENT}/crm/bookings/options`, () =>
        jsonResponse({
          tours: [
            {
              id: '10000000-0000-4000-8000-0000000000a1',
              name: '新西兰南北岛',
              durationText: '10 天',
              departures: [
                {
                  id: '20000000-0000-4000-8000-0000000000a1',
                  departOn: '2027-03-12',
                  returnOn: '2027-03-21',
                  status: 'open',
                },
              ],
            },
          ],
        }),
      ),
      route('GET', `/api/clients/${CLIENT}/crm/bookings/nudge-list`, () =>
        jsonResponse({
          nudge: { rows: [], more: false, collapsedOverdue: 0, truncated: false },
        }),
      ),
      route('GET', `/api/clients/${CLIENT}/crm/bookings?contactId=${CONTACT}`, () =>
        jsonResponse({ bookings: [makeBooking()] }),
      ),
    ])

    const user = userEvent.setup()
    render(<BookingsBlock clientId={CLIENT} contactId={CONTACT} />)

    await screen.findAllByRole('heading', { name: /新西兰南北岛/ })

    await user.click(screen.getByRole('button', { name: '＋ 加订单' }))
    await screen.findAllByRole('heading', { name: /新西兰南北岛/ })

    const more = screen.queryByRole('button', { name: '更多' })
    if (more) {
      await user.click(more)
    }

    document.querySelectorAll('button').forEach((button) => {
      const type = button.getAttribute('type')
      expect(type === 'button' || type === 'submit').toBe(true)
    })

    document.querySelectorAll('input, select').forEach((field) => {
      const element = field as HTMLInputElement | HTMLSelectElement
      expect(element.labels?.length ?? 0).toBeGreaterThan(0)
    })
  })
})
