import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

import AutonomySettings from '../autonomy-settings'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const config = {
  daily_budget_cap_cents: 15000,
  autonomy_mode: 'observe',
  creative_pool: [
    { kind: 'meta_video', ref: '111', status: 'candidate' },
    { kind: 'meta_video', ref: '222', status: 'candidate' },
  ],
}

function stubFetch() {
  const fn = vi.fn(async (url: string) => {
    if (url.endsWith('/labels')) {
      return Response.json({
        labels: { '111': { title: 'Best of China', subtitle: '15-second reel', publishedAt: '2026-10-11T08:05:56Z', url: 'https://www.facebook.com/reel/111' } },
      })
    }
    return Response.json({ success: true, config })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/**
 * 账户级日上限那段界面的替身：`/ad-accounts` 返回两个账户 + 客户总闸，
 * `daily-cap` 的 PATCH 由各用例自己决定成功还是被拒。
 */
function stubFetchWithAccounts(patch: (url: string) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/labels')) return Response.json({ labels: {} })
    if (url.endsWith('/daily-cap') && init?.method === 'PATCH') return patch(url)
    if (url.endsWith('/ad-accounts')) {
      return Response.json({
        accounts: [
          { ad_account_id: 'act_111', daily_budget_cap_cents: 4000 },
          { ad_account_id: 'act_222', daily_budget_cap_cents: null },
        ],
        client_total_cap_cents: 15000,
      })
    }
    return Response.json({ success: true, config })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('AutonomySettings · 每个广告账户各自的日上限', () => {
  it('逐个账户列出来，钱按元显示，没填的写「未设」，并显示客户总闸', async () => {
    stubFetchWithAccounts(() => Response.json({ daily_budget_cap_cents: 4000 }))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('act_111')).toBeTruthy())
    expect(screen.getByText('act_222')).toBeTruthy()
    expect(screen.getByDisplayValue('40')).toBeTruthy()
    expect(screen.getByText(/\$40 \/ 天/)).toBeTruthy()
    expect(screen.getByText('未设')).toBeTruthy()
    expect(screen.getByText('各账户加起来不能超过客户总闸；超了保存会被拒绝')).toBeTruthy()
  })

  it('保存时把元换成分，PATCH 发到那个账户自己的唯一入口', async () => {
    const fn = stubFetchWithAccounts(() => Response.json({ daily_budget_cap_cents: 10000 }))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('act_222')).toBeTruthy())
    const inputs = screen.getAllByPlaceholderText('未设')
    fireEvent.change(inputs[inputs.length - 1], { target: { value: '100' } })
    fireEvent.click(screen.getAllByText('保存')[1])
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    const call = fn.mock.calls.find(c => String(c[0]).includes('/ad-accounts/act_222/daily-cap'))
    expect(call).toBeTruthy()
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ daily_budget_cap_cents: 10000 })
  })

  it('后端拒绝时原文照显示，不换成自己的话术', async () => {
    const backendError = '这个客户所有账户的日上限加起来会变成 20000 分，超过客户总闸 15000 分（其它账户合计 4000 分）。先降低这个账户或其它账户的上限，或者先把客户总闸调大。'
    stubFetchWithAccounts(() => Response.json({ error: backendError }, { status: 400 }))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('act_222')).toBeTruthy())
    const inputs = screen.getAllByPlaceholderText('未设')
    fireEvent.change(inputs[inputs.length - 1], { target: { value: '160' } })
    fireEvent.click(screen.getAllByText('保存')[1])
    await waitFor(() => expect(screen.getByText(backendError)).toBeTruthy())
  })

  it('读不到上限时只出红字，不渲染任何输入框（免得把真实值存成空白）', async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (url.endsWith('/ad-accounts')) return Response.json({ error: 'boom' }, { status: 500 })
      return Response.json({ success: true, config })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() =>
      expect(screen.getByText('读不到各账户的每天上限，没有显示输入框（怕把真实值存成空白）')).toBeTruthy(),
    )
    // 页面上只剩客户总闸那一个输入框（占位字同样是「未设」）；账户段一个都没渲染
    expect(screen.getAllByPlaceholderText('未设')).toHaveLength(1)
    expect(fn.mock.calls.some(c => String(c[0]).includes('/daily-cap'))).toBe(false)
  })
})

describe('AutonomySettings', () => {
  it('shows plain-language labels, dollars instead of cents, and video names', async () => {
    stubFetch()
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    expect(screen.getByDisplayValue('150')).toBeTruthy()
    expect(screen.getByText(/\$150 \/ 天/)).toBeTruthy()
    expect(screen.getByText('在每天上限内自动调整预算 / 暂停广告（需要先设好上面的每天上限）')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Best of China')).toBeTruthy())
    expect(screen.getByText('未能识别，请核对')).toBeTruthy()
    expect(document.body.textContent).not.toContain('素材池')
    expect(document.body.textContent).not.toContain('信封')
  })

  it('asks for confirmation before approving and does not call approve when declined', async () => {
    const fn = stubFetch()
    vi.stubGlobal('confirm', vi.fn(() => false))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getAllByText('批准').length).toBe(2))
    fireEvent.click(screen.getAllByText('批准')[0])
    expect(window.confirm).toHaveBeenCalledWith('批准后这条视频才允许用于广告。不会自动开广告、不花钱。')
    expect(fn.mock.calls.some(c => String(c[0]).includes('/approve'))).toBe(false)
  })
})
