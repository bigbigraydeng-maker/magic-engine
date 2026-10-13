/**
 * Wording of the hidden-groups note after the server's round-2 change: hidden groups now include
 * ones that only have offline-handled items left, so 「已收齐」 must not be claimed for them.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SummaryFooter } from '../SummaryFooter'
import { parsePaymentsQuery, STATUS_OPTIONS } from '../payments-query'

const notes = { offlineHandledOrders: 0, snoozedOrders: 0, cancelledOrders: 0 }

function footer(over: Partial<React.ComponentProps<typeof SummaryFooter>> = {}) {
  return render(
    <SummaryFooter
      notes={notes}
      hiddenGroupCount={2}
      hiddenOrders={3}
      hiddenOfflineOnlyGroups={0}
      includePastPaid={false}
      onToggleIncludePastPaid={vi.fn()}
      {...over}
    />,
  )
}

afterEach(cleanup)

describe('SummaryFooter hidden-groups note', () => {
  it('says 已收齐 only when every hidden group is really settled', () => {
    footer()
    expect(screen.getByText('另有 2 个已出发且已收齐的出发日期没显示')).toBeTruthy()
    expect(screen.getByText('没显示的这些共 3 单，不在上面的合计里')).toBeTruthy()
  })

  it('does not claim 已收齐 when some hidden groups only have offline-handled items left', () => {
    footer({ hiddenOfflineOnlyGroups: 1 })
    expect(screen.queryByText(/已出发且已收齐/)).toBeNull()
    expect(
      screen.getByText('另有 2 个已出发的出发日期没显示（其中 1 个只剩线下已处理的款，没有要催的）'),
    ).toBeTruthy()
  })

  it('shows no hidden-order sentence when nothing is hidden', () => {
    footer({ hiddenGroupCount: 0, hiddenOrders: 0 })
    expect(screen.queryByText(/没显示的这些共/)).toBeNull()
  })

  it('toggle reports the opposite of the current value', () => {
    const onToggle = vi.fn()
    footer({ onToggleIncludePastPaid: onToggle })
    fireEvent.click(screen.getByRole('button', { name: '也看已收齐的过去出发' }))
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})

describe('status filter values follow the server', () => {
  it('offers 线下已处理 and parses status=offline', () => {
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual(['all', 'unsettled', 'settled', 'offline', 'cancelled'])
    expect(STATUS_OPTIONS.find((o) => o.value === 'offline')?.label).toBe('线下已处理')
    expect(parsePaymentsQuery(new URLSearchParams('status=offline')).status).toBe('offline')
  })
})
