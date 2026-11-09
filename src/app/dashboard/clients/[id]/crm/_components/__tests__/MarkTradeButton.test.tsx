import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MarkTradeButton, markDomainAsTrade } from '../MarkTradeButton'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mockFetch(tradeDomains: string[], patchOk = true) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (init?.method === 'PATCH') return { ok: patchOk, json: async () => ({}) }
    return { ok: true, json: async () => ({ config: { tradeDomains } }) }
  }))
  return calls
}

describe('MarkTradeButton（PM 2026-10-29：员工自己把同行标出来）', () => {
  it('私人邮箱（Gmail / xtra）不出按钮 —— 不能把所有用 Gmail 的客人一起扔出名单', () => {
    render(<MarkTradeButton clientId="c1" email="bright2c@gmail.com" onDone={() => undefined} />)
    expect(screen.queryByTestId('mark-trade')).toBeNull()
    render(<MarkTradeButton clientId="c1" email="a@xtra.co.nz" onDone={() => undefined} />)
    expect(screen.queryByTestId('mark-trade')).toBeNull()
  })

  it('公司邮箱 → 确认后把域名追加进原有同行名单（不覆盖别的）', async () => {
    const calls = mockFetch(['hot.co.nz'])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDone = vi.fn()
    render(<MarkTradeButton clientId="c1" email="Sunita@FineTravel.co.nz" onDone={onDone} />)
    fireEvent.click(screen.getByTestId('mark-trade'))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch?.url).toBe('/api/clients/c1/leads-config')
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ tradeDomains: ['hot.co.nz', 'finetravel.co.nz'] })
    expect(screen.getByText('✓ 已是同行')).toBeTruthy()
  })

  it('点了取消 → 什么都不写', () => {
    const calls = mockFetch([])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MarkTradeButton clientId="c1" email="x@agency.co.nz" onDone={() => undefined} />)
    fireEvent.click(screen.getByTestId('mark-trade'))
    expect(calls).toHaveLength(0)
  })

  it('已经在名单里 → 不再写', async () => {
    const calls = mockFetch(['agency.co.nz'])
    const r = await markDomainAsTrade('c1', 'agency.co.nz')
    expect(r.ok).toBe(true)
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false)
  })

  it('存失败 → 说没存上，按钮还能重试', async () => {
    mockFetch([], false)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDone = vi.fn()
    render(<MarkTradeButton clientId="c1" email="x@agency.co.nz" onDone={onDone} />)
    fireEvent.click(screen.getByTestId('mark-trade'))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('没存上，稍后再试'))
    expect(screen.getByTestId('mark-trade').textContent).toContain('重试')
  })
})
