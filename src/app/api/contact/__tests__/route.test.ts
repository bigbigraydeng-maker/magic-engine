import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: mocks.send } })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}))

import { POST } from '../route'

function makeRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost:3001/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '王小明',
      email: 'Applicant@Example.com',
      company: '示例外贸公司',
      message: '希望参加第一批测试。',
      formType: 'meta_ads_ai_pilot',
      ...overrides,
    }),
  })
}

describe('POST /api/contact — Meta Ads AI pilot application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 're_test_only'
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    mocks.send.mockResolvedValue({ data: { id: 'email-id' }, error: null })
  })

  it('sends the internal notification before the Chinese applicant confirmation', async () => {
    const response = await POST(makeRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.send).toHaveBeenCalledTimes(2)

    const internal = mocks.send.mock.calls[0][0]
    const confirmation = mocks.send.mock.calls[1][0]
    expect(internal.to).toEqual(['hello@magicengine.cloud'])
    expect(internal.subject).toContain('Meta Ads AI 内测申请')
    expect(confirmation.to).toEqual(['applicant@example.com'])
    expect(confirmation.replyTo).toBe('hello@magicengine.cloud')
    expect(confirmation.subject).toBe('我们已收到你的 Meta Ads AI 内测申请')
    expect(confirmation.html).toContain('本轮采用邀请制')
    expect(confirmation.html).toContain('正在审核申请')
    expect(confirmation.html).toContain('无需向我们发送 Facebook 密码、广告报表或任何连接凭据')
    expect(confirmation.html).toContain('发送专属连接方式')
    expect(confirmation.html).toContain('申请已收到不代表已经批准或开通')
    expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[1])
  })

  it('does not send applicant confirmation when the internal notification fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.send.mockResolvedValueOnce({ data: null, error: { message: 'internal rejected' } })

    const response = await POST(makeRequest())

    expect(response.status).toBe(500)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      '[contact] Internal notification delivery failed:',
      expect.objectContaining({ message: 'internal rejected' }),
    )
    log.mockRestore()
  })

  it('reports a partial failure when applicant confirmation cannot be delivered', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.send
      .mockResolvedValueOnce({ data: { id: 'internal-id' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'confirmation rejected' } })

    const response = await POST(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body).toMatchObject({
      code: 'APPLICANT_CONFIRMATION_FAILED',
      received: true,
    })
    expect(body.error).toContain('申请已收到，但确认邮件发送失败')
    expect(log).toHaveBeenCalledWith(
      '[contact] Applicant confirmation delivery failed after internal notification succeeded:',
      expect.objectContaining({ message: 'confirmation rejected' }),
    )
    log.mockRestore()
  })

  it('keeps ordinary contact submissions on the existing single-email path', async () => {
    const response = await POST(makeRequest({ formType: undefined }))

    expect(response.status).toBe(200)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send.mock.calls[0][0].subject).toContain('New enquiry from')
  })
})
