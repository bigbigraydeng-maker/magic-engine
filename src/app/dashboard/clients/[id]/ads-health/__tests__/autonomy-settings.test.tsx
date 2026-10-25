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
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
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

  it('回填用的是后端返回的值，不是我们请求的值', async () => {
    // 后端故意回一个与请求不同的数（真实路由会夹紧 / 改写），界面必须显示后端那个。
    stubFetchWithAccounts(() => Response.json({ ad_account_id: 'act_222', daily_budget_cap_cents: 7000 }))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('act_222')).toBeTruthy())
    const inputs = screen.getAllByPlaceholderText('未设')
    fireEvent.change(inputs[inputs.length - 1], { target: { value: '100' } })
    fireEvent.click(screen.getAllByText('保存')[1])
    await waitFor(() => expect(screen.getByText(/\$70 \/ 天/)).toBeTruthy())
    expect(screen.queryByText(/\$100 \/ 天/)).toBeNull()
  })

  it('清空上限要二次确认；点取消就不发请求', async () => {
    const fn = stubFetchWithAccounts(() => Response.json({ daily_budget_cap_cents: null }))
    const confirmSpy = vi.fn<typeof window.confirm>(() => false)
    vi.stubGlobal('confirm', confirmSpy)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('act_111')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('40'), { target: { value: '' } })
    fireEvent.click(screen.getAllByText('保存')[0])
    // 这个替身绑了 2 个账户，所以走的是「不许自动动钱」那条，不是单账户的「回落」
    expect(String(confirmSpy.mock.calls[0]?.[0] ?? '')).toContain('不允许自动动钱')
    expect(fn.mock.calls.some(c => String(c[0]).includes('/daily-cap'))).toBe(false)
  })

  it('只绑 1 个账户时，清空的确认话要说明会回落成客户总闸（这是放宽）', async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (url.endsWith('/ad-accounts')) {
        return Response.json({
          accounts: [{ ad_account_id: 'act_111', daily_budget_cap_cents: 4000 }],
          client_total_cap_cents: 15000,
        })
      }
      return Response.json({ success: true, config })
    })
    vi.stubGlobal('fetch', fn)
    const confirmSpy = vi.fn<typeof window.confirm>(() => false)
    vi.stubGlobal('confirm', confirmSpy)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('act_111')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('40'), { target: { value: '' } })
    // 页面底部主面板也有一个「保存」，账户行那个在前面
    fireEvent.click(screen.getAllByText('保存')[0])
    const asked = String(confirmSpy.mock.calls[0]?.[0] ?? '')
    expect(asked).toContain('回落成客户总闸 $150 / 天')
    expect(asked).toContain('放宽')
    expect(fn.mock.calls.some(c => String(c[0]).includes('/daily-cap'))).toBe(false)
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

  it('自动流程状态的素材显示中文状态、没有批准按钮', async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      return Response.json({
        success: true,
        config: {
          ...config,
          creative_pool: [
            { kind: 'meta_video', ref: '111', status: 'testing' },
            { kind: 'meta_video', ref: '222', status: 'candidate' },
          ],
        },
      })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('自动流程：测试中')).toBeTruthy())
    // 只有 candidate 那条有批准按钮
    expect(screen.getAllByText('批准')).toHaveLength(1)
    expect(screen.queryByText('待批准')).toBeTruthy()
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

  it('保存新视频时带上页面加载时的版本（expected_version）', async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') return Response.json({ success: true, config, version: 'v2' })
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）'), {
      target: { value: '333' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    const patch = fn.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeTruthy()
    const body = JSON.parse(String((patch?.[1] as RequestInit).body)) as Record<string, unknown>
    expect(body.expected_version).toBe('v1')
  })

  it('保存遇到 409 时显示中文提示、重新加载，并保留输入框里的编号', async () => {
    const conflictMessage = '素材池刚被别处改过，请刷新页面后再保存。'
    // 只数对配置本身的 GET，别的接口（如账户上限清单）不计数，免得「重新加载」的断言被别的请求蒙混过关
    let getCount = 0
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') {
        return Response.json({ error: 'creative_pool_changed_concurrently', message: conflictMessage }, { status: 409 })
      }
      if (url.endsWith('/ad-strategy-config') && (init?.method === undefined || init.method === 'GET')) {
        getCount += 1
      }
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    // 初次加载恰好读一次配置
    await waitFor(() => expect(getCount).toBe(1))
    const textarea = screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）')
    fireEvent.change(textarea, { target: { value: '333' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText(conflictMessage)).toBeTruthy())
    expect(screen.queryByText('creative_pool_changed_concurrently')).toBeNull()
    // 409 之后恰好重新加载一次
    await waitFor(() => expect(getCount).toBe(2))
    expect((textarea as HTMLTextAreaElement).value).toBe('333')
  })

  it('批准遇到 409 时显示中文提示并重新加载', async () => {
    const conflictMessage = '素材池刚被别处改过，请刷新页面后再试。'
    // 只数对配置本身的 GET，别的接口（如账户上限清单）不计数，免得「重新加载」的断言被别的请求蒙混过关
    let getCount = 0
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (url.endsWith('/approve') && init?.method === 'POST') {
        return Response.json({ error: 'creative_pool_changed_concurrently', message: conflictMessage }, { status: 409 })
      }
      if (url.endsWith('/ad-strategy-config') && (init?.method === undefined || init.method === 'GET')) {
        getCount += 1
      }
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getAllByText('批准').length).toBe(2))
    // 初次加载恰好读一次配置
    await waitFor(() => expect(getCount).toBe(1))
    fireEvent.click(screen.getAllByText('批准')[0])
    await waitFor(() => expect(screen.getByText(conflictMessage)).toBeTruthy())
    // 409 之后恰好重新加载一次
    await waitFor(() => expect(getCount).toBe(2))
  })

  it('不再说「已批准的视频会全部变回」，改成说明不影响已批准的视频', async () => {
    stubFetch()
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    expect(screen.queryByText(/已批准的视频会全部变回/)).toBeNull()
    expect(screen.getByText(/添加新视频不会影响已批准的视频/)).toBeTruthy()
  })

  it('同页改了上限后，添加新视频保存遇 409：刷新不冲掉未保存的上限', async () => {
    const conflictMessage = '素材池刚被别处改过，请刷新页面后再保存。'
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') {
        return Response.json({ error: 'creative_pool_changed_concurrently', message: conflictMessage }, { status: 409 })
      }
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    // 用户改了上限但没保存
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '200' } })
    fireEvent.change(screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）'), {
      target: { value: '333' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText(conflictMessage)).toBeTruthy())
    // 刷新后上限输入框仍是用户改的值，不是服务端的 150
    expect(screen.getByDisplayValue('200')).toBeTruthy()
    expect(screen.queryByDisplayValue('150')).toBeNull()
  })

  it('批准遇 409：刷新不冲掉未保存的上限', async () => {
    const conflictMessage = '素材池刚被别处改过，请刷新页面后再试。'
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (url.endsWith('/approve') && init?.method === 'POST') {
        return Response.json({ error: 'creative_pool_changed_concurrently', message: conflictMessage }, { status: 409 })
      }
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getAllByText('批准').length).toBe(2))
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '200' } })
    fireEvent.click(screen.getAllByText('批准')[0])
    await waitFor(() => expect(screen.getByText(conflictMessage)).toBeTruthy())
    expect(screen.getByDisplayValue('200')).toBeTruthy()
    expect(screen.queryByDisplayValue('150')).toBeNull()
  })

  it('新编号去重并过滤已存在的：333 只出现一次，已存在的 111 不重复添加', async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') return Response.json({ success: true, config, version: 'v2' })
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）'), {
      target: { value: '333\n333\n111' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    const patch = fn.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeTruthy()
    const body = JSON.parse(String((patch?.[1] as RequestInit).body)) as {
      creative_pool: { kind: string; ref: string; status: string }[]
    }
    const refs = body.creative_pool.map(e => e.ref)
    // 333 重复输入只算一次；已存在的 111 不会被当成新候选重复添加；原有的 222 仍保留
    expect(refs.filter(r => r === '333')).toHaveLength(1)
    expect(refs.filter(r => r === '111')).toHaveLength(1)
    expect(refs.filter(r => r === '222')).toHaveLength(1)
    expect(refs).toHaveLength(3)
  })

  it('输入的编号全是已存在的：不发 PATCH，提示中文，输入框内容还在', async () => {
    const fn = stubFetch()
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    const textarea = screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）')
    fireEvent.change(textarea, { target: { value: '111\n222' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('这些视频编号已经在列表里了，没有需要添加的')).toBeTruthy())
    expect(fn.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toBe(false)
    expect((textarea as HTMLTextAreaElement).value).toBe('111\n222')
  })

  it('保存成功但 version_unreadable：之后会再 GET 一次配置来刷新版本', async () => {
    let getCount = 0
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') {
        return Response.json({ success: true, config, version_unreadable: true })
      }
      if (url.endsWith('/ad-strategy-config') && (init?.method === undefined || init.method === 'GET')) {
        getCount += 1
      }
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    await waitFor(() => expect(getCount).toBe(1))
    fireEvent.change(screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）'), {
      target: { value: '333' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    await waitFor(() => expect(getCount).toBe(2))
  })

  it('保存时服务端返回 400 带中文 message：显示中文，不显示英文错误代码', async () => {
    const backendMessage = '这些视频编号已经在列表里了，没有需要添加的'
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') {
        return Response.json({ error: 'duplicate_creative_ref', message: backendMessage }, { status: 400 })
      }
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）'), {
      target: { value: '333' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText(backendMessage)).toBeTruthy())
    expect(screen.queryByText('duplicate_creative_ref')).toBeNull()
  })

  it('GET 没返回 version 时，保存新视频不发带 creative_pool 的 PATCH，并提示刷新', async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') return Response.json({ success: true, config })
      return Response.json({ success: true, config })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）'), {
      target: { value: '333' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('读不到页面版本，请刷新页面后再添加素材')).toBeTruthy())
    const patch = fn.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeFalsy()
  })

  it('版本未知 + 改了上限 + 输入新编号：只保存上限，不带 creative_pool，编号还在', async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') return Response.json({ success: true, config })
      return Response.json({ success: true, config })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '200' } })
    const textarea = screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）')
    fireEvent.change(textarea, { target: { value: '333' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText(/预算\/模式已保存/)).toBeTruthy())
    const patch = fn.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeTruthy()
    const body = JSON.parse(String((patch?.[1] as RequestInit).body)) as Record<string, unknown>
    expect(body.daily_budget_cap_cents).toBe(20000)
    expect('creative_pool' in body).toBe(false)
    expect((textarea as HTMLTextAreaElement).value).toBe('333')
  })

  it('版本已知 + 编号全是已存在的 + 改了上限：只保存上限，提示编号已存在，输入框还在', async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') return Response.json({ success: true, config, version: 'v2' })
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '200' } })
    const textarea = screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）')
    fireEvent.change(textarea, { target: { value: '111\n222' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('编号已存在，预算/模式已保存')).toBeTruthy())
    const patch = fn.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeTruthy()
    const body = JSON.parse(String((patch?.[1] as RequestInit).body)) as Record<string, unknown>
    expect(body.daily_budget_cap_cents).toBe(20000)
    expect('creative_pool' in body).toBe(false)
    expect((textarea as HTMLTextAreaElement).value).toBe('111\n222')
  })

  it('版本为 null 时，保存新视频仍带上 expected_version: null', async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') return Response.json({ success: true, config, version: 'v2' })
      return Response.json({ success: true, config, version: null })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）'), {
      target: { value: '333' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    const patch = fn.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeTruthy()
    const body = JSON.parse(String((patch?.[1] as RequestInit).body)) as Record<string, unknown>
    expect('expected_version' in body).toBe(true)
    expect(body.expected_version).toBeNull()
  })

  it('批准成功后，同页未保存的上限修改不会被冲掉', async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (url.endsWith('/approve') && init?.method === 'POST') {
        return Response.json({ success: true, config, version: 'v2' })
      }
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getAllByText('批准').length).toBe(2))
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '200' } })
    fireEvent.click(screen.getAllByText('批准')[0])
    await waitFor(() => expect(fn.mock.calls.some(c => String(c[0]).includes('/approve'))).toBe(true))
    await waitFor(() => expect(screen.getByDisplayValue('200')).toBeTruthy())
    expect(screen.queryByDisplayValue('150')).toBeNull()
  })

  it('版本未知且输入了新编号时，显示「读不到页面版本」的提示', async () => {
    stubFetch()
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByText('可用于广告的视频')).toBeTruthy())
    expect(screen.queryByText('读不到页面版本，请刷新页面后再添加素材。')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('添加待批准的视频（每行填一个 Facebook 视频编号）'), {
      target: { value: '333' },
    })
    expect(screen.getByText('读不到页面版本，请刷新页面后再添加素材。')).toBeTruthy()
  })
})

