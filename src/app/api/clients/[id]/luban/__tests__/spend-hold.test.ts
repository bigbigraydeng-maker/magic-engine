import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  chat: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from() { throw new Error('no db') } },
}))
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.access,
}))
vi.mock('@/lib/kernel', () => ({ createKernel: vi.fn(() => ({ name: 'kernel' })) }))
vi.mock('@/lib/luban/project-agent', () => ({ chatWithProjectLuban: mocks.chat }))
vi.mock('@/lib/confirmation-card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/confirmation-card')>()
  return { ...actual, issueConfirmationCard: vi.fn(async () => ({ what: '开投' })) }
})

import { POST } from '../route'
import { issueConfirmationCard } from '@/lib/confirmation-card'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const issue = vi.mocked(issueConfirmationCard)

function adminAccess() {
  return {
    ok: true as const,
    user: { email: 'opc@example.com' },
    role: 'admin' as const,
    tier: 'admin' as const,
    allowedClientId: null,
  }
}

function post(message: string, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/clients/${CLIENT}/luban`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ message }),
    }) as never,
    { params: { id: CLIENT } },
  )
}

describe('luban drawer spend hold', () => {
  beforeEach(() => {
    mocks.access.mockResolvedValue(adminAccess())
    mocks.chat.mockReset()
    issue.mockClear()
  })

  it('does not call the chat model for a launch order', async () => {
    const res = await post('开投，每天 100')
    const body = await res.json() as { executed?: boolean; held?: boolean }
    expect(res.status).toBe(200)
    expect(body.executed).toBe(false)
    expect(body.held).toBe(true)
    expect(issue).toHaveBeenCalledTimes(1)
    expect(mocks.chat).not.toHaveBeenCalled()
  })

  it('does not treat 确认 as a click or as a chat turn', async () => {
    const res = await post('确认')
    const body = await res.json() as { reply?: string; executed?: boolean }
    expect(body.executed).toBe(false)
    expect(body.reply).toContain('不算')
    expect(issue).not.toHaveBeenCalled()
    expect(mocks.chat).not.toHaveBeenCalled()
  })

  it('still chats about an ordinary question', async () => {
    mocks.chat.mockResolvedValue({ reply: '先看处方。', input_tokens: 1, output_tokens: 1, cost_usd: 0 })
    const res = await post('现在最该先推进什么')
    expect(res.status).toBe(200)
    expect(mocks.chat).toHaveBeenCalledTimes(1)
    expect(issue).not.toHaveBeenCalled()
  })

  it('marks an agent caller and still does not chat', async () => {
    const res = await post('开投', { 'x-me-actor': 'agent' })
    expect(res.status).toBe(200)
    expect(issue.mock.calls[0]?.[1].clicker).toMatchObject({ kind: 'agent' })
    expect(mocks.chat).not.toHaveBeenCalled()
  })
})
