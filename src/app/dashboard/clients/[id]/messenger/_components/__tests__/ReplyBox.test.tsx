/**
 * Tests for the send box.
 *
 * The PM decision this feature rests on is "AI 草稿必须有人点才发" — the AI
 * writes, a person sends. That is a UI promise, so it is pinned here:
 *   - showing a draft must never send it
 *   - send is behind an explicit confirm
 *   - a closed window cannot be sent into from the UI (the server refuses too)
 *   - usedAiDraft tells the audit log the truth about who wrote the words
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReplyBox } from '../ReplyBox'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const CONVO = 'convo-1'
const DRAFT = 'Happy to help — I will send the itinerary today.'

function renderBox(overrides: Partial<Parameters<typeof ReplyBox>[0]> = {}) {
  const onSent = vi.fn()
  render(
    <ReplyBox
      clientId={CLIENT}
      conversationId={CONVO}
      customerName="Kam"
      draft={DRAFT}
      window={{ kind: 'standard', msRemaining: 6 * 3_600_000 }}
      viewerEmail="bdm@ctstours.co.nz"
      onSent={onSent}
      {...overrides}
    />,
  )
  return { onSent }
}

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, window: 'standard' }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ReplyBox — the AI never sends by itself', () => {
  it('shows the draft without sending anything', () => {
    const fetchMock = mockFetchOk()
    renderBox()

    expect(screen.getByRole('textbox')).toHaveValue(DRAFT)
    expect(screen.getByText(/还没发出去/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing when the person cancels the confirm', async () => {
    const fetchMock = mockFetchOk()
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the customer in the confirm so nobody sends to the wrong thread', async () => {
    mockFetchOk()
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('Kam'))
  })
})

describe('ReplyBox — audit honesty', () => {
  it('reports usedAiDraft when the words are still the AI’s', async () => {
    const fetchMock = mockFetchOk()
    const { onSent } = renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      body: DRAFT,
      usedAiDraft: true,
    })
    expect(onSent).toHaveBeenCalled()
  })

  it('reports usedAiDraft false once a human has edited the draft', async () => {
    const fetchMock = mockFetchOk()
    renderBox()

    await userEvent.type(screen.getByRole('textbox'), ' Call me on 0800 287 888.')
    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).usedAiDraft).toBe(false)
  })

  it('never claims AI authorship for a reply typed from scratch', async () => {
    const fetchMock = mockFetchOk()
    renderBox({ draft: null })

    await userEvent.type(screen.getByRole('textbox'), 'Typed by hand.')
    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).usedAiDraft).toBe(false)
  })
})

describe('ReplyBox — refusals', () => {
  it('disables send when Facebook’s window has closed', () => {
    mockFetchOk()
    renderBox({ window: { kind: 'closed', msRemaining: 0 } })

    expect(screen.getByRole('button', { name: '发送给客户' })).toBeDisabled()
    expect(screen.getByText(/请改用电话或邮件/)).toBeInTheDocument()
  })

  it('disables send on an empty box', () => {
    mockFetchOk()
    renderBox({ draft: '   ' })

    expect(screen.getByRole('button', { name: '发送给客户' })).toBeDisabled()
  })

  it('explains a closed window in plain language instead of showing a status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'window closed', reason: 'window_closed' }),
      }),
    )
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(await screen.findByText(/请改用电话或邮件联系客户/)).toBeInTheDocument()
    expect(screen.queryByText(/409/)).not.toBeInTheDocument()
  })

  it('keeps the typed text on screen when the send fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'graph failed', reason: 'graph_failed' }),
      }),
    )
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(await screen.findByText(/稍等一分钟再试一次/)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue(DRAFT)
  })
})

/**
 * 邮件渠道——同一个组件，2026-09-15 加的第二条线。这里只钉渠道之间真正
 * 不同的三件事（发去哪 / 确认文案 / 失败翻译），组件逻辑本身已经被上面
 * 那一整组 messenger 用例钉住了，不重复测。
 */
