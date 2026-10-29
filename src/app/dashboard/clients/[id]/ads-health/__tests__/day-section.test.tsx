import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BreakdownPanel from '../breakdown-panel'
import type { BreakdownReport, ReportRow } from '@/lib/ads-strategy/breakdown-stats/report-types'

// recharts' ResponsiveContainer only renders its children once it measures a non-zero size.
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { width: 600, height: 300, top: 0, left: 0, right: 600, bottom: 300, x: 0, y: 0, toJSON() { return {} } } as DOMRect,
  )
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const row = (key: string, spend: number, leads: number): ReportRow => ({
  key, spend, impressions: 1000, clicks: 30, leads,
  costPerLead: leads > 0 ? spend / leads : null, expectedLeads: null, flag: null, spendShare: 0,
})

const report: BreakdownReport = {
  window: { since: '2026-10-26', until: '2026-10-28', days: 3 },
  accounts: [{ adAccountId: 'act_1', currency: 'NZD', timezone: 'Pacific/Auckland', latestStatDate: '2026-10-28', lastFetchedAt: null }],
  totals: {
    spendAll: 170, spendLeadObjective: 170, impressionsLeadObjective: 3000, clicksLeadObjective: 90, metaLeads: 11, crmLeads: 11,
    matchRate: 1, costPerCrmLead: 15, crmLeadsUnmatched: 0,
  },
  nonLeadSpend: [], hour: [], weekday: [], placement: [], device: [], ageGender: [], region: [],
  day: [row('2026-10-28', 100, 9), row('2026-10-27', 60, 2), row('2026-10-26', 10, 0)],
}

function mockReport() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ success: true, report }) }))
}

describe('「按天」切换', () => {
  it('默认是表格，能切到柱状图和走势图，再切回表格', async () => {
    mockReport()
    render(<BreakdownPanel clientId="c" />)
    expect(await screen.findByRole('button', { name: '柱状图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '表格' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('10-28 周三')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '柱状图' }))
    expect(screen.getByText('每天花费')).toBeTruthy()
    expect(screen.getByText(/每天进线/)).toBeTruthy()
    expect(screen.queryByText('10-28 周三')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '走势图' }))
    expect(screen.getByText(/当天没有进线就断开，不画成 0/)).toBeTruthy()
    expect(screen.queryByText('每天花费')).toBeNull()
    expect(screen.queryByText('10-28 周三')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '表格' }))
    await waitFor(() => expect(screen.getByText('10-28 周三')).toBeTruthy())
  })
})
