/**
 * 自治设置面板 —— 服务端说「已写库但读不回」（503 + saved:true）时要重读，
 * 不能留着旧的本地配置：否则把模式改回原值会被判成「没有改动」而不发请求，
 * 服务器却还停在会动钱的自动模式上。读不到就只给提示、不给表单。
 */

import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import AutonomySettings from '../autonomy-settings'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

type Reply = { status?: number; json: unknown }

function mockApi(queues: { get: Reply[]; patch?: Reply[]; approve?: Reply[] }) {
  const cursors: { get: number; patch: number; approve: number } = {
    get: 0,
    patch: 0,
    approve: 0,
  }

  const take = (queue: Reply[] | undefined, key: 'get' | 'patch' | 'approve', method: string, url: string): Reply => {
    if (!queue || queue.length === 0) {
      throw new Error(`unexpected ${method} ${url}`)
    }
    const index = Math.min(cursors[key], queue.length - 1)
    cursors[key] = index + 1
    return queue[index]
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const url = String(input)

    let reply: Reply
    if (url.endsWith('/creative-pool/approve') && method === 'POST') {
      reply = take(queues.approve, 'approve', method, url)
    } else if (method === 'PATCH') {
      reply = take(queues.patch, 'patch', method, url)
    } else if (method === 'GET') {
      reply = take(queues.get, 'get', method, url)
    } else {
      throw new Error(`unexpected ${method} ${url}`)
    }

    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200 })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const CLIENT_ID = 'client-uuid-autonomy-settings-test'

const OBSERVE = {
  daily_budget_cap_cents: 15000,
  autonomy_mode: 'observe',
  creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }],
}

const AUTO = { ...OBSERVE, autonomy_mode: 'bounded_auto' }

const SAVED_UNREADABLE: Reply = {
  status: 503,
  json: { error: '设置已保存，但读不出保存后的结果，请刷新页面确认', saved: true },
}

const READ_FAILED: Reply = {
  status: 503,
  json: { error: '读不出这个客户当前的广告设置，请稍后再试' },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AutonomySettings — 已写库但读不回', () => {
  it('读不出配置 → 只显示提示，不给任何输入框和保存按钮', async () => {
    mockApi({ get: [READ_FAILED] })
    render(<AutonomySettings clientId={CLIENT_ID} />)

    await screen.findByText(/读不到广告自治配置/)

    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('🔴 保存已写库但读不回、重读成功 → 本地配置跟上新值；再改回原值会真的发请求，不是「没有改动」', async () => {
    const api = mockApi({
      get: [
        { json: { success: true, config: OBSERVE } },
        { json: { success: true, config: AUTO } },
      ],
      patch: [SAVED_UNREADABLE, { json: { success: true, config: OBSERVE } }],
    })

    render(<AutonomySettings clientId={CLIENT_ID} />)

    const autoRadio = await screen.findByRole('radio', { name: /信封内自动执行/ })
    fireEvent.click(autoRadio)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await screen.findByText('已保存')
    expect(screen.getByRole('radio', { name: /信封内自动执行/ })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: /只巡察不动钱/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      const patches = api.mock.calls.filter(c => c[1]?.method === 'PATCH')
      expect(patches).toHaveLength(2)
    })

    const second = api.mock.calls.filter(c => c[1]?.method === 'PATCH')[1]
    expect(JSON.parse(String(second[1]?.body))).toEqual({ autonomy_mode: 'observe' })
    expect(screen.queryByText('没有改动')).toBeNull()
  })

  it('🔴 保存已写库但读不回、重读也失败 → 说「已保存但读不出来」，不给表单', async () => {
    mockApi({
      get: [{ json: { success: true, config: OBSERVE } }, READ_FAILED],
      patch: [SAVED_UNREADABLE],
    })

    render(<AutonomySettings clientId={CLIENT_ID} />)

    const autoRadio = await screen.findByRole('radio', { name: /信封内自动执行/ })
    fireEvent.click(autoRadio)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await screen.findByText(/设置已保存，但现在读不出来/)
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  })

  it('🔴 批准已写库但读不回、重读成功 → 那条显示已批准，不再留着「批准」按钮', async () => {
    const approvedPool = {
      ...OBSERVE,
      creative_pool: [
        { kind: 'meta_video', ref: 'v1', status: 'approved', approved_by: 'fde@staff.test' },
      ],
    }

    mockApi({
      get: [
        { json: { success: true, config: OBSERVE } },
        { json: { success: true, config: approvedPool } },
      ],
      approve: [
        {
          status: 503,
          json: { error: '已批准，但读不出批准后的素材池，请刷新页面确认', saved: true },
        },
      ],
    })

    render(<AutonomySettings clientId={CLIENT_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: '批准' }))

    await screen.findByText(/已批准 by fde@staff.test/)
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull()
  })
})
