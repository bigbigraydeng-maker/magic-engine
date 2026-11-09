/**
 * 月结区块：试算只显示不保存；批准前二次确认并发 approve；已付 / 作废行没有按钮。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatementsCard } from '../statements-card'

const COMPUTED = { id: 'st-2', period_month: '2026-11-01', status: 'computed', total_payable_cents: 260_000, computed_at: '2026-12-01T00:00:00Z', approved_by: null, approved_at: null, paid_at: null, balances: [{ distributor_id: 'd-1', opening_cents: 0, period_cents: 260_000, payout_cents: 260_000, closing_cents: 0 }] }
const PAID = { ...COMPUTED, id: 'st-1', period_month: '2026-10-01', status: 'paid', approved_by: 'pm@x' }

function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const json = !init
      ? { statements: [COMPUTED, PAID] }
      : body?.dry_run === true
        ? { result: { month: body.month, dryRun: true, statementId: null, totalPayableCents: 123_400, salesSettled: 5, lines: 9, distributorsPaid: 2 } }
        : { statement: { ...COMPUTED, status: 'approved' } }
    return { ok: true, json: async () => json, url }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('statements card', () => {
  it('dry run shows the totals and says nothing was saved', async () => {
    const fetchMock = mockApi()
    render(<StatementsCard distributors={[]} />)
    await userEvent.click(await screen.findByRole('button', { name: '试算（不保存）' }))
    expect(await screen.findByText(/应付合计 \$1234\.00/)).toBeTruthy()
    expect(screen.getByText(/没有保存/)).toBeTruthy()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ dry_run: true })
  })

  it('asks before approving and sends approve for that statement', async () => {
    const fetchMock = mockApi()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    render(<StatementsCard distributors={[]} />)
    await userEvent.click(await screen.findByRole('button', { name: '批准付款' }))
    expect(confirm).toHaveBeenCalledWith('确定批准 2026-11 的月结？合计 $2600.00。')
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/admin/distributors/statements/st-2')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ action: 'approve' })
  })

  it('shows no action buttons on a paid statement', async () => {
    mockApi()
    render(<StatementsCard distributors={[]} />)
    const paidRow = (await screen.findByText('已付')).closest('tr') as HTMLElement
    expect(within(paidRow).queryByRole('button', { name: '批准付款' })).toBeNull()
    expect(within(paidRow).queryByRole('button', { name: '作废' })).toBeNull()
  })
})