describe('AutonomySettings · 客户总闸的「保存上限」按钮', () => {
  it('点一下只 PATCH 客户总闸，不发素材池和模式字段', async () => {
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      if (init?.method === 'PATCH') {
        return Response.json({
          success: true,
          config: { ...config, daily_budget_cap_cents: 20000 },
          version: 'v2',
        })
      }
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByDisplayValue('150')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '200' } })
    fireEvent.click(screen.getByTestId('save-total-cap'))
    await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    const patch = fn.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')
    expect(patch).toBeTruthy()
    const body = JSON.parse(String((patch?.[1] as RequestInit).body)) as Record<string, unknown>
    expect(body).toEqual({ daily_budget_cap_cents: 20000 })
    // 保存成功后把回传的新值回填进输入框
    await waitFor(() => expect(screen.getByDisplayValue('200')).toBeTruthy())
  })

  it('没改数字时点一下说「没有改动」，不发请求', async () => {
    const fn = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/labels')) return Response.json({ labels: {} })
      return Response.json({ success: true, config, version: 'v1' })
    })
    vi.stubGlobal('fetch', fn)
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByDisplayValue('150')).toBeTruthy())
    fireEvent.click(screen.getByTestId('save-total-cap'))
    await waitFor(() => expect(screen.getByText('没有改动')).toBeTruthy())
    expect(fn.mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toBe(false)
  })

  it('填 0 或负数时拦住并提示', async () => {
    stubFetch()
    render(<AutonomySettings clientId="c1" />)
    await waitFor(() => expect(screen.getByDisplayValue('150')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('150'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('save-total-cap'))
    await waitFor(() => expect(screen.getByText('每天上限要填大于 0 的金额')).toBeTruthy())
  })
})
