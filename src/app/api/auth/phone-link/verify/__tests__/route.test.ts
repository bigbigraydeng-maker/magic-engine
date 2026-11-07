import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  phoneLinkAccessForUser: vi.fn(),
  consumeQuota: vi.fn(),
  verifyChinaPhoneCode: vi.fn(),
  updateUserById: vi.fn(),
}))

vi.mock('@/lib/auth/require-session', () => ({ requireSession: mocks.requireSession }))
vi.mock('@/lib/auth/phone-link-access', () => ({ phoneLinkAccessForUser: mocks.phoneLinkAccessForUser }))
vi.mock('@/lib/zhangqian/rate-limiter', () => ({
  consumeQuota: mocks.consumeQuota,
  dayStartUtc: () => '2026-09-30T00:00:00.000Z',
  QuotaUnavailable: class QuotaUnavailable extends Error {},
}))
vi.mock('@/lib/sms/aliyun-pnvs', () => ({ verifyChinaPhoneCode: mocks.verifyChinaPhoneCode }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { auth: { admin: { updateUserById: mocks.updateUserById } } },
}))
vi.mock('@/lib/auth/china-phone-otp', () => ({
  isChinaPhoneOtpEnabled: () => process.env.CHINA_PHONE_OTP_ENABLED === 'true',
  phoneQuotaKey: (value: string) => `hashed-${value}`,
}))

import { POST } from '../route'

function request(body: unknown) {
  return new NextRequest('http://localhost/api/auth/phone-link/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/phone-link/verify', () => {
  beforeEach(() => {
    vi.stubEnv('CHINA_PHONE_OTP_ENABLED', 'true')
    mocks.requireSession.mockReset().mockResolvedValue({
      ok: true,
      user: { id: 'user-1', email: 'customer@example.com', phone: null, phone_confirmed_at: null },
    })
    mocks.phoneLinkAccessForUser.mockReset().mockResolvedValue('allowed')
    mocks.consumeQuota.mockReset().mockResolvedValue(true)
    mocks.verifyChinaPhoneCode.mockReset().mockResolvedValue(true)
    mocks.updateUserById.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  })

  it('rejects an invalid phone or code before touching the provider', async () => {
    const response = await POST(request({ phone: '+1 202 555 0123', code: '123456' }))

    expect(response.status).toBe(400)
    expect(mocks.verifyChinaPhoneCode).not.toHaveBeenCalled()
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('fails closed when the persistent verification quota is unavailable or exhausted', async () => {
    mocks.consumeQuota.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await POST(request({ phone: '13800001380', code: '123456' }))).status).toBe(503)
    expect(mocks.verifyChinaPhoneCode).not.toHaveBeenCalled()

    mocks.consumeQuota.mockResolvedValueOnce(false)
    expect((await POST(request({ phone: '13800001380', code: '123456' }))).status).toBe(429)
    expect(mocks.verifyChinaPhoneCode).not.toHaveBeenCalled()
  })

  it('does not link an unverified code', async () => {
    mocks.verifyChinaPhoneCode.mockResolvedValue(false)
    const response = await POST(request({ phone: '13800001380', code: '000000' }))

    expect(response.status).toBe(400)
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('updates the current Auth user only after the PNVS code passes', async () => {
    const response = await POST(request({ phone: '13800001380', code: '123456' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mocks.verifyChinaPhoneCode).toHaveBeenCalledWith('+8613800001380', '123456')
    expect(mocks.consumeQuota).toHaveBeenCalledWith(
      'auth_phone_link_complete',
      'user-1',
      '2026-09-30T00:00:00.000Z',
      1,
    )
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', {
      phone: '+8613800001380',
      phone_confirm: true,
    })
    expect(mocks.consumeQuota).toHaveBeenCalledWith(
      'auth_phone_link_phone_verify',
      'hashed-+8613800001380',
      '2026-09-30T00:00:00.000Z',
      10,
    )
  })

  it('prevents two valid phone numbers from racing to bind the same account', async () => {
    mocks.consumeQuota.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const response = await POST(request({ phone: '13800001380', code: '123456' }))

    expect(response.status).toBe(409)
    expect(mocks.verifyChinaPhoneCode).toHaveBeenCalled()
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('fails closed if the number cannot be attached to this account', async () => {
    mocks.updateUserById.mockResolvedValue({ data: { user: null }, error: { message: 'phone_exists' } })
    const response = await POST(request({ phone: '13800001380', code: '123456' }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '此手机号不能绑定到当前账号，请联系管理员' })
  })
})
