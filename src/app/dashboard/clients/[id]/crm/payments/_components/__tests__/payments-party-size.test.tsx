/**
 * 「人数」 column: unknown party sizes are never counted as 0, and the parser refuses a payload
 * that lacks the new fields instead of defaulting them.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SummaryTable } from '../SummaryTable'
import { OrdersTable } from '../OrdersTable'
import { parseOverviewPayload } from '../payments-api'
import { partySizeText } from '../payments-format'
import { makeGroup, makePayload, makeRow } from './payments-fixtures'

afterEach(cleanup)

const TOTALS = {
  orders: 3,
  partySize: 15,
  partySizeMissing: 1,
  depositPaid: 0,
  balancePaid: 0,
  unsettled: 0,
  unsettledOverdue: 0,
  offlineHandled: 0,
}

describe('partySizeText', () => {
  it('never turns an unknown size into 0', () => {
    expect(partySizeText(6, 0)).toBe('6')
    expect(partySizeText(4, 1)).toBe('4（另 1 单未填）')
    expect(partySizeText(0, 3)).toBe('未填（3 单）')
  })
})

describe('SummaryTable 人数', () => {
  it('shows the column, the group figure and the totals figure', () => {
    render(
      <SummaryTable
        groups={[makeGroup({ orders: 2, partySize: 6, partySizeMissing: 0 })]}
        selectedKey={null}
        onSelect={vi.fn()}
        totals={TOTALS}
        today="2026-10-13"
      />,
    )
    expect(screen.getByRole('columnheader', { name: '人数' })).toBeTruthy()
    // group row and totals row carry different figures, so a mix-up between them fails here
    expect(screen.getAllByText('6')).toHaveLength(1)
    expect(screen.getAllByText('15（另 1 单未填）')).toHaveLength(1)
  })
})

describe('OrdersTable 人数', () => {
  it('shows the number when known and 未填 when null', () => {
    render(
      <OrdersTable
        clientId="c1"
        rows={[
          makeRow({ bookingId: 'b1', contactId: 'k1', contactName: '甲', partySize: 7 }),
          makeRow({ bookingId: 'b2', contactId: 'k2', contactName: '乙', partySize: null }),
          makeRow({ bookingId: 'b3', contactId: 'k3', contactName: '丙', status: 'cancelled', partySize: 99 }),
        ]}
        today="2026-10-13"
        page={1}
        pageCount={1}
        total={3}
        emptyText="无"
        refreshing={false}
        onPage={vi.fn()}
        onOpenRow={vi.fn()}
      />,
    )
    expect(screen.getByRole('columnheader', { name: '人数' })).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('未填')).toBeTruthy()
    // a cancelled row never shows a head-count, even if the data carried one
    expect(screen.queryByText('99')).toBeNull()
  })
})

describe('parseOverviewPayload with party size', () => {
  it('accepts a full payload', () => {
    expect(parseOverviewPayload(JSON.parse(JSON.stringify(makePayload())))).not.toBeNull()
  })

  it('rejects a group without partySize rather than defaulting it', () => {
    const body = JSON.parse(JSON.stringify(makePayload())) as { summary: { groups: Array<Record<string, unknown>> } }
    const first = body.summary.groups[0]
    if (first === undefined) throw new Error('fixture has no group')
    delete first.partySize
    expect(parseOverviewPayload(body)).toBeNull()
  })

  it('rejects totals without partySizeMissing', () => {
    const body = JSON.parse(JSON.stringify(makePayload())) as { summary: { totals: Record<string, unknown> } }
    delete body.summary.totals.partySizeMissing
    expect(parseOverviewPayload(body)).toBeNull()
  })

  it('accepts a row with partySize null but rejects one where it is missing', () => {
    const ok = JSON.parse(JSON.stringify(makePayload({ list: { rows: [makeRow({ partySize: null })], page: 1, pageCount: 1, total: 1 } })))
    expect(parseOverviewPayload(ok)).not.toBeNull()
    const bad = JSON.parse(JSON.stringify(makePayload({ list: { rows: [makeRow({ partySize: null })], page: 1, pageCount: 1, total: 1 } }))) as {
      list: { rows: Array<Record<string, unknown>> }
    }
    const row = bad.list.rows[0]
    if (row === undefined) throw new Error('no row')
    delete row.partySize
    expect(parseOverviewPayload(bad)).toBeNull()
  })
})
