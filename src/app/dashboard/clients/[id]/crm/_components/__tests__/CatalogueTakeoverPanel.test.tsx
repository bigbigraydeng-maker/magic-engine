/**
 * 抽屉里的「📘 目录」块：先看整封信再发；被挡直接写服务端给的原因；发出后显示「AI 跟进中」+「收回人工」。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CatalogueTakeoverPanel } from '../CatalogueTakeoverPanel'
import { AiTakeoverTag } from '../AiTakeoverTag'

const BASE = '/api/clients/cts/crm/contacts/c1'

const offView = {
  takeover: { on: false, offAt: null, actor: null },
  cameBack: null,
  catalogue: { templateKey: 'catalogue-send', versionLabel: 'v9', validUntil: '2026-12-31' },
  compose: { canCompose: true, recipient: 'amy@example.com', mailbox: 'info@example.com', sentToContactLast7Days: 0 },
}
const onView = {
  ...offView,
  takeover: { on: true, since: '2026-11-10T01:32:00Z', actor: 'lisa@example.com' },
  cameBack: { kind: 'email', at: '2026-11-11T01:00:00Z' },
}

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => ({ ok: status === 200, status, json: async () => body })

function route(handlers: Record<string, () => ReturnType<typeof reply>>) {
  fetchMock.mockImplementation(async (url: string) => {
    const h = handlers[url.replace(BASE, '')]
    return h ? h() : reply(404, {})
  })
}

const btn = (text: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('CatalogueTakeoverPanel', () => {
  it('shows the letter first, then sends to the shown address with a request id', async () => {
    route({
      '/ai-takeover': () => reply(200, offView),
      '/email/template-preview': () => reply(200, { rendered: { subject: 'Your brochure', body: 'Kia ora Amy' } }),
      '/catalogue-send': () => reply(200, { ok: true, sent: true, duplicate: false, versionLabel: 'v9', since: 'x' }),
    })
    const onSaved = vi.fn()
    render(<CatalogueTakeoverPanel clientId="cts" contactId="c1" name="Amy" onSaved={onSaved} />)
    await screen.findByText('amy@example.com')
    fireEvent.click(btn('先看一眼信')!)
    await screen.findByText('Your brochure')
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/catalogue-send'))).toBe(false)
    fireEvent.click(btn('确认发送')!)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.stringContaining('目录已发出'), true))
    const sendCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/catalogue-send'))!
    const body = JSON.parse(String((sendCall[1] as RequestInit).body)) as { requestId: string; expectedRecipient: string }
    expect(body.expectedRecipient).toBe('amy@example.com')
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('a refusal shows the server\'s plain reason', async () => {
    route({
      '/ai-takeover': () => reply(200, offView),
      '/email/template-preview': () => reply(200, { rendered: { subject: 'S', body: 'B' } }),
      '/catalogue-send': () => reply(409, { ok: false, sent: false, reason: 'frequency_capped', message: '他这周已经收了 2 封邮件。' }),
    })
    render(<CatalogueTakeoverPanel clientId="cts" contactId="c1" name="Amy" onSaved={vi.fn()} />)
    await screen.findByText('amy@example.com')
    fireEvent.click(btn('先看一眼信')!)
    await screen.findByText('S')
    fireEvent.click(btn('确认发送')!)
    await screen.findByText('他这周已经收了 2 封邮件。')
  })

  it('no usable address: the button is grey with the reason', async () => {
    route({ '/ai-takeover': () => reply(200, { ...offView, compose: { canCompose: false, message: '这个客人没有可用的邮箱。' } }) })
    render(<CatalogueTakeoverPanel clientId="cts" contactId="c1" name="Amy" onSaved={vi.fn()} />)
    await screen.findByText('这个客人没有可用的邮箱。')
    expect(btn('先看一眼信')!.disabled).toBe(true)
  })

  it('in takeover: says so, shows "came back", and 收回人工 posts the manual off', async () => {
    route({
      '/ai-takeover': () => reply(200, onView),
      '/ai-takeover-off': () => reply(200, { ok: true, alreadyOff: false }),
    })
    const onSaved = vi.fn()
    render(<CatalogueTakeoverPanel clientId="cts" contactId="c1" name="Amy" onSaved={onSaved} />)
    await screen.findByText(/系统在跟进这位客人/)
    expect(screen.getByText(/客人回来了/)).toBeTruthy()
    fireEvent.click(btn('收回人工')!)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.stringContaining('已收回人工'), true))
    const off = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/ai-takeover-off'))!
    expect(JSON.parse(String((off[1] as RequestInit).body))).toHaveProperty('clientRef')
  })

  it('an unrecognised reply is "could not read", not a half-drawn card', async () => {
    route({ '/ai-takeover': () => reply(200, { timeline: [] }) })
    render(<CatalogueTakeoverPanel clientId="cts" contactId="c1" name="Amy" onSaved={vi.fn()} />)
    await screen.findByText(/暂时读不到/)
  })
})

describe('AiTakeoverTag', () => {
  it('"客人回来了" wins over "AI 跟进中"; nothing when not in takeover', () => {
    const { rerender, container } = render(<AiTakeoverTag aiTakeover cameBack />)
    expect(container.textContent).toBe('客人回来了')
    rerender(<AiTakeoverTag aiTakeover />)
    expect(container.textContent).toBe('AI 跟进中')
    rerender(<AiTakeoverTag />)
    expect(container.textContent).toBe('')
  })
})
