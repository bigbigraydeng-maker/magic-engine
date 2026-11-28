import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  phoneLinkAccessForUser: vi.fn(),
  consumeQuota: vi.fn(),
  sendChinaVerificationCode: vi.fn(),
}))

vi.mock('@/lib/auth/require-session', () => ({ requireSession: mocks.requireSession }))
vi.mock('@/lib/auth/phone-link-access', () => ({ phoneLinkAccessForUser: mocks.phoneLinkAccessForUser }))
vi.mock('@/lib/zhangqian/rate-limiter', () => ({
  consumeQuota: mocks.consumeQuota,
  dayStartUtc: () => '2026-09-30T00:00:00.000Z',
  QuotaUnavailable: class QuotaUnavailable extends Error {},
}))
vi.mock('@/lib/sms/aliyun-pnvs', () => ({ sendChinaVerificationCode: mocks.sendChinaVerificationCode }))
vi.mock('@/lib/auth/china-phone-otp', () => ({
  isChinaPhoneOtpEnabled: () => process.env.CHINA_PHONE_OTP_ENABLED === 'true',
  phoneQuotaKey: (value: string) => `hashed-${value}`,
}))

import { POST } from '../route'

function request(body: unknown) {
  return new NextRequest('http://localhost/api/auth/phone-link/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/phone-link/send', () => {
  beforeEach(() => {
    vi.stubEnv('CHINA_PHONE_OTP_ENABLED', 'true')
    mocks.requireSession.mockReset().mockResolvedValue({
      ok: true,
      user: { id: 'user-1', email: 'customer@example.com', phone: null, phone_confirmed_at: null },
    })
    mocks.phoneLinkAccessForUser.mockReset().mockResolvedValue('allowed')
    mocks.consumeQuota.mockReset().mockResolvedValue(true)
    mocks.sendChinaVerificationCode.mockReset().mockResolvedValue(undefined)
  })

  it('requires a signed-in session', async () => {
    mocks.requireSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const response = await POST(request({ phone: '13800001380' }))

    expect(response.status).toBe(401)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('rejects staff and non-customer identities', async () => {
    mocks.phoneLinkAccessForUser.mockResolvedValue('denied')
    const response = await POST(request({ phone: '13800001380' }))

    expect(response.status).toBe(403)
    expect(mocks.consumeQuota).not.toHaveBeenCalled()
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('rejects non-mainland phone numbers before rate-limit or provider calls', async () => {
    const response = await POST(request({ phone: '+1 202 555 0123' }))

    expect(response.status).toBe(400)
    expect(mocks.consumeQuota).not.toHaveBeenCalled()
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('fails closed on quota store errors and exhausted quotas', async () => {
    mocks.consumeQuota.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await POST(request({ phone: '13800001380' }))).status).toBe(503)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()

    mocks.consumeQuota.mockResolvedValueOnce(false)
    expect((await POST(request({ phone: '13800001380' }))).status).toBe(429)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('sends a PNVS-managed code after the persistent per-user quota allows it', async () => {
    const response = await POST(request({ phone: '13800001380' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mocks.consumeQuota).toHaveBeenCalledWith(
      'auth_phone_link_send',
      'user-1',
      '2026-09-30T00:00:00.000Z',
      5,
    )
    expect(mocks.consumeQuota).toHaveBeenCalledWith(
      'auth_phone_link_phone_send',
      'hashed-+8613800001380',
      '2026-09-30T00:00:00.000Z',
      5,
    )
    expect(mocks.sendChinaVerificationCode).toHaveBeenCalledWith('+8613800001380', 'phone-link')
  })

  it('does not allow changing a verified phone through the bind flow', async () => {
    mocks.requireSession.mockResolvedValue({
      ok: true,
      user: {
        id: 'user-1', email: 'customer@example.com', phone: '+8613999999999',
        phone_confirmed_at: '2026-09-01T00:00:00.000Z',
      },
    })
    const response = await POST(request({ phone: '13800001380' }))

    expect(response.status).toBe(409)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('keeps binding closed until the operator enables configured phone authentication', async () => {
    vi.stubEnv('CHINA_PHONE_OTP_ENABLED', 'false')
    const response = await POST(request({ phone: '13800001380' }))

    expect(response.status).toBe(503)
    expect(mocks.requireSession).not.toHaveBeenCalled()
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })
})
