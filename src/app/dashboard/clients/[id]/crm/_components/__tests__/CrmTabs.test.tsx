import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CrmTabs } from '../CrmTabs'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function stub(industry: string | null = 'travel') {
  const mock = vi.fn(async () => new Response(JSON.stringify({ client: { industry } }), { status: 200 }))
  vi.stubGlobal('fetch', mock)
  return mock
}

// 2026-11-01：页面切换和「邮件模板」搬进了顶部导航（CrmWorkspaceShell）。这里只剩页面顶部那行次要链接。
describe('CrmTabs（现在只是一行次要链接）', () => {
  it('shows the quiet secondary links with their destinations', async () => {
    stub()
    render(<CrmTabs clientId={ID} active="all" />)

    expect(screen.getByRole('link', { name: '我的待跟进' })).toHaveAttribute(
      'href',
      `/dashboard/clients/${ID}/crm/all?assignee=me`,
    )
    expect(screen.getByRole('link', { name: '客户消息' })).toHaveAttribute('href', `/dashboard/clients/${ID}/messenger`)
    expect(screen.getByRole('link', { name: '商务收件箱' })).toHaveAttribute(
      'href',
      `/dashboard/clients/${ID}/business-inbox`,
    )
  })

  it('no longer repeats the entries that moved to the top nav', async () => {
    stub()
    render(<CrmTabs clientId={ID} active="payments" />)
    await screen.findByRole('link', { name: '同行渠道' })
    for (const name of ['全部客人', '付款总览', '销售进度', '邮件模板']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
    }
  })

  it('does not fetch the payments or template probes any more (the top nav owns them)', async () => {
    const mock = stub()
    render(<CrmTabs clientId={ID} active="all" />)
    await screen.findByRole('link', { name: '同行渠道' })
    const urls = mock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls.some((u) => u.includes('/crm/bookings/access'))).toBe(false)
    expect(urls.some((u) => u.includes('/crm/email-templates'))).toBe(false)
  })

  it('shows 同行渠道 only for a travel client', async () => {
    stub('travel')
    const travel = render(<CrmTabs clientId={ID} active="all" />)
    expect(await screen.findByRole('link', { name: '同行渠道' })).toHaveAttribute(
      'href',
      `/dashboard/clients/${ID}/agents`,
    )
    travel.unmount()

    const mock = stub('real_estate')
    render(<CrmTabs clientId={ID} active="all" />)
    await vi.waitFor(() => expect(mock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: '同行渠道' })).toBeNull()
  })

  it('every link carries a plain-words title, and no text is lighter than /60', () => {
    stub()
    const { container } = render(<CrmTabs clientId={ID} active="all" />)
    for (const name of ['我的待跟进', '客户消息', '商务收件箱']) {
      expect(screen.getByRole('link', { name }).getAttribute('title') ?? '').not.toBe('')
    }
    expect(container.innerHTML).not.toMatch(/text-me-charcoal\/(10|15|20|25|30|35|40|45|50|55)\b/)
  })

  // 「我的客人」入口 2026-10-26 去掉（点进去要等 3 秒才告诉你该去别处）。
  it('「我的客人」这个死入口已经去掉', () => {
    stub()
    render(<CrmTabs clientId={ID} active="all" />)
    expect(screen.queryByRole('link', { name: '我的客人' })).toBeNull()
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
