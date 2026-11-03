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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

/**
 * 2026-10-21：WhatsApp 的 AI 草稿也要在 CRM 抽屉里能批准（原来草稿面板只在「客户消息」页的私信卡里，
 * WhatsApp 通过安全检查的草稿没有任何地方能批准）。硬规矩：被安全检查拦下的草稿**不能**批准发送。
 */
describe('AI 草稿面板（WhatsApp）', () => {
  const OPEN = { kind: 'standard', msRemaining: 6 * 3_600_000 }
  const stubByUrl = (lookup: unknown, drafts: unknown) => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/drafts') ? drafts : lookup
      return { ok: true, status: 200, json: async () => body } as Response
    })
    vi.stubGlobal('fetch', f)
    return f
  }
  const PENDING = {
    id: 'draft-1',
    draftBody: 'Kia ora! The next departure is in March.',
    agentConfidence: 0.8,
    quotedOfferingNames: [],
    verifierOutputJson: { ok: true },
    passedGateIds: ['brand_redline'],
    semanticFlags: [],
    createdAt: '2026-10-21T00:00:00Z',
  }

  it('有待批准草稿 → 抽屉里出现草稿面板和「批准发送」，读的是 drafts 接口', async () => {
    const f = stubByUrl(
      { conversationId: 'convo-wa-1', participantName: 'Kam', replyWindow: OPEN, lastInbound: { body: 'When is the next tour?', sentAt: '2026-10-20T23:00:00Z' }, blockedDraft: null },
      { drafts: [PENDING] },
    )
    draw()

    await waitFor(() => expect(screen.getByTestId('whatsapp-draft-panel')).toBeInTheDocument())
    expect(screen.getByText('批准发送')).toBeInTheDocument()
    expect(screen.getByText(/When is the next tour/)).toBeInTheDocument()
    expect(f.mock.calls.map((c) => String(c[0]))).toContain(`/api/clients/${CLIENT}/messenger/conversations/convo-wa-1/drafts`)
  })

  it('🔴 被安全检查拦下的草稿 → 只给一行原因，没有「批准发送」按钮', async () => {
    stubByUrl(
      {
        conversationId: 'convo-wa-1',
        participantName: 'Kam',
        replyWindow: OPEN,
        lastInbound: { body: 'hi', sentAt: '2026-10-20T23:00:00Z' },
        blockedDraft: { reasons: ['content_claims: reply makes unverified claim(s): promise'], createdAt: '2026-10-20T23:01:00Z' },
      },
      { drafts: [] },
    )
    draw()

    await waitFor(() => expect(screen.getByTestId('whatsapp-draft-blocked')).toBeInTheDocument())
    // 给 PM 看的是中文闸门名，不露英文技术串
    const note = screen.getByTestId('whatsapp-draft-blocked').textContent ?? ''
    expect(note).toContain('承诺/未核实说法')
    expect(note).not.toMatch(/unverified|content_claims/)
    // 手写框不预填被拦原因，也不再说"还没有 AI 草稿"自相矛盾
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByText(/还没有 AI 草稿/)).toBeNull()
    expect(screen.queryByText('批准发送')).toBeNull()
    expect(screen.queryByTestId('whatsapp-draft-panel')).toBeNull()
  })

  it('没有草稿、也没有被拦的 → 两块都不出现', async () => {
    stubByUrl({ conversationId: 'convo-wa-1', participantName: 'Kam', replyWindow: OPEN, lastInbound: null, blockedDraft: null }, { drafts: [] })
    draw()

    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
    expect(screen.queryByTestId('whatsapp-draft-panel')).toBeNull()
    expect(screen.queryByTestId('whatsapp-draft-blocked')).toBeNull()
  })

  it('窗口已关 → 不摆草稿面板（超过 24 小时只能打电话/发邮件）', async () => {
    stubByUrl({ conversationId: 'convo-wa-1', replyWindow: { kind: 'closed', msRemaining: 0 }, blockedDraft: null }, { drafts: [PENDING] })
    draw()

    await waitFor(() => expect(screen.getByTestId('reply-closed')).toBeTruthy())
    expect(screen.queryByTestId('whatsapp-draft-panel')).toBeNull()
    expect(screen.queryByText('批准发送')).toBeNull()
  })

  it('读草稿失败 → 手写回复框照常在，不立红色报错', async () => {
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/drafts')) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response
      return { ok: true, status: 200, json: async () => ({ conversationId: 'convo-wa-1', participantName: 'Kam', replyWindow: OPEN, blockedDraft: null }) } as Response
    })
    vi.stubGlobal('fetch', f)
    draw()

    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
    expect(screen.queryByText(/boom/)).toBeNull()
  })

  it('待批草稿和被拦提示同时存在 → 只摆草稿面板，被拦提示隐藏；手写框不预填、提示不自相矛盾', async () => {
    stubByUrl(
      {
        conversationId: 'convo-wa-1',
        participantName: 'Kam',
        replyWindow: OPEN,
        lastInbound: { body: 'q', sentAt: '2026-10-20T23:00:00Z' },
        blockedDraft: { reasons: ['content_claims: x'], createdAt: '2026-10-20T23:01:00Z' },
      },
      { drafts: [PENDING] },
    )
    draw()

    await waitFor(() => expect(screen.getByTestId('whatsapp-draft-panel')).toBeInTheDocument())
    expect(screen.queryByTestId('whatsapp-draft-blocked')).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByText(/还没有 AI 草稿/)).toBeNull()
    expect(screen.getByText(/上面有 AI 草稿等你批准/)).toBeInTheDocument()
  })

  it('点「批准发送」→ POST 到这个会话的 reply 接口，带 draft_id 和 approve；回调说"已批准"而不是"已发出"', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const lookup = { conversationId: 'convo-wa-1', participantName: 'Kam', replyWindow: OPEN, lastInbound: { body: 'q', sentAt: '2026-10-20T23:00:00Z' }, blockedDraft: null }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const body = init?.method === 'POST' ? { ok: true } : url.includes('/drafts') ? { drafts: [PENDING] } : lookup
      return { ok: true, status: 200, json: async () => body } as Response
    }))
    vi.stubGlobal('confirm', () => true)
    const onSent = vi.fn()
    render(<WhatsAppReply clientId={CLIENT} contactId={CONTACT} customerName="Kam" viewerEmail="bdm@ctstours.co.nz" onSent={onSent} />)

    await waitFor(() => expect(screen.getByText('批准发送')).toBeInTheDocument())
    fireEvent.click(screen.getByText('批准发送'))

    await waitFor(() => expect(onSent).toHaveBeenCalledWith('approved'))
    const post = calls.find((c) => c.init?.method === 'POST')
    expect(post?.url).toBe(`/api/clients/${CLIENT}/messenger/conversations/convo-wa-1/reply`)
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ draft_id: 'draft-1', action: 'approve' })
  })
})
