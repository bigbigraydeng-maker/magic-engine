import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NudgeList, NudgeRow } from '@/lib/crm/booking-types'
import { BookingTrackerPanel } from '../BookingTrackerPanel'
import { BookingMembersCard } from '../BookingMembersCard'
import {
  CLIENT,
  FORBIDDEN_WORDS,
  installFetch,
  jsonResponse,
  makeBooking,
  makeNudgeRow,
  route,
  type FetchCall,
  type FetchRoute,
} from './booking-test-data'

const MEMBERS_URL = `/api/clients/${CLIENT}/crm/bookings/members`

function makeNudgeList(over: Partial<NudgeList> = {}): NudgeList {
  return {
    rows: [],
    more: false,
    collapsedOverdue: 0,
    collapsedRows: [],
    truncated: false,
    ...over,
  }
}

function rows(count: number, over: (i: number) => Partial<NudgeRow> = () => ({})): NudgeRow[] {
  return Array.from({ length: count }, (_, index) => makeNudgeRow(index + 1, over(index + 1)))
}

interface SetupOptions {
  nudge: (limit: number) => NudgeList
  members?: Response
  nudgePost?: FetchRoute['respond']
  extraRoutes?: FetchRoute[]
}

function setup(opts: SetupOptions): { calls: FetchCall[]; onOpenContact: ReturnType<typeof vi.fn> } {
  const onOpenContact = vi.fn()
  const routes: FetchRoute[] = [
    ...(opts.extraRoutes ?? []),
    route('GET', '/nudge-list?limit=', (call) => {
      const match = /limit=(\d+)/.exec(call.url)
      const limit = match ? Number(match[1]) : 0
      return jsonResponse({ nudge: opts.nudge(limit) })
    }),
    route('GET', '/bookings/members', () => opts.members ?? jsonResponse({ members: [] })),
    route('POST', '/nudge', opts.nudgePost ?? (() => jsonResponse({ booking: makeBooking() }))),
  ]
  const { calls } = installFetch(routes)
  // The members card moved to client settings (权限); the tests mount it next to the panel as the pages do.
  render(
    <>
      <BookingTrackerPanel clientId={CLIENT} onOpenContact={onOpenContact} />
      {opts.members !== undefined ? <BookingMembersCard clientId={CLIENT} /> : null}
    </>,
  )
  return { calls, onOpenContact }
}

function nudgeCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.url.includes('/nudge') && !call.url.includes('/nudge-list'))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BookingTrackerPanel does not own the members card', () => {
  it('renders the reminder list without the members heading', async () => {
    const onOpenContact = vi.fn()
    installFetch([
      route('GET', '/nudge-list?limit=', () => jsonResponse({ nudge: makeNudgeList({ rows: [makeNudgeRow(1)] }) })),
      route('GET', '/bookings/members', () => jsonResponse({ members: [{ email: 'info@cts.test', grantedBy: 'a@b.test', createdAt: '2026-10-12T00:00:00Z' }] })),
    ])
    render(<BookingTrackerPanel clientId={CLIENT} onOpenContact={onOpenContact} />)
    expect(await screen.findByRole('heading', { name: '付款要催' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '谁能用付款进度' })).not.toBeInTheDocument()
  })
})

describe('BookingTrackerPanel compact strip', () => {
  it('shrinks to a slim strip when there is nothing new to chase (the guest list stays the star of the page)', async () => {
    setup({ nudge: () => makeNudgeList({ rows: [] }) })
    const section = await screen.findByTestId('payment-nudge-section')
    expect(section.className).toContain('py-1.5')
    expect(section.className).not.toContain('p-4')
  })

  it('keeps the roomy card when there are rows to chase', async () => {
    setup({ nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)] }) })
    const section = await screen.findByTestId('payment-nudge-section')
    expect(section.className).toContain('p-4')
  })
})

