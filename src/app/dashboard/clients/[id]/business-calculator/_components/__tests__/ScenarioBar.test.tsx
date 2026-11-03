/**
 * 场景栏：覆盖保存必须带「用户看到的那一版」的版本锁（别人在这期间改过 → 409，不能静默盖掉），
 * 删除别人已删的场景要把残留清掉。假 fetch 按路径与方法应答，并记录收到的请求。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScenarioBar } from '../ScenarioBar'
import type { ScenarioRow } from '../ComparePanel'
import { DEFAULT_INPUTS } from '@/lib/crm/industry/travel-business-calculator'

const SEEN: ScenarioRow = {
  id: 's1', name: '旺季方案', inputs: { ...DEFAULT_INPUTS }, formula_version: 1,
  created_by: 'a@b', created_at: '2026-10-15T00:00:00.000000+00:00', updated_at: '2026-10-15T00:00:00.000000+00:00',
}

type Call = { url: string; method: string; body: unknown }
let calls: Call[]
let listResponse: ScenarioRow[]
let patchStatus: number
let deleteStatus: number

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  calls = []
  listResponse = [SEEN]
  patchStatus = 200
  deleteStatus = 200
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET') return json(200, { success: true, scenarios: listResponse })
    if (method === 'POST') return json(409, { error: '已有同名场景', code: 'duplicate_name' })
    if (method === 'PATCH') {
      return patchStatus === 200
        ? json(200, { success: true, scenario: { ...SEEN, updated_at: '2026-10-16T00:00:00.000000+00:00' } })
        : json(patchStatus, { error: 'stale', code: 'stale' })
    }
    if (method === 'DELETE') return deleteStatus === 200 ? json(200, { success: true }) : json(deleteStatus, { code: 'not_found' })
    return json(500, {})
  }))
  vi.stubGlobal('confirm', vi.fn(() => true))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount(onDeleted = vi.fn(), onSaved = vi.fn()) {
  render(
    <ScenarioBar
      clientId="c1" currentInputs={DEFAULT_INPUTS} dirty={false} loaded={null}
      onLoad={vi.fn()} onSaved={onSaved} onDeleted={onDeleted}
    />,
  )
  return { onDeleted, onSaved }
}

async function saveWithName(name: string): Promise<void> {
  await screen.findByText('旺季方案')
  fireEvent.change(screen.getByPlaceholderText(/场景名/), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: '保存当前' }))
}

describe('ScenarioBar', () => {
  it('同名覆盖：PATCH 带的是用户看到的那一版 updated_at，确认后不再偷偷换成最新版', async () => {
    mount()
    await saveWithName('旺季方案')
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH')).toBe(true))
    const patch = calls.find(c => c.method === 'PATCH')
    expect((patch?.body as { expected_updated_at: string }).expected_updated_at).toBe(SEEN.updated_at)
    // 确认弹窗之后到 PATCH 之前，没有再取一次列表
    const patchIndex = calls.findIndex(c => c.method === 'PATCH')
    const getsBetween = calls.slice(calls.findIndex(c => c.method === 'POST'), patchIndex).filter(c => c.method === 'GET')
    expect(getsBetween).toHaveLength(0)
  })

  it('覆盖时服务端回 stale（别人刚改过）→ 提示并刷新，不当成功', async () => {
    patchStatus = 409
    const { onSaved } = mount()
    await saveWithName('旺季方案')
    await screen.findByText(/刚刚在别处被改过/)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('用户在弹窗里取消 → 不发 PATCH', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    mount()
    await saveWithName('旺季方案')
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    expect(calls.some(c => c.method === 'PATCH')).toBe(false)
  })

  it('删除时已被别人删（404）→ 通知上层清掉当前场景，并提示', async () => {
    deleteStatus = 404
    const { onDeleted } = mount()
    await screen.findByText('旺季方案')
    fireEvent.click(screen.getByRole('button', { name: /删除/ }))
    await screen.findByText('该场景已被删除')
    expect(onDeleted).toHaveBeenCalledWith('s1')
  })

  it('已载入的场景再保存：直接按载入时的版本覆盖，不问「同名」，也不先 POST', async () => {
    const onSaved = vi.fn()
    render(
      <ScenarioBar
        clientId="c1" currentInputs={DEFAULT_INPUTS} dirty loaded={SEEN}
        onLoad={vi.fn()} onSaved={onSaved} onDeleted={vi.fn()} onRenamed={vi.fn()}
      />,
    )
    await waitFor(() => expect(calls.some(c => c.method === 'GET')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '保存当前' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    const patch = calls.find(c => c.method === 'PATCH')
    expect((patch?.body as { expected_updated_at: string }).expected_updated_at).toBe(SEEN.updated_at)
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('有数字不能保存时按钮不可用，且不发任何写请求', async () => {
    render(
      <ScenarioBar
        clientId="c1" currentInputs={DEFAULT_INPUTS} dirty={false} loaded={null}
        onLoad={vi.fn()} onSaved={vi.fn()} saveBlockedReason="字段 tourPrice 必须是 0 到 10 亿之间的数字——这组数字暂时不能保存"
      />,
    )
    await screen.findByText('旺季方案')
    const save = screen.getByRole('button', { name: '保存当前' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(calls.filter(c => c.method !== 'GET')).toHaveLength(0)
  })
})
