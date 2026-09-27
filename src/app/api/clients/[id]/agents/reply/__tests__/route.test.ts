import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 这条路由此前没有任何测试（魏征 2026-09-28 复审 B1 实现时点名）。这次只补
 * 新加的行业闸这一条行为——不是给整条路由补全套测试，范围之外。
 */

const mockRequire = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: (...a: unknown[]) => mockRequire(...a),
}))

const mockGate = vi.fn()
vi.mock('@/lib/clients/industry-guard', () => ({
  clientHasIndustryFeature: (...a: unknown[]) => mockGate(...a),
}))

const mockSendMailReply = vi.fn()
vi.mock('@/lib/microsoft/mail-send', () => ({
  sendMailReply: (...a: unknown[]) => mockSendMailReply(...a),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => ({ update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }) },
}))

import { POST } from '../route'

function makeReq(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
    url: 'http://localhost/api/clients/clientA/agents/reply',
  } as Request
}

describe('POST /api/clients/[id]/agents/reply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequire.mockResolvedValue({ ok: true, user: { email: 'fde@magicengine.cloud' } })
    mockSendMailReply.mockResolvedValue({ ok: true, messageId: 'm1' })
  })

  it('🔴 非旅游客户 → 403，在真的发信之前挡下（2026-09-28）', async () => {
    mockGate.mockResolvedValue(false)
    const res = await POST(
      makeReq({ conversationId: '00000000-0000-0000-0000-000000000000', body: 'hi' }),
      { params: Promise.resolve({ id: 'clientA' }) },
    )
    expect(res.status).toBe(403)
    expect(mockSendMailReply).not.toHaveBeenCalled()
  })

  it('旅游客户 → 闸放行，照常发信', async () => {
    mockGate.mockResolvedValue(true)
    const res = await POST(
      makeReq({ conversationId: '00000000-0000-0000-0000-000000000000', body: 'hi' }),
      { params: Promise.resolve({ id: 'clientA' }) },
    )
    expect(res.status).toBe(200)
    expect(mockSendMailReply).toHaveBeenCalledOnce()
  })
})
