import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'client-1' }) }))

import { BlankDraftPlanButton } from '../_components/BlankDraftPlanButton'
import { PromoPlanClient } from '../_client'

const DRAFT = {
  id: 'goal-draft',
  title: 'CTS11月China Tour推广',
  status: 'draft',
  period_start: '2026-10-25',
  period_end: '2026-11-30',
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('新建空白草稿计划按钮', () => {
  it('推广计划页上看得到这个按钮', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, plans: [] })))
    render(<PromoPlanClient />)
    expect(await screen.findByRole('button', { name: '新建空白草稿计划' })).toBeTruthy()
  })

  it('先选目标再确认；请求里只有目标编号，没有示例标题', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/goals')) return jsonResponse({ goals: [DRAFT] })
      return jsonResponse({ success: true, plan: { id: 'plan-new' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onCreated = vi.fn()
    render(<BlankDraftPlanButton clientId="client-1" onCreated={onCreated} />)

    fireEvent.click(screen.getByRole('button', { name: '新建空白草稿计划' }))
    const select = await screen.findByLabelText('选择目标')
    expect((select as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('button', { name: '确认新建' })).toBeDisabled()
    expect(screen.queryByText(/春节后促销/)).toBeNull()

    fireEvent.change(select, { target: { value: 'goal-draft' } })
    expect(screen.getByText(/将挂到：CTS11月China Tour推广（草稿/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认新建' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('plan-new'))
    const post = fetchMock.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'POST')
    expect(post?.[0]).toBe('/api/clients/client-1/marketing-plan')
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ goal_id: 'goal-draft' })
  })

  it('取消不会提交', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ goals: [DRAFT] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<BlankDraftPlanButton clientId="client-1" onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '新建空白草稿计划' }))
    await screen.findByLabelText('选择目标')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(fetchMock.mock.calls.some(call => (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(false)
    expect(screen.getByRole('button', { name: '新建空白草稿计划' })).toBeTruthy()
  })
})
