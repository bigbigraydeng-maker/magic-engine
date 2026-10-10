/**
 * BudgetPolicyPanel — 客户广告预算管控设置面板。
 *
 * 盯三件事：no_row 时界面要亮出「已锁定」的安全兜底提示；读失败不能渲染成空表单
 * 诱导误存；保存时把界面上的主单位金额换算成分再提交。
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BudgetPolicyPanel } from '../BudgetPolicyPanel'

const CLIENT_ID = 'client-uuid-budget-policy-test'

function mockFetchOnce(payload: unknown, opts: { ok?: boolean; status?: number } = {}) {
  global.fetch = vi.fn(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => payload,
  } as Response)) as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BudgetPolicyPanel', () => {
  it('fetches from the budget-policy endpoint', async () => {
    mockFetchOnce({ policy: { locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null }, source: 'no_row' })
    render(<BudgetPolicyPanel clientId={CLIENT_ID} />)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/ad-budget-policy`)
    })
  })

  it('no_row → 显示「已锁定」安全兜底提示，勾选框勾中', async () => {
    mockFetchOnce({ policy: { locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null }, source: 'no_row' })
    render(<BudgetPolicyPanel clientId={CLIENT_ID} />)

    await waitFor(() => expect(screen.getByText(/预算已锁定/)).toBeInTheDocument())
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('read_error → 不渲染表单，只显示读不到的提示（免得盖掉没看见的旧值）', async () => {
    mockFetchOnce({ policy: { locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null }, source: 'read_error' })
    render(<BudgetPolicyPanel clientId={CLIENT_ID} />)

    await waitFor(() => expect(screen.getByText(/暂时读不到/)).toBeInTheDocument())
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument()
  })

  it('row 且 locked:false → 回填两个上限（分换算成主单位显示）', async () => {
    mockFetchOnce({ policy: { locked: false, totalDailyCapMinor: 50000, perUnitDailyChangeCapPct: 15 }, source: 'row' })
    render(<BudgetPolicyPanel clientId={CLIENT_ID} />)

    const totalInput = await screen.findByPlaceholderText('例如 500')
    expect(totalInput).toHaveValue(500) // 50000 分 = 500 元
    expect(screen.getByPlaceholderText('例如 20')).toHaveValue(15)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('保存时把主单位金额换算成分，勾选状态原样提交', async () => {
    mockFetchOnce({ policy: { locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null }, source: 'no_row' })
    render(<BudgetPolicyPanel clientId={CLIENT_ID} />)

    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox) // 解锁

    const totalInput = screen.getByPlaceholderText('例如 500')
    fireEvent.change(totalInput, { target: { value: '500' } })
    const pctInput = screen.getByPlaceholderText('例如 20')
    fireEvent.change(pctInput, { target: { value: '20' } })

    const patchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, policy: { locked: false, totalDailyCapMinor: 50000, perUnitDailyChangeCapPct: 20 }, source: 'row' }),
    } as Response))
    global.fetch = patchSpy as typeof fetch

    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(
        `/api/clients/${CLIENT_ID}/ad-budget-policy`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ budget_locked: false, total_daily_cap_minor: 50000, per_unit_daily_change_cap_pct: 20 }),
        }),
      )
    })
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeInTheDocument())
  })

  it('非内部员工保存被拒（403）→ 显示对应人话提示', async () => {
    mockFetchOnce({ policy: { locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null }, source: 'no_row' })
    render(<BudgetPolicyPanel clientId={CLIENT_ID} />)

    await screen.findByRole('checkbox')
    mockFetchOnce({ error: 'Forbidden' }, { ok: false, status: 403 })

    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => {
      expect(screen.getByText('只有 Magic Engine 内部同事能改这项。')).toBeInTheDocument()
    })
  })

  it('变动上限填超过 100 → 本地校验拦下，不发请求', async () => {
    mockFetchOnce({ policy: { locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null }, source: 'no_row' })
    render(<BudgetPolicyPanel clientId={CLIENT_ID} />)

    await screen.findByRole('checkbox')
    const pctInput = screen.getByPlaceholderText('例如 20')
    fireEvent.change(pctInput, { target: { value: '150' } })

    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as typeof fetch

    fireEvent.click(screen.getByRole('button', { name: /保存/ }))

    await waitFor(() => {
      expect(screen.getByText(/0 到 100 之间的百分比/)).toBeInTheDocument()
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
