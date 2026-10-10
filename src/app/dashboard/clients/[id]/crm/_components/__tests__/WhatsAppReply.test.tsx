/**
 * 抽屉里的 WhatsApp 回复框。
 *
 * 这一块是整条 WhatsApp 方案的前提：在它之前 ME 里没有任何地方能回 WhatsApp，
 * 顾问只能用自己手机回 —— 那条线系统看不见，于是天天误报「这个客人没人跟进」。
 *
 * 🔴 三件事必须钉住，每件都有明确的坏结果：
 *  · **没有 WhatsApp 线的人什么都不渲染** —— 给一个点了发不出去的输入框，
 *    比不给更糟（`DncBanner.tsx` 的头注就是这类事故的记录）。
 *  · **读失败也什么都不渲染** —— 不能在抽屉里立一块红色报错，把「记一笔」和
 *    往来记录挡在后面。
 *  · **有线的人拿到的是 WhatsApp 那个框** —— 不是 Messenger 的（渠道搞错，
 *    发送那一步会被拒，顾问白写一段）。
 */

import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WhatsAppReply } from '../WhatsAppReply'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const CONTACT = 'contact-1'

const draw = () =>
  render(
    <WhatsAppReply
      clientId={CLIENT}
      contactId={CONTACT}
      customerName="Kam"
      viewerEmail="bdm@ctstours.co.nz"
      onSent={vi.fn()}
    />,
  )

/** 让查询路由回一个指定结果。返回 fetch mock，供断言查询地址。 */
const stubLookup = (body: unknown, ok = true) => {
  const f = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('抽屉里的 WhatsApp 回复框', () => {
  it('这个人没有 WhatsApp 线 → 一个字都不渲染', async () => {
    stubLookup({ conversationId: null })
    const { container } = draw()

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('查询失败 → 也什么都不渲染，不在抽屉里立一块红色报错', async () => {
    stubLookup({ error: '读取失败' }, false)
    const { container } = draw()

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('有 WhatsApp 线 → 出现输入框，而且写明是回 WhatsApp', async () => {
    stubLookup({
      conversationId: 'convo-wa-1',
      participantName: 'Kam W',
      replyWindow: { kind: 'standard', msRemaining: 6 * 3_600_000 },
    })
    draw()

    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
    expect(screen.getByText(/回他的 WhatsApp/)).toBeInTheDocument()
    // 窗口倒计时要显示出来 —— 顾问要知道还剩多久，不然会在关窗后才动手
    expect(screen.getByText(/可以直接回复/)).toBeInTheDocument()
  })

  it('查的是 WhatsApp 那条查询路由 —— 查错渠道会让没说过话的人也冒出输入框', async () => {
    const f = stubLookup({ conversationId: null })
    draw()

    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(String(f.mock.calls[0][0])).toBe(
      `/api/clients/${CLIENT}/crm/contacts/${CONTACT}/whatsapp`,
    )
  })
})

/**
 * 窗口关了（客人超过 24 小时没说话）：不再摆一整块发不出去的输入框
 * （PM 2026-10-10：按钮太多）。只留一句话 + 还走得通的两条路。
 */
describe('窗口已关 → 只留一句话 + 打电话 / 发邮件', () => {
  const drawClosed = (phone: string | null, email: string | null) =>
    render(
      <WhatsAppReply
        clientId={CLIENT}
        contactId={CONTACT}
        customerName="Kam"
        viewerEmail="bdm@ctstours.co.nz"
        onSent={vi.fn()}
        phone={phone}
        email={email}
      />,
    )

  it('没有输入框、没有发送按钮；两条路都给', async () => {
    stubLookup({ conversationId: 'conv-1', replyWindow: { kind: 'closed', msRemaining: 0 } })
    drawClosed('+6421000000', 'kam@example.com')

    await waitFor(() => expect(screen.getByTestId('reply-closed')).toBeTruthy())
    expect(document.querySelector('textarea')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('打电话').getAttribute('href')).toBe('tel:+6421000000')
    expect(screen.getByText('发邮件').getAttribute('href')).toBe('mailto:kam@example.com')
  })

  it('没电话就不给「打电话」—— 不摆一条走不通的路', async () => {
    stubLookup({ conversationId: 'conv-1', replyWindow: { kind: 'closed', msRemaining: 0 } })
    drawClosed(null, 'kam@example.com')

    await waitFor(() => expect(screen.getByTestId('reply-closed')).toBeTruthy())
    expect(screen.queryByText('打电话')).toBeNull()
    expect(screen.getByText('发邮件')).toBeTruthy()
  })

  it('窗口还开着 → 照旧给回复框', async () => {
    stubLookup({ conversationId: 'conv-1', replyWindow: { kind: 'standard', msRemaining: 3_600_000 } })
    drawClosed('+6421000000', null)

    await waitFor(() => expect(document.querySelector('textarea')).toBeTruthy())
    expect(screen.queryByTestId('reply-closed')).toBeNull()
  })
})
