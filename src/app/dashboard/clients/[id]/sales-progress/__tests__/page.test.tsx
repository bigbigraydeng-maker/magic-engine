import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextResponse } from 'next/server'

const requireBookingAccess = vi.fn()
const loadSalesProgress = vi.fn()

vi.mock('@/lib/crm/booking-access', () => ({
  requireBookingAccess: (...a: unknown[]) => requireBookingAccess(...a),
}))
vi.mock('@/lib/crm/sales-progress/load', () => ({
  loadSalesProgress: (...a: unknown[]) => loadSalesProgress(...a),
}))
vi.mock('@/lib/crm/sales-progress/units', () => ({ createDepartureUnitSource: () => ({}) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('../../crm/_components/CrmTabs', () => ({
  CrmTabs: ({ active }: { active: string }) => <div data-testid="tabs">{active}</div>,
}))

import SalesProgressPage from '../page'

const denied = (status: number) => ({ ok: false, response: NextResponse.json({ error: 'x' }, { status }) })

async function renderPage() {
  render(await SalesProgressPage({ params: { id: 'cts' } }))
}

const DATA = {
  generatedAt: '2026-10-13T01:00:00Z',
  originColumnsMissing: false,
  result: { rows: [], onClosedUnits: [], unattributedOrders: 0, unattributedPeople: 0, activeOrders: 0 },
}

beforeEach(() => {
  requireBookingAccess.mockReset()
  loadSalesProgress.mockReset()
})

describe('销售进度页', () => {
  it('🔴 先过名单闸（view）；没权限提示没有权限，根本不去取数', async () => {
    requireBookingAccess.mockResolvedValue(denied(403))
    await renderPage()
    expect(requireBookingAccess).toHaveBeenCalledWith('cts', 'view')
    expect(screen.getByText('你的账号没有查看这一页的权限。')).toBeInTheDocument()
    expect(loadSalesProgress).not.toHaveBeenCalled()
  })

  it('未登录 401 同样提示没有权限；订单与付款没开通（404）给另一句；别的失败说暂时打不开', async () => {
    requireBookingAccess.mockResolvedValue(denied(401))
    await renderPage()
    expect(screen.getByText('你的账号没有查看这一页的权限。')).toBeInTheDocument()
  })

  it('404（这个客户没开通订单与付款）→ 提示还没有开通，不取数', async () => {
    requireBookingAccess.mockResolvedValue(denied(404))
    await renderPage()
    expect(screen.getByText('这个客户还没有开通这一页。')).toBeInTheDocument()
    expect(loadSalesProgress).not.toHaveBeenCalled()
  })

  it('500 → 暂时打不开', async () => {
    requireBookingAccess.mockResolvedValue(denied(500))
    await renderPage()
    expect(screen.getByText(/暂时打不开/)).toBeInTheDocument()
  })

  it('🔴 读数据失败 → 说「暂时打不开」，不能说「没有订单」', async () => {
    requireBookingAccess.mockResolvedValue({ ok: true })
    loadSalesProgress.mockRejectedValue(new Error('db down'))
    await renderPage()
    expect(screen.getByText(/暂时打不开/)).toBeInTheDocument()
    expect(screen.queryByText(/还没有录入任何订单/)).toBeNull()
  })

  it('有权限且读到数据 → 画表格；页签标记为销售进度；取数用的是路由里的客户 id', async () => {
    requireBookingAccess.mockResolvedValue({ ok: true })
    loadSalesProgress.mockResolvedValue(DATA)
    await renderPage()
    expect(loadSalesProgress.mock.calls[0][1]).toBe('cts')
    expect(requireBookingAccess.mock.invocationCallOrder[0]).toBeLessThan(loadSalesProgress.mock.invocationCallOrder[0])
    expect(screen.getByTestId('tabs')).toHaveTextContent('sales')
    expect(screen.getByText(/现在还没有录入任何订单/)).toBeInTheDocument()
  })
})