describe('BookingTrackerPanel', () => {
  it('renders nothing when the tracker is not enabled', async () => {
    const { calls } = setup({
      nudge: () => makeNudgeList(),
      extraRoutes: [
        route('GET', '/nudge-list?limit=', () =>
          jsonResponse({ error: 'booking_tracker_not_enabled' }, 404),
        ),
      ],
    })

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/nudge-list'))).toBe(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(document.body.innerHTML).toBe('<div></div>')
    expect(calls.some((call) => call.url.includes('/bookings/members'))).toBe(false)
  })

  it('renders nothing when forbidden', async () => {
    const { calls } = setup({
      nudge: () => makeNudgeList(),
      extraRoutes: [
        route('GET', '/nudge-list?limit=', () => jsonResponse({ error: 'Forbidden' }, 403)),
      ],
    })

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/nudge-list'))).toBe(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(document.body.innerHTML).toBe('<div></div>')
  })

  it('shows the top 10 and expands to 100', async () => {
    const user = userEvent.setup()
    const { calls } = setup({
      nudge: (limit) =>
        limit >= 100
          ? makeNudgeList({ rows: rows(14), more: false })
          : makeNudgeList({ rows: rows(10), more: true }),
    })

    expect(await screen.findByRole('heading', { name: '付款要催' })).toBeInTheDocument()
    expect(screen.getAllByTestId('nudge-row')).toHaveLength(10)
    expect(calls[0].url).toContain('limit=10')

    const expand = screen.getByRole('button', { name: '展开更多' })
    await user.click(expand)

    await waitFor(() => {
      expect(screen.getAllByTestId('nudge-row')).toHaveLength(14)
    })
    expect(calls.some((call) => call.url.includes('limit=100'))).toBe(true)
    expect(screen.queryByRole('button', { name: '展开更多' })).not.toBeInTheDocument()
  })

  it('folds long-overdue rows into a summary line', async () => {
    setup({
      nudge: () => makeNudgeList({ rows: rows(2), collapsedOverdue: 3 }),
    })

    expect(await screen.findByText(/^逾期很久（3 单）/)).toBeInTheDocument()
    expect(screen.getAllByTestId('nudge-row')).toHaveLength(2)
  })

  it('shows the empty message when there is nothing to nudge', async () => {
    setup({ nudge: () => makeNudgeList() })

    expect(await screen.findByText('现在没有要催的款。')).toBeInTheDocument()
  })

  it('renders row content for dated and overdue rows', async () => {
    setup({
      nudge: () =>
        makeNudgeList({
          rows: [
            makeNudgeRow(1),
            makeNudgeRow(2, {
              bucket: 'overdue',
              dueInDays: -3,
              dueOn: '2026-10-09',
            }),
          ],
        }),
    })

    expect(await screen.findByText('客人1')).toBeInTheDocument()
    expect(screen.getAllByText('新西兰南北岛 · 2027-03-12 出发')).toHaveLength(2)
    expect(screen.getByText('定金 · 到期 2026-10-20（8 天后到期）')).toBeInTheDocument()
    expect(screen.getByText('定金 · 到期 2026-10-09（已逾期 3 天）')).toBeInTheDocument()
  })

  it('renders undated rows with the note in the due line', async () => {
    setup({
      nudge: () =>
        makeNudgeList({
          rows: [
            makeNudgeRow(1, {
              dueOn: null,
              dueInDays: null,
              departOn: null,
              bucket: 'undated',
              note: '出发日期还没定，补上才有到期日',
            }),
          ],
        }),
    })

    expect(await screen.findByText('新西兰南北岛 · 出发日期未定')).toBeInTheDocument()
    expect(screen.getByText('定金 · 到期日未定')).toBeInTheDocument()
  })

  it('opens the guest profile when the row is clicked', async () => {
    const user = userEvent.setup()
    const { onOpenContact } = setup({
      nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)] }),
    })

    await user.click(await screen.findByRole('button', { name: '打开 客人1 的资料' }))

    expect(onOpenContact).toHaveBeenCalledWith(makeNudgeRow(1).contactId, '客人1')
  })

  it('marks a row as nudged today and removes it', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(1)
    let nudged = false
    const { calls } = setup({
      nudge: () =>
        makeNudgeList({ rows: nudged ? [makeNudgeRow(2)] : [row, makeNudgeRow(2)] }),
      nudgePost: () => {
        nudged = true
        return jsonResponse({ booking: makeBooking() })
      },
    })

    await user.click(await screen.findByRole('button', { name: '今天已催（客人1）' }))

    await waitFor(() => {
      expect(screen.queryByText('客人1')).not.toBeInTheDocument()
    })
    expect(screen.getByText('客人2')).toBeInTheDocument()

    const posts = nudgeCalls(calls)
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe(
      `/api/clients/${CLIENT}/crm/bookings/${row.bookingId}/milestones/deposit/nudge`,
    )
    expect(posts[0].body).toEqual({
      expectedUpdatedAt: row.milestoneUpdatedAt,
      mode: 'nudged_today',
    })
  })

  it('snoozes a row for a chosen number of days', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(1)
    const { calls } = setup({
      nudge: () => makeNudgeList({ rows: [row] }),
    })

    const snooze = await screen.findByRole('button', { name: '推迟提醒（客人1）' })
    await user.click(snooze)
    expect(snooze).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('button', { name: '推迟 7 天' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    expect(nudgeCalls(calls)[0].body).toEqual({
      expectedUpdatedAt: row.milestoneUpdatedAt,
      mode: 'snooze',
      days: 7,
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '推迟 7 天' })).not.toBeInTheDocument()
    })
  })

  it('marks a row as handled offline without a days key', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(1)
    const { calls } = setup({
      nudge: () => makeNudgeList({ rows: [row] }),
    })

    await user.click(await screen.findByRole('button', { name: '已线下收款，不再提醒（客人1）' }))
    await user.click(await screen.findByRole('button', { name: '确定' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    expect(nudgeCalls(calls)[0].body).toEqual({
      expectedUpdatedAt: row.milestoneUpdatedAt,
      mode: 'quiet',
    })
    expect(nudgeCalls(calls)[0].body).not.toHaveProperty('days')
  })

  it('uses the balance milestone kind in the url', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(1, { kind: 'balance', label: '尾款' })
    const { calls } = setup({
      nudge: () => makeNudgeList({ rows: [row] }),
    })

    await user.click(await screen.findByRole('button', { name: '今天已催（客人1）' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    expect(nudgeCalls(calls)[0].url).toBe(
      `/api/clients/${CLIENT}/crm/bookings/${row.bookingId}/milestones/balance/nudge`,
    )
  })

  it('shows a notice and refetches when the action is stale', async () => {
    const user = userEvent.setup()
    const { calls } = setup({
      nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)] }),
      nudgePost: () => jsonResponse({ error: 'stale' }, 409),
    })

    await user.click(await screen.findByRole('button', { name: '今天已催（客人1）' }))

    expect(await screen.findByText('别人刚改过，已为你刷新')).toBeInTheDocument()
    await waitFor(() => {
      const listCalls = calls.filter((call) => call.url.includes('/nudge-list'))
      expect(listCalls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('disables the action buttons while a nudge request is in flight', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    setup({
      nudge: () => makeNudgeList({ rows: [makeNudgeRow(1), makeNudgeRow(2)] }),
      nudgePost: async () => {
        await pending
        return jsonResponse({ booking: makeBooking() })
      },
    })

    await user.click(await screen.findByRole('button', { name: '今天已催（客人1）' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '今天已催（客人1）' })).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: '今天已催（客人2）' })).toBeDisabled()

    release()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '今天已催（客人2）' })).toBeEnabled()
    })
  })

  it('shows the members card only for admins', async () => {
    setup({
      nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)] }),
      members: jsonResponse({
        members: [
          { email: 'info@cts.test', grantedBy: 'admin@me.test', createdAt: '2026-10-12T00:00:00Z' },
        ],
      }),
    })

    expect(await screen.findByRole('heading', { name: '谁能用付款进度' })).toBeInTheDocument()
    expect(screen.getByText('info@cts.test')).toBeInTheDocument()
  })

  it('hides the members card when the members route is forbidden', async () => {
    setup({
      nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)] }),
      members: jsonResponse({ error: 'Forbidden' }, 403),
    })

    expect(await screen.findByRole('heading', { name: '付款要催' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '谁能用付款进度' })).not.toBeInTheDocument()
    })
  })

  it('adds and removes members', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let members = [
      { email: 'info@cts.test', grantedBy: 'admin@me.test', createdAt: '2026-10-12T00:00:00Z' },
    ]
    const { calls } = setup({
      nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)] }),
      members: jsonResponse({ members }),
      extraRoutes: [
        route('POST', '/bookings/members', (call) => {
          const email = typeof call.body?.email === 'string' ? call.body.email : ''
          members = [
            ...members,
            { email, grantedBy: 'admin@me.test', createdAt: '2026-10-12T00:00:00Z' },
          ]
          return jsonResponse({ members })
        }),
        route('DELETE', '/bookings/members', (call) => {
          const email = decodeURIComponent(call.url.split('email=')[1] ?? '')
          members = members.filter((member) => member.email !== email)
          return jsonResponse({ members })
        }),
      ],
    })

    const input = await screen.findByLabelText('邮箱')
    await user.type(input, ' New@CTS.test ')
    await user.click(screen.getByRole('button', { name: '加入名单' }))

    await waitFor(() => {
      expect(screen.getByText('new@cts.test')).toBeInTheDocument()
    })
    const addCalls = calls.filter(
      (call) => call.method === 'POST' && call.url.includes('/bookings/members'),
    )
    expect(addCalls).toHaveLength(1)
    expect(addCalls[0].body).toEqual({ email: 'new@cts.test' })

    await user.type(screen.getByLabelText('邮箱'), 'abc')
    await user.click(screen.getByRole('button', { name: '加入名单' }))
    expect(await screen.findByText('请填一个完整的邮箱地址')).toBeInTheDocument()
    expect(
      calls.filter((call) => call.method === 'POST' && call.url.includes('/bookings/members')),
    ).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '把 info@cts.test 移出名单' }))
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'DELETE' &&
            call.url.includes('/bookings/members?email=info%40cts.test'),
        ),
      ).toBe(true)
    })

    confirmSpy.mockReturnValue(false)
    const before = calls.filter((call) => call.method === 'DELETE').length
    await user.click(screen.getByRole('button', { name: '把 new@cts.test 移出名单' }))
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(before)
  })

  it('never leaks forbidden words', async () => {
    setup({
      nudge: () =>
        makeNudgeList({
          rows: [
            makeNudgeRow(1),
            makeNudgeRow(2, { bucket: 'overdue', dueInDays: -3, dueOn: '2026-10-09' }),
            makeNudgeRow(3, {
              dueOn: null,
              dueInDays: null,
              departOn: null,
              bucket: 'undated',
              note: '出发日期还没定，补上才有到期日',
            }),
          ],
          collapsedOverdue: 2,
        }),
      members: jsonResponse({
        members: [
          { email: 'info@cts.test', grantedBy: 'admin@me.test', createdAt: '2026-10-12T00:00:00Z' },
        ],
      }),
    })

    expect(await screen.findByRole('heading', { name: '谁能用付款进度' })).toBeInTheDocument()

    expect(document.body.textContent ?? '').not.toMatch(FORBIDDEN_WORDS)
    const labels = Array.from(document.querySelectorAll('[aria-label]')).map((el) =>
      el.getAttribute('aria-label'),
    )
    for (const label of labels) {
      expect(label ?? '').not.toMatch(FORBIDDEN_WORDS)
    }
  })
})
