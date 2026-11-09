/** 经销商自己的页面：没登录显示「链接已失效」；登录后看到自己的名字、等级、月结。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PartnerPage from '../page'

const VIEW = {
  profile: { display_name: '李经理', status: 'approved', level: 'tier1', approved_at: '2026-10-01T00:00:00Z' },
  upgrade: { next: null, selfPurchaseBestCents: 0, selfPurchaseTargetCents: 1_598_000, directSalesCents: 0, directSalesTargetCents: 2_397_000, recentTeamMonths: [{ month: '2026-10', team_sales_cents: 16_000_000 }], premierMonthlyTargetCents: 15_000_000, directTier1: 1, directTier1Target: 2 },
  team: { direct: [{ display_name: '王小明', level: 'standard', status: 'approved' }], total: 3 },
  sales: [],
  statements: [{ month: '2026-10', status: 'paid', payout_cents: 260_000, closing_cents: 0, opening_cents: 0, retail_cents: 200_000, peer_cents: 0, team_cents: 60_000 }],
}

function mockMe(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status === 200, status, json: async () => body })))
}

afterEach(() => vi.unstubAllGlobals())

describe('partner page', () => {
  it('asks for a new link when there is no portal session', async () => {
    mockMe(401, { error: 'Not signed in' })
    render(<PartnerPage />)
    expect(await screen.findByText('登录链接已失效')).toBeTruthy()
  })

  it('shows the distributor their own name, level, team and statements', async () => {
    mockMe(200, VIEW)
    render(<PartnerPage />)
    expect(await screen.findByText(/李经理/)).toBeTruthy()
    expect(screen.getAllByText(/一级经销商/).length).toBeGreaterThan(0)
    expect(screen.getByText(/团队一共 3 人/)).toBeTruthy()
    expect(screen.getAllByText('$2600.00').length).toBeGreaterThan(0)
  })
})
