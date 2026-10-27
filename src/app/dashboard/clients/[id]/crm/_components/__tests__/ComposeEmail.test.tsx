/**
 * 抽屉里的「写第一封邮件」框。
 *
 * 钉死的事：
 *  · 有可回复线程 / 功能没开通 / 读失败 → 什么都不渲染（不给点了没用的框）
 *  · 「没咨询过我们」「别再联系」→ 只渲染一行原因，没有输入框
 *  · 能写 → 显示发件箱和收件人；发送时带上 expectedRecipient 和同一个 requestId（双击不会换号）
 *  · 发送失败 → 显示服务端给的原因，框里的字不丢
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComposeEmail } from '../ComposeEmail'

const can = { canCompose: true, recipient: 'amy@gmail.com', mailbox: 'info@ctstours.co.nz', sentToContactLast7Days: 0 }

function stub(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  const f = vi.fn()
  for (const r of responses) f.mockResolvedValueOnce({ ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body })
  vi.stubGlobal('fetch', f)
  return f
}
const draw = (onSent = vi.fn()) => render(<ComposeEmail clientId="c1" contactId="p1" onSent={onSent} />)

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ComposeEmail', () => {
  it('has a repliable thread → renders nothing', async () => {
    stub([{ ok: true, body: { conversationId: 'cv1' } }])
    const { container } = draw()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('feature disabled (silent reason) or load failure → renders nothing', async () => {
    stub([{ ok: true, body: { conversationId: null, compose: { canCompose: false, reason: 'disabled', message: 'x' } } }])
    const a = draw()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(a.container.innerHTML).toBe('')
    a.unmount()
    stub([{ ok: false, body: {} }])
    const b = draw()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(b.container.innerHTML).toBe('')
  })

  it('not an enquirer / do-not-contact → one line of reason, no input box', async () => {
    stub([{ ok: true, body: { conversationId: null, compose: { canCompose: false, reason: 'not_enquirer', message: '他没咨询过我们' } } }])
    draw()
    expect(await screen.findByTestId('compose-blocked')).toHaveTextContent('他没咨询过我们')
    expect(screen.queryByLabelText('邮件正文')).toBeNull()
  })

  it('shows mailbox + recipient and the 7-day hint', async () => {
    stub([{ ok: true, body: { conversationId: null, compose: { ...can, sentToContactLast7Days: 2 } } }])
    draw()
    expect(await screen.findByText(/info@ctstours.co.nz 发给 amy@gmail.com/)).toBeInTheDocument()
    expect(screen.getByText(/最近 7 天已发给他 2 封/)).toBeInTheDocument()
  })

  it('send button stays disabled until subject and body are filled', async () => {
    stub([{ ok: true, body: { conversationId: null, compose: can } }])
    draw()
    const btn = await screen.findByRole('button', { name: '发送' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText('邮件主题'), { target: { value: 'Hi' } })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText('邮件正文'), { target: { value: 'Hello' } })
    expect(btn).not.toBeDisabled()
  })

  it('posts expectedRecipient + a UUID requestId; on success clears the box and calls onSent', async () => {
    const onSent = vi.fn()
    const f = stub([
      { ok: true, body: { conversationId: null, compose: can } },
      { ok: true, body: { ok: true, messageId: 'm1' } },
      { ok: true, body: { conversationId: null, compose: can } },
    ])
    draw(onSent)
    fireEvent.change(await screen.findByLabelText('邮件主题'), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText('邮件正文'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(onSent).toHaveBeenCalled())
    const [url, init] = f.mock.calls[1]
    expect(url).toBe('/api/clients/c1/crm/contacts/p1/email/compose')
    const sent = JSON.parse((init as { body: string }).body)
    expect(sent).toMatchObject({ subject: 'Hi', body: 'Hello', expectedRecipient: 'amy@gmail.com' })
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(screen.getByLabelText('邮件主题')).toHaveValue('')
  })

  it('on failure shows the server reason and keeps what was typed; the retry uses the SAME requestId', async () => {
    const f = stub([
      { ok: true, body: { conversationId: null, compose: can } },
      { ok: false, status: 502, body: { error: '发送状态不明，先别重发' } },
      { ok: false, status: 502, body: { error: '发送状态不明，先别重发' } },
    ])
    draw()
    fireEvent.change(await screen.findByLabelText('邮件主题'), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText('邮件正文'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('发送状态不明')
    expect(screen.getByLabelText('邮件正文')).toHaveValue('Hello')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(f).toHaveBeenCalledTimes(3))
    const first = JSON.parse((f.mock.calls[1][1] as { body: string }).body).requestId
    const second = JSON.parse((f.mock.calls[2][1] as { body: string }).body).requestId
    expect(second).toBe(first)
  })
  it('AI draft fills the box, warns to review, never sends by itself', async () => {
    const f = stub([
      { ok: true, body: { conversationId: null, compose: can } },
      { ok: true, body: { subject: 'Your tour', body: 'Hi Amy, thanks for asking.' } },
    ])
    draw()
    fireEvent.click(await screen.findByTestId('compose-ai-draft'))
    await waitFor(() => expect(screen.getByLabelText('邮件正文')).toHaveValue('Hi Amy, thanks for asking.'))
    expect(screen.getByLabelText('邮件主题')).toHaveValue('Your tour')
    expect(screen.getByTestId('compose-ai-notice')).toBeInTheDocument()
    expect(f).toHaveBeenCalledTimes(2)
    expect(String(f.mock.calls[1][0])).toContain('/email/compose/draft')
    expect(String(f.mock.calls.map((c) => c[0]).join())).not.toMatch(/email\/compose$/)
  })

  it('AI draft failure shows the reason and keeps what was typed', async () => {
    stub([
      { ok: true, body: { conversationId: null, compose: can } },
      { ok: false, status: 502, body: { error: 'AI 暂时起草不出来' } },
    ])
    draw()
    fireEvent.change(await screen.findByLabelText('邮件正文'), { target: { value: 'mine' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByTestId('compose-ai-draft'))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI 暂时起草不出来')
    expect(screen.getByLabelText('邮件正文')).toHaveValue('mine')
  })
})
