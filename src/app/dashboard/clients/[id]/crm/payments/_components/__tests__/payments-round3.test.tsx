import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CrmPaymentsPage from '../../page'
import { PAGE_HEADING, dateLabel, milestoneCellText } from '../payments-format'
import { pushes, resetNav, setSearch } from './nav-mock'
import {
  CLIENT,
  DEP_A,
  makeGroup,
  makePayload,
  makeRow,
  json,
  stubFetch,
} from './payments-fixtures'

vi.mock('next/navigation', async () => (await import('./nav-mock')).navigationMock)

beforeEach(() => { resetNav(''); window.sessionStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('dateLabel / milestoneCellText', () => {
  it('formats same-year dates short and other years long', () => {
    expect(dateLabel('2026-10-14', '2026-10-12')).toBe('10月14日')
    expect(dateLabel('2027-05-10', '2026-10-12')).toBe('2027年5月10日')
    expect(dateLabel('2025-12-01', '2026-10-12')).toBe('2025年12月01日')
    expect(dateLabel('2027-01-02', '2026-12-31')).toBe('2027年1月02日')
    expect(dateLabel('2026-12-31', '2027-01-01')).toBe('2026年12月31日')
    expect(dateLabel(null, '2026-10-12')).toBe('（未定）')
  })

  it('adds the year to milestone cells only when it is not this year', () => {
    const nextYear = milestoneCellText(
      { kind: 'balance', label: '尾款', state: 'unpaid', paidOn: null, dueOn: '2027-05-10', dueNote: null, overdue: false, quiet: false },
      '2026-10-12',
    )
    expect(nextYear).toContain('2027年')
    const thisYear = milestoneCellText(
      { kind: 'balance', label: '尾款', state: 'unpaid', paidOn: null, dueOn: '2026-12-19', dueNote: null, overdue: false, quiet: false },
      '2026-10-12',
    )
    expect(thisYear).not.toContain('2027年')
    const paid = milestoneCellText(
      { kind: 'deposit', label: '定金', state: 'paid', paidOn: '2027-01-05', dueOn: null, dueNote: null, overdue: false, quiet: false },
      '2026-10-12',
    )
    expect(paid).toContain('2027年')
  })
})

describe('付款总览 summary select buttons', () => {
  it('names each summary select button', async () => {
    const payload = makePayload()
    payload.summary.groups.push(
      makeGroup({ key: 'u1', kind: 'unknown_date', departureId: 'u1', departOn: null, tourName: 'X' }),
    )
    stubFetch(() => json(200, payload))
    render(<CrmPaymentsPage />)

    await screen.findByText(PAGE_HEADING)
    expect(screen.getByRole('button', { name: '只看 新西兰南北岛 12 天 2027-03-19 出发的订单' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '只看还没选出发日期的订单' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '只看日期不明的出发' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /2026-11-02 出发的订单/ })).toBeTruthy()

    const table = screen.getByRole('table', { name: '各出发日期的收款进度' })
    for (const button of within(table).getAllByRole('button')) {
      expect(button.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0)
    }

    fireEvent.click(screen.getByRole('button', { name: '只看 新西兰南北岛 12 天 2027-03-19 出发的订单' }))
    await waitFor(() => expect(pushes.some((u) => u.includes(`departureId=${DEP_A}`))).toBe(true))
  })
})

describe('付款总览 dates across years', () => {
  it('shows the year when a date is not this year', async () => {
    const payload = makePayload()
    payload.list.rows[0] = makeRow({
      balance: { kind: 'balance', label: '尾款', state: 'unpaid', paidOn: null, dueOn: '2027-05-10', dueNote: null, overdue: false, quiet: false },
      lastNudgedOn: '2025-11-30',
    })
    payload.summary.groups[0] = makeGroup({ nearestDueOn: '2027-02-03' })
    stubFetch(() => json(200, payload))
    render(<CrmPaymentsPage />)

    await screen.findByText(PAGE_HEADING)
    expect(await screen.findByText('⬜ 到期 2027年5月10日')).toBeTruthy()
    expect(screen.getByText('2027年2月3日')).toBeTruthy()
    expect(screen.getAllByText('⬜ 到期 12月19日').length).toBeGreaterThan(0)
    expect(screen.getByText('2025年11月30日')).toBeTruthy()
  })
})

describe('付款总览 cancelled orders', () => {
  it('shows dashes for a cancelled order, never an unpaid or due cell', async () => {
    const payload = makePayload()
    payload.list.rows = [
      makeRow({ status: 'cancelled', deposit: null, balance: null, note: '客人改期了', contactName: 'Zed' }),
    ]
    stubFetch(() => json(200, payload))
    render(<CrmPaymentsPage />)

    await screen.findByText(PAGE_HEADING)
    const link = await screen.findByRole('link', { name: 'Zed' })
    const row = link.closest('tr') as HTMLTableRowElement
    expect(within(row).getByText('已取消')).toBeTruthy()
    expect(within(row).getByText('客人改期了')).toBeTruthy()
    expect(within(row).queryByText(/⬜|到期/)).toBeNull()
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
})
