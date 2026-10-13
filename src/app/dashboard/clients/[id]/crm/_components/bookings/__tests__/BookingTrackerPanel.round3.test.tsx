import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NudgeList, NudgeRow } from '@/lib/crm/booking-types'
import { BookingTrackerPanel } from '../BookingTrackerPanel'
import { BookingMembersCard } from '../BookingMembersCard'
import {
  CLIENT,
  installFetch,
  jsonResponse,
  makeBooking,
  makeNudgeRow,
  route,
  type FetchCall,
  type FetchRoute,
} from './booking-test-data'

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
      <BookingMembersCard clientId={CLIENT} />
    </>,
  )
  return { calls, onOpenContact }
}

function nudgeCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.url.includes('/nudge') && !call.url.includes('/nudge-list'))
}

function foldedRows(): NudgeRow[] {
  return [
    makeNudgeRow(11, {
      bucket: 'overdue',
      dueOn: '2026-09-01',
      dueInDays: -41,
      contactName: '老客1',
    }),
    makeNudgeRow(12, {
      bucket: 'overdue',
      dueOn: '2026-09-01',
      dueInDays: -41,
      contactName: '老客2',
    }),
    makeNudgeRow(13, {
      bucket: 'overdue',
      dueOn: '2026-09-01',
      dueInDays: -41,
      contactName: '老客3',
    }),
  ]
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BookingTrackerPanel round 3', () => {
  it('reveals folded guests and toggles them back', async () => {
    const user = userEvent.setup()
    setup({
      nudge: () =>
        makeNudgeList({
          rows: [makeNudgeRow(1)],
          collapsedOverdue: 3,
          collapsedRows: foldedRows(),
        }),
    })

    expect(await screen.findByText(/^逾期很久（3 单）/)).toBeInTheDocument()
    expect(screen.queryByText('老客1')).not.toBeInTheDocument()
    expect(screen.queryByText('老客2')).not.toBeInTheDocument()
    expect(screen.queryByText('老客3')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: '展开看是谁' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)

    expect(await screen.findByText('老客1')).toBeInTheDocument()
    expect(screen.getByText('老客2')).toBeInTheDocument()
    expect(screen.getByText('老客3')).toBeInTheDocument()
    expect(screen.getAllByText('新西兰南北岛 · 2027-03-12 出发')).toHaveLength(4)
    expect(screen.getAllByText('定金 · 到期 2026-09-01（已逾期 41 天）')).toHaveLength(3)

    const collapse = screen.getByRole('button', { name: '收起' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')

    await user.click(collapse)

    await waitFor(() => {
      expect(screen.queryByText('老客1')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('老客2')).not.toBeInTheDocument()
    expect(screen.queryByText('老客3')).not.toBeInTheDocument()
  })

  it('opens a folded guest profile when the name button is clicked', async () => {
    const user = userEvent.setup()
    const { onOpenContact } = setup({
      nudge: () =>
        makeNudgeList({
          rows: [makeNudgeRow(1)],
          collapsedOverdue: 3,
          collapsedRows: foldedRows(),
        }),
    })

    await user.click(await screen.findByRole('button', { name: '展开看是谁' }))
    await user.click(await screen.findByRole('button', { name: '打开 老客1 的资料' }))

    expect(onOpenContact).toHaveBeenCalledWith(makeNudgeRow(11).contactId, '老客1')
  })

  it('acts on a folded row and keeps the others even when the refetch fails', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(11, {
      bucket: 'overdue',
      dueOn: '2026-09-01',
      dueInDays: -41,
      contactName: '老客1',
    })
    let listCalls = 0
    const { calls } = setup({
      nudge: () => makeNudgeList(),
      extraRoutes: [
        route('GET', '/nudge-list?limit=', () => {
          listCalls += 1
          if (listCalls > 1) return jsonResponse({ error: 'boom' }, 500)
          return jsonResponse({
            nudge: makeNudgeList({
              rows: [makeNudgeRow(1)],
              collapsedOverdue: 3,
              collapsedRows: foldedRows(),
            }),
          })
        }),
      ],
    })

    await user.click(await screen.findByRole('button', { name: '展开看是谁' }))
    await user.click(await screen.findByRole('button', { name: '今天已催（老客1）' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    expect(nudgeCalls(calls)[0].url).toBe(
      `/api/clients/${CLIENT}/crm/bookings/${row.bookingId}/milestones/deposit/nudge`,
    )
    expect(nudgeCalls(calls)[0].body).toEqual({
      expectedUpdatedAt: row.milestoneUpdatedAt,
      mode: 'nudged_today',
    })

    await waitFor(() => {
      expect(screen.queryByText('老客1')).not.toBeInTheDocument()
    })
    expect(screen.getByText('老客2')).toBeInTheDocument()
    expect(screen.getByText('老客3')).toBeInTheDocument()
  })

  it('shows no expand button when there are no folded rows', async () => {
    setup({
      nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)], collapsedOverdue: 0 }),
    })

    expect(await screen.findByRole('heading', { name: '付款要催' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '展开看是谁' })).not.toBeInTheDocument()
  })

  it('uses the U4 wording for row actions', async () => {
    setup({ nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)] }) })

    expect(await screen.findByRole('button', { name: '今天已催（客人1）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推迟提醒（客人1）' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '已线下收款，不再提醒（客人1）' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '推迟' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '线下已处理' })).not.toBeInTheDocument()
  })

  it('confirms before marking a row as handled offline', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(1)
    const { calls } = setup({ nudge: () => makeNudgeList({ rows: [row] }) })

    await user.click(await screen.findByRole('button', { name: '已线下收款，不再提醒（客人1）' }))

    expect(nudgeCalls(calls)).toHaveLength(0)
    expect(screen.getByRole('group', { name: '确认不再提醒（客人1）' })).toBeInTheDocument()
    expect(screen.getByText('点了这一项就不再提醒，确定吗？')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '先不要' }))

    expect(screen.queryByRole('group', { name: '确认不再提醒（客人1）' })).not.toBeInTheDocument()
    expect(nudgeCalls(calls)).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '已线下收款，不再提醒（客人1）' }))
    await user.click(screen.getByRole('button', { name: '确定' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    expect(nudgeCalls(calls)[0].body).toEqual({
      expectedUpdatedAt: row.milestoneUpdatedAt,
      mode: 'quiet',
    })
  })

  it('keeps the other rows when the refetch after a nudge fails', async () => {
    const user = userEvent.setup()
    let listCalls = 0
    const { calls } = setup({
      nudge: () => makeNudgeList(),
      extraRoutes: [
        route('GET', '/nudge-list?limit=', () => {
          listCalls += 1
          if (listCalls > 1) return jsonResponse({ error: 'boom' }, 500)
          return jsonResponse({ nudge: makeNudgeList({ rows: rows(3) }) })
        }),
      ],
    })

    await user.click(await screen.findByRole('button', { name: '今天已催（客人1）' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    await waitFor(() => {
      expect(screen.queryByText('客人1')).not.toBeInTheDocument()
    })
    expect(screen.getByText('客人2')).toBeInTheDocument()
    expect(screen.getByText('客人3')).toBeInTheDocument()
  })

  it('offers exactly three snooze options and sends the chosen days', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(1)
    const { calls } = setup({ nudge: () => makeNudgeList({ rows: [row] }) })

    await user.click(await screen.findByRole('button', { name: '推迟提醒（客人1）' }))

    expect(screen.getByRole('button', { name: '推迟 3 天' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推迟 7 天' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推迟 14 天' })).toBeInTheDocument()
    const snoozeButtons = screen
      .getAllByRole('button')
      .filter((button) => (button.textContent ?? '').startsWith('推迟 '))
    expect(snoozeButtons).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: '推迟 3 天' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    expect(nudgeCalls(calls)[0].body).toEqual({
      expectedUpdatedAt: row.milestoneUpdatedAt,
      mode: 'snooze',
      days: 3,
    })
  })

  it('sends 7 days when the 7 day snooze is chosen', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(1)
    const { calls } = setup({ nudge: () => makeNudgeList({ rows: [row] }) })

    await user.click(await screen.findByRole('button', { name: '推迟提醒（客人1）' }))
    await user.click(screen.getByRole('button', { name: '推迟 7 天' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    expect(nudgeCalls(calls)[0].body).toEqual({
      expectedUpdatedAt: row.milestoneUpdatedAt,
      mode: 'snooze',
      days: 7,
    })
  })

  it('sends 14 days when the 14 day snooze is chosen', async () => {
    const user = userEvent.setup()
    const row = makeNudgeRow(1)
    const { calls } = setup({ nudge: () => makeNudgeList({ rows: [row] }) })

    await user.click(await screen.findByRole('button', { name: '推迟提醒（客人1）' }))
    await user.click(screen.getByRole('button', { name: '推迟 14 天' }))

    await waitFor(() => {
      expect(nudgeCalls(calls)).toHaveLength(1)
    })
    expect(nudgeCalls(calls)[0].body).toEqual({
      expectedUpdatedAt: row.milestoneUpdatedAt,
      mode: 'snooze',
      days: 14,
    })
  })

  it('adds a member once when Enter is pressed twice quickly', async () => {
    let members: Array<{ email: string; grantedBy: string; createdAt: string }> = []
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
      ],
    })

    const input = await screen.findByLabelText('邮箱')
    fireEvent.change(input, { target: { value: 'a@b.co' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(
        calls.filter((call) => call.method === 'POST' && call.url.includes('/bookings/members')),
      ).toHaveLength(1)
    })
  })

  it('hides the members card when a member POST is forbidden', async () => {
    const user = userEvent.setup()
    setup({
      nudge: () => makeNudgeList({ rows: [makeNudgeRow(1)] }),
      members: jsonResponse({ members: [] }),
      extraRoutes: [
        route('POST', '/bookings/members', () => jsonResponse({ error: 'Forbidden' }, 403)),
      ],
    })

    expect(await screen.findByRole('heading', { name: '谁能用付款进度' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('邮箱'), 'a@b.co')
    await user.click(screen.getByRole('button', { name: '加入名单' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '谁能用付款进度' })).not.toBeInTheDocument()
    })
  })
})
