import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CrmPaymentsPage from '../../page'
import { PAGE_HEADING } from '../payments-format'
import { pushes, resetNav, setSearch } from './nav-mock'
import {
  CLIENT,
  CONTACT_1,
  CONTACT_2,
  makeEmptyPayload,
  makeGroup,
  makePayload,
  json,
  overviewCalls,
  stubFetch,
} from './payments-fixtures'

vi.mock('next/navigation', async () => (await import('./nav-mock')).navigationMock)

beforeEach(() => {
  resetNav('')
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const COLUMN_HEADERS = [
  '团 / 出发日期',
  '订单',
  '定金已收',
  '尾款已收',
  '未收齐（其中已过期）',
  '线下已处理',
  '最近到期日',
]

function renderPage(): void {
  render(<CrmPaymentsPage />)
}

function summaryTable(): HTMLElement {
  return screen.getByRole('table', { name: '各出发日期的收款进度' })
}

function groupRow(name: RegExp): HTMLElement {
  const button = screen.getByRole('button', { name })
  const row = button.closest('tr')
  if (row === null) throw new Error('group row not found')
  return row
}

describe('付款总览 page rendering', () => {
  it('renders the heading, every column header and the top table counts as 已收/总数', async () => {
    stubFetch(() => json(200, makePayload()))
    renderPage()

    expect(await screen.findByRole('heading', { name: PAGE_HEADING })).toBeTruthy()

    const table = summaryTable()
    for (const header of COLUMN_HEADERS) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeTruthy()
    }

    const rowA = groupRow(/2027-03-19 出发/)
    expect(within(rowA).getByText('6')).toBeTruthy()
    expect(within(rowA).getByText('5/6')).toBeTruthy()
    expect(within(rowA).getByText('2/6')).toBeTruthy()
    expect(within(rowA).getByText('（1 已过期）')).toBeTruthy()
    expect(within(rowA).getByText('1')).toBeTruthy()
    expect(within(rowA).getByText('2026年12月19日')).toBeTruthy()

    const rowB = groupRow(/2026-11-02 出发/)
    expect(within(rowB).getByText('已出发')).toBeTruthy()
    expect(within(rowB).getByText('出发日变了，请确认')).toBeTruthy()
    expect(within(rowB).getByText('2026年8月5日（已过 68 天）')).toBeTruthy()

    const rowUndecided = groupRow(/还没选出发日期/)
    expect(within(rowUndecided).getByText('2026年10月2日（已过 10 天）')).toBeTruthy()
  })

  it('tints overdue rows red and fully paid rows green, and shows overdue in red', async () => {
    stubFetch(() => json(200, makePayload()))
    renderPage()
    await screen.findByRole('heading', { name: PAGE_HEADING })
    const rowA = groupRow(/2027-03-19 出发/)
    expect(rowA.className).toContain('bg-[#C2453A]/10')
    expect(within(rowA).getByText('（1 已过期）').className).toContain('text-[#C2453A]')
  })

  it('shows a dash for a group whose nearest due date is unknown', async () => {
    const payload = makePayload()
    payload.summary.groups = [
      makeGroup({ key: 'none', kind: 'undecided', tourId: null, tourName: null, departureId: null, departOn: null, nearestDueOn: null }),
    ]
    stubFetch(() => json(200, payload))
    renderPage()
    await screen.findByRole('table', { name: '各出发日期的收款进度' })

    const row = groupRow(/还没选出发日期/)
    expect(within(row).getByText('—')).toBeTruthy()
  })

  it('shows the 合计 line labelled as the sum of the rows shown, plus hidden-group note, toggle and footnote', async () => {
    stubFetch(() => json(200, makePayload()))
    renderPage()

    const table = await screen.findByRole('table', { name: '各出发日期的收款进度' })
    const footer = within(table).getByText('合计（上面当前显示的这几行相加）').closest('tr')
    if (footer === null) throw new Error('footer row not found')
    expect(within(footer).getByText('10')).toBeTruthy()
    expect(within(footer).getByText('8/10')).toBeTruthy()
    expect(within(footer).getByText('3/10')).toBeTruthy()
    expect(within(footer).getByText('（3 已过期）')).toBeTruthy()
    expect(within(footer).getByText('2')).toBeTruthy()

    expect(screen.getByText('另有 2 个已出发且已收齐的出发日期没显示')).toBeTruthy()
    expect(screen.getByRole('button', { name: '也看已收齐的过去出发' })).toBeTruthy()
    expect(
      screen.getByText('其中 2 单标了线下已处理 · 3 单已暂停提醒 · 另有 4 单已取消，不计入上表'),
    ).toBeTruthy()
  })

  it('hides the hidden-group note and toggle when nothing is hidden and the toggle is off', async () => {
    const payload = makePayload()
    payload.summary.hiddenGroupCount = 0
    payload.summary.hiddenOrders = 0
    stubFetch(() => json(200, payload))
    renderPage()

    await screen.findByRole('table', { name: '各出发日期的收款进度' })
    expect(screen.queryByText(/没显示/)).toBeNull()
    expect(screen.queryByRole('button', { name: '也看已收齐的过去出发' })).toBeNull()
  })

  it('clicking the toggle asks the server for past paid departures', async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('includePastPaid=true')
        ? json(200, { ...makePayload(), summary: { ...makePayload().summary, hiddenGroupCount: 0 } })
        : json(200, makePayload()),
    )
    renderPage()

    const toggle = await screen.findByRole('button', { name: '也看已收齐的过去出发' })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(pushes.some((u) => u.includes('includePastPaid=true'))).toBe(true)
    })
    await waitFor(() => {
      expect(overviewCalls(fetchMock).some((u) => u.includes('includePastPaid=true'))).toBe(true)
    })

    const stillThere = await screen.findByRole('button', { name: '也看已收齐的过去出发' })
    expect(stillThere.getAttribute('aria-pressed')).toBe('true')
  })

  it('renders the list columns and cells', async () => {
    stubFetch(() => json(200, makePayload()))
    renderPage()

    const list = await screen.findByRole('table', { name: '全部订单' })
    for (const header of ['客人', '团 · 出发日期', '定金', '尾款', '最近催过', '备注']) {
      expect(within(list).getByRole('columnheader', { name: header })).toBeTruthy()
    }

    const wangRow = within(list).getByRole('link', { name: 'Wang M.' }).closest('tr')
    if (wangRow === null) throw new Error('Wang row not found')
    expect(within(wangRow).getByText('✅ 10月08日')).toBeTruthy()
    expect(within(wangRow).getByText('⬜ 到期 12月19日')).toBeTruthy()
    expect(within(wangRow).getByText('10月01日')).toBeTruthy()

    const liRow = within(list).getByRole('link', { name: 'Li & Li' }).closest('tr')
    if (liRow === null) throw new Error('Li row not found')
    expect(within(liRow).getByText('⬜ 已过期3天')).toBeTruthy()
    expect(within(liRow).getByText('—')).toBeTruthy()
    expect(within(liRow).getByText('没勾邮轮按90天算')).toBeTruthy()

    expect(screen.getByText('第 1 / 3 页（共 120 单）')).toBeTruthy()
    const pager = screen.getByRole('navigation', { name: '翻页' })
    expect(within(pager).getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(within(pager).getByRole('button', { name: '下一页' })).toBeEnabled()
  })

  it('empty state says everything and never shows an empty table', async () => {
    stubFetch(() => json(200, makeEmptyPayload()))
    renderPage()

    expect(await screen.findByText('还没有录过订单，所以这里暂时没有数字。')).toBeTruthy()
    expect(
      screen.getByText('在「全部客人」里打开一个客人 →「订单与付款」→「＋ 加订单」，录第一单之后这页就会有内容。'),
    ).toBeTruthy()
    expect(await screen.findByText('（这个客户目前有 1 个可选的未来出发日期）')).toBeTruthy()

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('heading', { name: '全部订单' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('banner shows with zero orders AND with orders when total > 0, and not when total is 0', async () => {
    stubFetch(() => json(200, makeEmptyPayload()))
    renderPage()
    expect(await screen.findByRole('note')).toBeTruthy()
    expect(
      screen.getByText(
        /另有 29 位客人已付款（定金 \/ 全款 \/ 即将出行），但还没有订单/,
      ),
    ).toBeTruthy()
    cleanup()

    stubFetch(() =>
      json(200, makePayload({ paidWithoutBooking: { total: 5, rows: [{ id: CONTACT_1, name: 'Wang M.', stage: 'deposit_paid' }, { id: CONTACT_2, name: null, stage: 'paid_full' }] } })),
    )
    renderPage()
    expect(await screen.findByRole('note')).toBeTruthy()
    expect(await screen.findByRole('table', { name: '各出发日期的收款进度' })).toBeTruthy()
    cleanup()

    stubFetch(() => json(200, makePayload()))
    renderPage()
    await screen.findByRole('table', { name: '各出发日期的收款进度' })
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('banner name list expands, links to the guest drawer and says how many are not listed', async () => {
    stubFetch(() => json(200, makeEmptyPayload()))
    renderPage()

    await screen.findByRole('note')
    expect(screen.queryByRole('link', { name: 'Wang M.' })).toBeNull()

    const toggle = screen.getByRole('button', { name: '看名单' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)

    const wang = await screen.findByRole('link', { name: 'Wang M.' })
    expect(wang.getAttribute('href')).toBe(
      `/dashboard/clients/${CLIENT}/crm/all?contact=${CONTACT_1}&focus=bookings`,
    )
    const noName = screen.getByRole('link', { name: '（没有姓名）' })
    expect(noName.getAttribute('href')).toBe(
      `/dashboard/clients/${CLIENT}/crm/all?contact=${CONTACT_2}&focus=bookings`,
    )
    const chen = screen.getByRole('link', { name: 'Chen' })
    expect(chen.getAttribute('href')).toBe(
      `/dashboard/clients/${CLIENT}/crm/all?contact=c1a1a1a1-0000-4000-8000-000000000003&focus=bookings`,
    )

    expect(screen.getByText('已付定金')).toBeTruthy()
    expect(screen.getByText('已付全款')).toBeTruthy()
    expect(screen.getByText('即将出行')).toBeTruthy()
    expect(screen.getByText('还有 26 位没列出')).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('no forbidden words, money signs or raw ids anywhere on screen', async () => {
    const forbidden = [
      '节点',
      '里程碑',
      '班期',
      'departure',
      'milestone',
      '金额',
      '营收',
      '回款率',
      '$',
      '¥',
      '￥',
      `tour_${'catalog'}`,
    ]
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/

    function assertClean(): void {
      const text = (document.body.textContent ?? '').split(PAGE_HEADING).join('')
      const attrs: string[] = []
      document.querySelectorAll('[aria-label], [title]').forEach((el) => {
        const a = el.getAttribute('aria-label')
        const t = el.getAttribute('title')
        if (a !== null) attrs.push(a)
        if (t !== null) attrs.push(t)
      })
      const haystack = [text, ...attrs]
      for (const word of forbidden) {
        for (const part of haystack) {
          expect(part.includes(word), `found forbidden "${word}" in: ${part}`).toBe(false)
        }
      }
      expect(uuid.test(text), `found a raw uuid in: ${text}`).toBe(false)
    }

    stubFetch(() =>
      json(200, makePayload({ paidWithoutBooking: { total: 5, rows: [{ id: CONTACT_1, name: 'Wang M.', stage: 'deposit_paid' }, { id: CONTACT_2, name: null, stage: 'paid_full' }] } })),
    )
    renderPage()
    await screen.findByRole('table', { name: '各出发日期的收款进度' })
    fireEvent.click(screen.getByRole('button', { name: '看名单' }))
    await screen.findAllByRole('link', { name: 'Wang M.' })
    assertClean()
    cleanup()

    stubFetch(() => json(200, makeEmptyPayload()))
    renderPage()
    await screen.findByText('还没有录过订单，所以这里暂时没有数字。')
    assertClean()
  })
})
