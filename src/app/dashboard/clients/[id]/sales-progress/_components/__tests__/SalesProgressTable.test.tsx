/**
 * Tests for the read-only "sales progress" table and its pure helpers.
 * Fixtures are small literal objects typed as SalesProgressData; invoice
 * numbers are short so the rendered HTML never contains an email-like
 * "@" or a phone-like run of 8+ digits.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SalesProgressData } from '@/lib/crm/sales-progress/load'
import type { SalesBooking, SalesUnit, UnitProgress } from '@/lib/crm/sales-progress/types'
import { SalesProgressTable } from '../SalesProgressTable'
import {
  formatCapacity,
  formatGeneratedAt,
  formatRemaining,
  originLabel,
  rowNotes,
} from '../format'

function unit(overrides: Partial<SalesUnit> = {}): SalesUnit {
  return {
    unitId: 'u1',
    groupId: 'g1',
    label: '10月13日',
    date: '2025-10-13',
    capacity: 20,
    capacityNote: null,
    unitStatus: 'open',
    ...overrides,
  }
}

function booking(overrides: Partial<SalesBooking> = {}): SalesBooking {
  return {
    id: 'b1',
    tourId: 'g1',
    departureId: 'u1',
    departureDepartOn: '2025-10-13',
    bookedOn: '2025-09-01',
    partySize: 2,
    originKind: 'company_confirmed',
    evidenceRef: '84030',
    status: 'active',
    ...overrides,
  }
}

function row(overrides: Partial<UnitProgress> = {}): UnitProgress {
  return {
    unit: unit(),
    companyConfirmed: 5,
    customerStated: 3,
    unverified: 2,
    total: 10,
    unfilledOrders: 0,
    remaining: 10,
    remainingCompanyOnly: 15,
    overBy: 0,
    unattributedPeople: 0,
    bookings: [],
    ...overrides,
  }
}

function data(overrides: Partial<SalesProgressData> = {}): SalesProgressData {
  return {
    result: {
      rows: [row()],
      onClosedUnits: [],
      unattributedOrders: 0,
      unattributedPeople: 0,
      activeOrders: 10,
    },
    generatedAt: '2025-10-13T01:05:00.000Z',
    originColumnsMissing: false,
    ...overrides,
  }
}

describe('format helpers', () => {
  it('formatRemaining handles negative and null capacity', () => {
    expect(formatRemaining(row({ remaining: -3 }))).toBe('超订 3 人')
    expect(formatRemaining(row({ remaining: null }))).toBe('上限未设置')
    expect(formatRemaining(row({ remaining: 4 }))).toBe('4 人')
  })

  it('formatCapacity handles null capacity', () => {
    expect(formatCapacity(row({ unit: unit({ capacity: null }) }))).toBe('上限未设置')
    expect(formatCapacity(row())).toBe('上限 20 人')
  })

  it('originLabel covers all four cases', () => {
    expect(originLabel('company_confirmed')).toBe('公司确认')
    expect(originLabel('customer_stated')).toBe('客人自述')
    expect(originLabel('staff_entered')).toBe('销售手填')
    expect(originLabel(null)).toBe('来源未标')
  })

  it('formatGeneratedAt returns 未知时间 for invalid input', () => {
    expect(formatGeneratedAt('not-a-date')).toBe('未知时间')
  })

  it('rowNotes lists warnings in order', () => {
    const notes = rowNotes(
      row({
        overBy: 2,
        unfilledOrders: 1,
        unattributedPeople: 4,
        unit: unit({ capacityNote: '加座需申请' }),
      }),
    )
    expect(notes).toEqual([
      '超订 2 人（系统不会拦截，请销售自行把关）',
      '另有 1 单人数未填，剩余可能更少',
      '另有 4 人未归属出发日，剩余可能更少',
      '加座需申请',
    ])
  })
})

describe('SalesProgressTable', () => {
  it('renders the three numbers and remaining text', () => {
    render(<SalesProgressTable data={data()} />)
    expect(screen.getByText('5 人')).toBeDefined()
    expect(screen.getByText('3 人')).toBeDefined()
    expect(screen.getByText('2 人')).toBeDefined()
    expect(screen.getByText('10 人')).toBeDefined()
    expect(screen.getByText('仅算公司确认：15 人')).toBeDefined()
  })

  it('shows 上限未设置 for both capacity and remaining', () => {
    render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [row({ unit: unit({ capacity: null }), remaining: null, remainingCompanyOnly: null })],
            onClosedUnits: [],
            unattributedOrders: 0,
            unattributedPeople: 0,
            activeOrders: 10,
          },
        })}
      />,
    )
    expect(screen.getAllByText('上限未设置').length).toBe(2)
  })

  it('shows red over-capacity text and the note', () => {
    render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [row({ remaining: -2, overBy: 2 })],
            onClosedUnits: [],
            unattributedOrders: 0,
            unattributedPeople: 0,
            activeOrders: 10,
          },
        })}
      />,
    )
    const over = screen.getByText('超订 2 人')
    expect(over.className).toContain('text-red-700')
    expect(screen.getByText('超订 2 人（系统不会拦截，请销售自行把关）')).toBeDefined()
  })

  it('shows the unfilled orders note', () => {
    render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [row({ unfilledOrders: 3 })],
            onClosedUnits: [],
            unattributedOrders: 0,
            unattributedPeople: 0,
            activeOrders: 10,
          },
        })}
      />,
    )
    expect(screen.getByText('另有 3 单人数未填，剩余可能更少')).toBeDefined()
  })

  it('shows the unattributed note', () => {
    render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [row({ unattributedPeople: 6 })],
            onClosedUnits: [],
            unattributedOrders: 0,
            unattributedPeople: 0,
            activeOrders: 10,
          },
        })}
      />,
    )
    expect(screen.getByText('另有 6 人未归属出发日，剩余可能更少')).toBeDefined()
  })

  it('shows the capacity note', () => {
    render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [row({ unit: unit({ capacityNote: '加座需申请' }) })],
            onClosedUnits: [],
            unattributedOrders: 0,
            unattributedPeople: 0,
            activeOrders: 10,
          },
        })}
      />,
    )
    expect(screen.getByText('加座需申请')).toBeDefined()
  })

  it('shows the originColumnsMissing notice', () => {
    render(<SalesProgressTable data={data({ originColumnsMissing: true })} />)
    expect(
      screen.getByText('订单的「来源」「发票号」两列还没有在系统里启用，所有订单暂按「待核实」算。'),
    ).toBeDefined()
  })

  it('shows the zero-orders notice', () => {
    render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [],
            onClosedUnits: [],
            unattributedOrders: 0,
            unattributedPeople: 0,
            activeOrders: 0,
          },
        })}
      />,
    )
    expect(
      screen.getByText('现在还没有录入任何订单；第一批订单导入后，这里才会有数字。'),
    ).toBeDefined()
    expect(screen.getByText('还没有出发日。')).toBeDefined()
  })

  it('shows footer lines for unattributed and closed units', () => {
    render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [row()],
            onClosedUnits: [{ unit: unit({ unitId: 'u9', label: '9月1日' }), orders: 2, people: 4 }],
            unattributedOrders: 3,
            unattributedPeople: 7,
            activeOrders: 10,
          },
        })}
      />,
    )
    expect(screen.getByText('订单没有挂出发日：3 单，共 7 人')).toBeDefined()
    expect(
      screen.getByText('挂在已取消/已关闭出发日上的订单：9月1日，2 单，共 4 人'),
    ).toBeDefined()
  })

  it('shows invoice text and 人数未填 in the details list', () => {
    render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [row({ bookings: [booking({ partySize: null })] })],
            onClosedUnits: [],
            unattributedOrders: 0,
            unattributedPeople: 0,
            activeOrders: 10,
          },
        })}
      />,
    )
    expect(screen.getByText('看这几张订单（1）')).toBeDefined()
    expect(screen.getByText('发票 84030 · 人数未填 · 公司确认')).toBeDefined()
  })

  it('never renders an @ or a phone-like digit run', () => {
    const { container } = render(
      <SalesProgressTable
        data={data({
          result: {
            rows: [row({ bookings: [booking()] })],
            onClosedUnits: [],
            unattributedOrders: 0,
            unattributedPeople: 0,
            activeOrders: 10,
          },
        })}
      />,
    )
    const html = container.innerHTML
    expect(html.includes('@')).toBe(false)
    expect(/\d{8,}/.test(html)).toBe(false)
  })
})
