import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CrmTabs, resetPaymentsProbeCache } from '../CrmTabs'

beforeEach(() => resetPaymentsProbeCache())

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function res(status: number): Response {
  return new Response(JSON.stringify({ ok: true }), { status })
}

function stub(probe: () => Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/crm/bookings/access')
      ? probe()
      : new Response(JSON.stringify({ client: { industry: 'travel' } }), { status: 200 }),
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

function probeCalls(mock: ReturnType<typeof stub>) {
  return mock.mock.calls.filter((call) => String(call[0]).includes('/crm/bookings/access'))
}

describe('CrmTabs', () => {
  it('shows 付款总览 when the probe answers 200', async () => {
    const mock = stub(async () => res(200))
    render(<CrmTabs clientId={ID} active="all" />)

    const link = await screen.findByRole('link', { name: '付款总览' })
    expect(link).toHaveAttribute('href', `/dashboard/clients/${ID}/crm/payments`)

    const calls = probeCalls(mock)
    expect(calls).toHaveLength(1)
    expect(String(calls[0][0])).toContain(`/api/clients/${ID}/crm/bookings/access`)
  })

  it('shows 销售进度 next to 付款总览 (same probe, same gate) and links to the sales-progress page', async () => {
    stub(async () => res(200))
    render(<CrmTabs clientId={ID} active="sales" />)

    const link = await screen.findByRole('link', { name: '销售进度' })
    expect(link).toHaveAttribute('href', `/dashboard/clients/${ID}/sales-progress`)
  })

  it.each([403, 404, 500, 204])('does not show 销售进度 either when the probe answers %i', async (status) => {
    let probeCalled = false
    stub(async () => {
      probeCalled = true
      return res(status)
    })
    render(<CrmTabs clientId={ID} active="all" />)

    await waitFor(() => expect(probeCalled).toBe(true))
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByRole('link', { name: '销售进度' })).toBeNull()
  })

  it.each([403, 404, 500, 204])('does not show 付款总览 when the probe answers %i', async (status) => {
    let probeCalled = false
    stub(async () => {
      probeCalled = true
      return res(status)
    })
    render(<CrmTabs clientId={ID} active="all" />)

    await waitFor(() => expect(probeCalled).toBe(true))
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    expect(screen.getByRole('link', { name: '全部客人' })).toBeInTheDocument()
  })

  it('does not show it when the probe throws', async () => {
    let probeCalled = false
    stub(async () => {
      probeCalled = true
      throw new TypeError('network error')
    })
    render(<CrmTabs clientId={ID} active="all" />)

    await waitFor(() => expect(probeCalled).toBe(true))
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    expect(screen.getByRole('link', { name: '全部客人' })).toBeInTheDocument()
  })

  it('does not show it while the probe is pending', async () => {
    let resolveProbe: (value: Response) => void = () => {}
    const deferred = new Promise<Response>((resolve) => {
      resolveProbe = resolve
    })
    stub(() => deferred)
    render(<CrmTabs clientId={ID} active="all" />)

    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()

    resolveProbe(res(200))
    const link = await screen.findByRole('link', { name: '付款总览' })
    expect(link).toHaveAttribute('href', `/dashboard/clients/${ID}/crm/payments`)
  })

  it('active styling', async () => {
    stub(async () => res(200))
    const { unmount } = render(<CrmTabs clientId={ID} active="payments" />)

    const payments = await screen.findByRole('link', { name: '付款总览' })
    expect(payments.className).toContain('bg-me-charcoal')
    expect(screen.getByRole('link', { name: '全部客人' }).className).not.toContain('bg-me-charcoal')
    unmount()

    stub(async () => res(200))
    const { unmount: unmountAll } = render(<CrmTabs clientId={ID} active="all" />)
    await screen.findByRole('link', { name: '付款总览' })
    expect(screen.getByRole('link', { name: '全部客人' }).className).toContain('bg-me-charcoal')
    expect(screen.getByRole('link', { name: '付款总览' }).className).not.toContain('bg-me-charcoal')
    unmountAll()

    stub(async () => res(200))
    render(<CrmTabs clientId={ID} active="payments" />)
    await screen.findByRole('link', { name: '付款总览' })
    expect(screen.getByRole('link', { name: '付款总览' }).className).toContain('bg-me-charcoal')
  })

  // 「决策清单（只读）」2026-10-25 退役：它跟「全部客人 → Magic Engine 智能」
  // 是同一批人同一套建议，而且是最慢的一页（today 接口 6.9 秒）。
  it('「决策清单（只读）」这个入口已经不在导航里了', async () => {
    stub(async () => res(200))
    render(<CrmTabs clientId={ID} active="all" />)
    await screen.findByRole('link', { name: '付款总览' })
    expect(screen.queryByRole('link', { name: '决策清单（只读）' })).toBeNull()
  })

  it('the other links are untouched whether or not the probe succeeds', async () => {
    for (const status of [200, 403]) {
      stub(async () => res(status))
      const { unmount } = render(<CrmTabs clientId={ID} active="all" />)

      await screen.findByRole('link', { name: '商务收件箱' })

      expect(screen.getByRole('link', { name: '全部客人' })).toHaveAttribute(
        'href',
        `/dashboard/clients/${ID}/crm/all`,
      )
      expect(screen.getByRole('link', { name: '客户消息' })).toHaveAttribute(
        'href',
        `/dashboard/clients/${ID}/messenger`,
      )
      expect(screen.getByRole('link', { name: '商务收件箱' })).toHaveAttribute(
        'href',
        `/dashboard/clients/${ID}/business-inbox`,
      )

      unmount()
    }
  })

  it('a client without access never sees the tab even if the client lookup works', async () => {
    let probeCalled = false
    stub(async () => {
      probeCalled = true
      return res(403)
    })
    render(<CrmTabs clientId={ID} active="all" />)

    await waitFor(() => expect(probeCalled).toBe(true))
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    expect(screen.queryByText('付款总览')).toBeNull()
    expect(screen.getByRole('link', { name: '全部客人' })).toBeInTheDocument()
  })
})

