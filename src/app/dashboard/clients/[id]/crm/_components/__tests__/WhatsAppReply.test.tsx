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
