import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZhugeWorkbenchDrawer } from '../ZhugeWorkbenchDrawer'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const CARD = {
  runId: '40000000-0000-4000-8000-000000001111',
  expectedDecisionId: 'dec00000-0000-4000-8000-000000000001',
  fingerprint: 'a'.repeat(64),
  what: '开投',
  account: '读不到具体账户',
  amount: '读不到',
  date: '读不到具体日期',
  scope: '工具：确认卡。只出卡，不执行。原话：开投',
  expiresLabel: '请在半小时内点。',
  statusLine: '还没人点。',
  confirmEnabled: true,
  declineEnabled: true,
  blockedReason: null,
}

describe('Zhuge drawer confirmation card', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    let listed = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/luban') && method === 'GET') {
        return new Response(JSON.stringify({ messages: [] }), { status: 200 })
      }
      if (url.includes('/luban') && method === 'POST') {
        listed = true
        return new Response(JSON.stringify({
          success: true,
          held: true,
          executed: false,
          reply: '已出确认卡，还没有执行。',
        }), { status: 200 })
      }
      if (url.includes('/confirmation-cards') && !url.includes('/decision')) {
        return new Response(JSON.stringify({ cards: listed ? [CARD] : [] }), { status: 200 })
      }
      if (url.includes('/decision')) {
        return new Response(JSON.stringify({
          ...CARD,
          confirmEnabled: false,
          declineEnabled: false,
          statusLine: 'opc@example.com 点了确认。这件事还没有开始做。',
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'no' }), { status: 404 })
    }))
  })

  it('shows the card and posts the button to the card route, not back into chat', async () => {
    render(<ZhugeWorkbenchDrawer clientId={CLIENT} isOpen onClose={() => undefined} />)
    const box = await screen.findByPlaceholderText(/直接问诸葛亮/)
    fireEvent.change(box, { target: { value: '开投，每天 100' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    const confirm = await screen.findByRole('button', { name: '确认' })
    fireEvent.click(confirm)
    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const decision = fetchMock.mock.calls.find((call) => String(call[0]).includes('/decision'))
      expect(decision).toBeTruthy()
      const body = JSON.parse(String(decision?.[1]?.body)) as { resolution?: string }
      expect(body.resolution).toBe('confirm')
    })
    const fetchMock = vi.mocked(fetch)
    const chatPosts = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0])
      return url.includes('/luban') && (call[1]?.method ?? 'GET') === 'POST'
    })
    expect(chatPosts).toHaveLength(1)
    expect(String(chatPosts[0]?.[1]?.body)).toContain('开投')
    expect(String(chatPosts[0]?.[1]?.body)).not.toContain('确认')
    expect(await screen.findByText(/还没有开始做/)).toBeInTheDocument()
  })
})
