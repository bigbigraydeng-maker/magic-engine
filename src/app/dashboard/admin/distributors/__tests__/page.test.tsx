/**
 * 经销商管理页：列表、等级/状态中文、价目表金额、批准前二次确认并调对接口、退款按钮只出现在非退款行。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DistributorsPage from '../page'

const PENDING = { id: 'd-1', parent_id: null, display_name: '王小明', contact_email: null, contact_phone: null, status: 'pending', approved_by: null, approved_at: null, created_at: '2026-11-10T00:00:00Z', level: null, parent_name: null, net_sales_cents: 0 }
const APPROVED = { ...PENDING, id: 'd-2', display_name: '李经理', status: 'approved', approved_by: 'pm@x', approved_at: '2026-11-01T00:00:00Z', level: 'tier1', net_sales_cents: 159_800 }
const SALE = { id: 's-1', distributor_id: 'd-2', kind: 'plan', order_ref: 'INV-9', plan_code: 'videos-16', months: 2, extra_avatars: 0, amount_cents: 159_800, currency: 'NZD', paid_at: '2026-11-05T00:00:00Z', is_self_purchase: false, refund_of_sale_id: null, recorded_by: 'pm@x', created_at: '2026-11-05T00:00:00Z' }
const REFUND = { ...SALE, id: 's-2', kind: 'refund', order_ref: 'INV-9-退款', amount_cents: -79_900, refund_of_sale_id: 's-1' }
const CATALOG = { plans: [{ code: 'videos-6', videosPerMonth: 6, monthlyCents: 39_900 }, { code: 'videos-16', videosPerMonth: 16, monthlyCents: 79_900 }], includedAvatars: 3, extraAvatarOneTimeCents: 10_000 }

function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = url.endsWith('/statements') && !init
      ? { statements: [] }
      : url.endsWith('/sales') && !init
        ? { sales: [SALE, REFUND], catalog: CATALOG }
        : init?.method === 'POST'
          ? { distributor: { ...PENDING, status: 'approved' } }
          : { distributors: [PENDING, APPROVED] }
    return { ok: true, json: async () => json }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('distributors admin page', () => {
  it('lists distributors with Chinese level and status labels', async () => {
    mockApi()
    render(<DistributorsPage />)
    expect(await screen.findByText('王小明')).toBeTruthy()
    expect(screen.getByText('待审批')).toBeTruthy()
    expect(screen.getByText('一级')).toBeTruthy()
    expect(screen.getAllByText('$1598.00').length).toBeGreaterThan(0)
  })

  it('asks for confirmation before approving, then posts the decision', async () => {
    const fetchMock = mockApi()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    render(<DistributorsPage />)
    await userEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(confirm).toHaveBeenCalledWith('确定批准「王小明」成为经销商？')
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[0]).toBe('/api/admin/distributors/d-1/decision')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ decision: 'approve' })
  })

  it('does not post when the confirmation is cancelled', async () => {
    const fetchMock = mockApi()
    vi.stubGlobal('confirm', vi.fn(() => false))
    render(<DistributorsPage />)
    await userEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('shows sale content, refunds in the list, and a refund button only on real sales', async () => {
    mockApi()
    render(<DistributorsPage />)
    const saleCell = await screen.findByText('16条/月 × 2 个月')
    const saleRow = saleCell.closest('tr') as HTMLElement
    expect(within(saleRow).getByRole('button', { name: '退款' })).toBeTruthy()
    const refundRow = screen.getByText('INV-9-退款').closest('tr') as HTMLElement
    expect(within(refundRow).getByText('-$799.00')).toBeTruthy()
    expect(within(refundRow).queryByRole('button', { name: '退款' })).toBeNull()
  })
})