describe('CrmTabs 挂了「新消息提醒」', () => {
  it('隔一轮询问后，有新消息就在导航上方出现提示条（所有 CRM 页面共用）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const mock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/crm/inbound-pulse')) {
          return new Response(JSON.stringify({ count: 2, byChannel: { whatsapp: 2 }, latestAt: null }), { status: 200 })
        }
        if (url.includes('/crm/bookings/access')) return res(403)
        return new Response(JSON.stringify({ client: { industry: 'travel' } }), { status: 200 })
      })
      vi.stubGlobal('fetch', mock)
      render(<CrmTabs clientId={ID} active="all" />)
      expect(screen.queryByTestId('new-messages-banner')).toBeNull()
      await vi.advanceTimersByTimeAsync(31_000)
      expect(await screen.findByTestId('new-messages-banner')).toHaveTextContent('有 2 个对话收到客人新消息')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('右上角这几个入口要能说清自己是干嘛的（PM 2026-10-26：不知道干嘛用的）', () => {
  it('每个入口都带一句人话说明', async () => {
    stub(async () => res(200))
    render(<CrmTabs clientId={ID} active="all" />)
    await screen.findByRole('link', { name: '付款总览' })
    for (const name of ['全部客人', '付款总览', '客户消息', '商务收件箱']) {
      const el = screen.getByRole('link', { name })
      expect(el.getAttribute('title') ?? '').not.toBe('')
    }
  })

  it('「我的客人」这个死入口已经去掉（点进去要等 3 秒才告诉你该去别处）', async () => {
    stub(async () => res(200))
    render(<CrmTabs clientId={ID} active="all" />)
    await screen.findByRole('link', { name: '付款总览' })
    expect(screen.queryByRole('link', { name: '我的客人' })).toBeNull()
  })
})