describe('ReplyBox — 邮件渠道', () => {
  it('发去邮件的回复接口，不是私信那条', async () => {
    const fetchMock = mockFetchOk()
    renderBox({ channel: 'email' })

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/clients/${CLIENT}/email/conversations/${CONVO}/reply`,
    )
  })

  it('确认文案说的是邮件，不是 Facebook', async () => {
    mockFetchOk()
    renderBox({ channel: 'email' })

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('邮件'))
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.not.stringContaining('Facebook'))
  })

  it('邮箱授权掉线 → 说清楚是邮箱的事，不是 Facebook 的事', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 424,
        json: async () => ({ error: 'no token', reason: 'no_token' }),
      }),
    )
    renderBox({ channel: 'email' })

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(await screen.findByText(/邮箱授权掉线了/)).toBeInTheDocument()
    expect(screen.queryByText(/Facebook/)).not.toBeInTheDocument()
  })

  it('没有客人来信可回 → 说清楚，不套用 Messenger 的「窗口关了」说法', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'no thread', reason: 'no_thread' }),
      }),
    )
    renderBox({ channel: 'email' })

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(await screen.findByText(/还没跟你们邮件往来过/)).toBeInTheDocument()
  })

  it('email 没有窗口过期这回事 —— 传 null 也不会把发送按钮锁死', () => {
    mockFetchOk()
    renderBox({ channel: 'email', window: null })

    expect(screen.getByRole('button', { name: '发送给客户' })).not.toBeDisabled()
  })
})

/**
 * WhatsApp（2026-09-28）。整条 WhatsApp 方案的前提是「顾问在 ME 里回」，而在这之前
 * 这个框只会往 Messenger / 邮件那两个地址发。
 *
 * 🔴 三条各钉一件**照抄就会当场出洋相**的事（板桥 / 魏征复审各自指出）：
 *  · 发去的地址必须是 WhatsApp 那个接口 —— 打到 messenger 那条就是发错渠道；
 *  · 确认框不能说「以 CTS 的 Facebook 主页发出去」；
 *  · 失败提示不能说「Facebook 已经不让回这条了」，顾问会去检查 Facebook 那边，
 *    而真正该做的是改打电话。
 */
describe('ReplyBox — WhatsApp 这条线不能穿着 Facebook 的衣服', () => {
  const waBox = (overrides: Partial<Parameters<typeof ReplyBox>[0]> = {}) =>
    renderBox({ channel: 'whatsapp', draft: null, ...overrides })

  it('发去 WhatsApp 那个接口，不是 messenger 的', async () => {
    const fetchMock = mockFetchOk()
    waBox()
    await userEvent.type(screen.getByRole('textbox'), 'Hi Kam')
    await userEvent.click(screen.getByRole('button', { name: /发送给客户/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/clients/${CLIENT}/whatsapp/conversations/${CONVO}/reply`,
    )
  })

  it('确认框里不许出现 Facebook 主页，要说是发到 WhatsApp', async () => {
    mockFetchOk()
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
    waBox()
    await userEvent.type(screen.getByRole('textbox'), 'Hi Kam')
    await userEvent.click(screen.getByRole('button', { name: /发送给客户/ }))

    const asked = String(confirmSpy.mock.calls[0][0])
    expect(asked).toContain('WhatsApp')
    expect(asked).not.toContain('Facebook')
  })

  it('窗口关了 → 提示说的是 WhatsApp、并且告诉他改打电话，不提 Facebook', () => {
    mockFetchOk()
    waBox({ window: { kind: 'closed', msRemaining: 0 } })

    const body = document.body.textContent ?? ''
    expect(body).toContain('WhatsApp 不让我们主动发')
    expect(body).not.toContain('Facebook')
    // 按钮要真的按不下去 —— 只改文案不挡住，顾问会打完一整段才被拒
    expect(screen.getByRole('button', { name: /发送给客户/ })).toBeDisabled()
  })

  it('接口回 424（号码没连上）→ 不许说「授权掉线了，请重连」，那条路修不好这个', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 424, json: async () => ({ reason: 'no_token' }) }),
    )
    waBox()
    await userEvent.type(screen.getByRole('textbox'), 'Hi Kam')
    await userEvent.click(screen.getByRole('button', { name: /发送给客户/ }))

    await waitFor(() => expect(screen.getByText(/WhatsApp 号码没连上/)).toBeInTheDocument())
  })
})
