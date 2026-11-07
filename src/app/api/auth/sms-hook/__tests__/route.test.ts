import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Webhook } from 'standardwebhooks'

const mocks = vi.hoisted(() => ({
  sendChinaVerificationCode: vi.fn(),
  phoneOtpAccessForIdentity: vi.fn(),
  consumeQuota: vi.fn(),
}))

vi.mock('@/lib/sms/aliyun-pnvs', () => ({ sendChinaVerificationCode: mocks.sendChinaVerificationCode }))
vi.mock('@/lib/auth/phone-link-access', () => ({ phoneOtpAccessForIdentity: mocks.phoneOtpAccessForIdentity }))
vi.mock('@/lib/zhangqian/rate-limiter', () => ({
  consumeQuota: mocks.consumeQuota,
  dayStartUtc: () => '2026-09-30T00:00:00.000Z',
}))
vi.mock('@/lib/auth/china-phone-otp', () => ({
  isChinaPhoneOtpEnabled: () => process.env.CHINA_PHONE_OTP_ENABLED === 'true',
  isChinaPhoneSignupEnabled: () => process.env.CHINA_PHONE_OTP_ENABLED === 'true'
    && process.env.CHINA_PHONE_SIGNUP_ENABLED === 'true'
    && Number.parseInt(process.env.CHINA_PHONE_SMS_DAILY_MAX ?? '', 10) > 0,
  chinaPhoneSmsDailyMax: () => Number.parseInt(process.env.CHINA_PHONE_SMS_DAILY_MAX ?? '', 10) || null,
  phoneQuotaKey: (value: string) => `hashed-${value}`,
}))

import { POST } from '../route'

const webhookSecret = `whsec_${Buffer.from('isolated-test-secret').toString('base64')}`
const signer = new Webhook(webhookSecret)

function request(rawBody: string, signedBody = rawBody) {
  const id = 'hook-test-1'
  const timestamp = new Date()
  const signature = signer.sign(id, timestamp, signedBody)
  return new NextRequest('http://localhost/api/auth/sms-hook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': `${Math.floor(timestamp.getTime() / 1000)}`,
      'webhook-signature': signature,
    },
    body: rawBody,
  })
}

describe('POST /api/auth/sms-hook', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_AUTH_SMS_HOOK_SECRET', `v1,${webhookSecret}`)
    vi.stubEnv('CHINA_PHONE_OTP_ENABLED', 'true')
    vi.stubEnv('CHINA_PHONE_SIGNUP_ENABLED', 'false')
    mocks.sendChinaVerificationCode.mockReset().mockResolvedValue(undefined)
    mocks.phoneOtpAccessForIdentity.mockReset().mockResolvedValue('allowed')
    mocks.consumeQuota.mockReset().mockResolvedValue(true)
  })

  it('rejects requests with an invalid webhook signature', async () => {
    const body = JSON.stringify({ user: { id: 'user-1', email: 'customer@example.com', phone: '+8613800001380', phone_confirmed_at: '2026-01-01' }, sms: { otp: '123456' } })
    const tampered = JSON.stringify({ user: { id: 'user-1', email: 'customer@example.com', phone: '+8613800001380', phone_confirmed_at: '2026-01-01' }, sms: { otp: '000000' } })
    const response = await POST(request(tampered, body))

    expect(response.status).toBe(401)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('verifies the raw payload and sends the exact GoTrue code through the provider', async () => {
    const payload = { user: { id: 'user-1', email: 'customer@example.com', phone: '+8613800001380', phone_confirmed_at: '2026-01-01' }, sms: { otp: '123456' } }
    const rawBody = JSON.stringify(payload)
    const response = await POST(request(rawBody))

    expect(response.status).toBe(200)
    expect(mocks.sendChinaVerificationCode).toHaveBeenCalledWith('+8613800001380', 'auth', '123456')
    expect(mocks.consumeQuota).toHaveBeenCalledWith('auth_sms_hook_phone_daily', 'hashed-+8613800001380', '2026-09-30T00:00:00.000Z', 5)
    expect(mocks.consumeQuota).toHaveBeenCalledWith('auth_sms_hook_user_daily', 'user-1', '2026-09-30T00:00:00.000Z', 5)
  })

  it('does not send unsupported numbers or malformed codes', async () => {
    const user = { id: 'user-1', email: 'customer@example.com', phone_confirmed_at: '2026-01-01' }
    const unsupported = JSON.stringify({ user: { ...user, phone: '+12025550123' }, sms: { otp: '123456' } })
    expect((await POST(request(unsupported))).status).toBe(400)

    const malformed = JSON.stringify({ user: { ...user, phone: '+8613800001380' }, sms: { otp: 'ABC123' } })
    expect((await POST(request(malformed))).status).toBe(400)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('returns a generic failure if SMS delivery fails', async () => {
    mocks.sendChinaVerificationCode.mockRejectedValue(new Error('provider credentials'))
    const response = await POST(request(JSON.stringify({
      user: { id: 'user-1', email: 'customer@example.com', phone: '+8613800001380', phone_confirmed_at: '2026-01-01' },
      sms: { otp: '123456' },
    })))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'SMS delivery failed' })
  })

  it('fails closed when the hook secret is not configured', async () => {
    vi.stubEnv('SUPABASE_AUTH_SMS_HOOK_SECRET', '')
    const response = await POST(request('{}'))

    expect(response.status).toBe(503)
  })

  it('sends a linking code to an existing customer and does not disclose non-customer eligibility', async () => {
    const unconfirmed = JSON.stringify({
      user: { id: 'user-1', email: 'customer@example.com', phone: '+8613800001380', phone_confirmed_at: null },
      sms: { otp: '123456' },
    })
    expect((await POST(request(unconfirmed))).status).toBe(200)
    expect(mocks.sendChinaVerificationCode).toHaveBeenCalledWith('+8613800001380', 'auth', '123456')
    mocks.sendChinaVerificationCode.mockClear()

    mocks.phoneOtpAccessForIdentity.mockResolvedValue('denied')
    const denied = JSON.stringify({
      user: { id: 'user-1', email: 'other@example.com', phone: '+8613800001380', phone_confirmed_at: '2026-01-01' },
      sms: { otp: '123456' },
    })
    expect((await POST(request(denied))).status).toBe(200)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('deduplicates webhook replays and checks phone/customer quotas before delivery', async () => {
    const rawBody = JSON.stringify({
      user: { id: 'user-1', email: 'customer@example.com', phone: '+8613800001380', phone_confirmed_at: '2026-01-01' },
      sms: { otp: '123456' },
    })
    mocks.consumeQuota.mockResolvedValueOnce(false)

    const response = await POST(request(rawBody))

    expect(response.status).toBe(200)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('stays closed when the application has not enabled phone authentication', async () => {
    vi.stubEnv('CHINA_PHONE_OTP_ENABLED', 'false')
    const response = await POST(request(JSON.stringify({
      user: { id: 'user-1', email: 'customer@example.com', phone: '+8613800001380', phone_confirmed_at: '2026-01-01' },
      sms: { otp: '123456' },
    })))

    expect(response.status).toBe(503)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('does not deliver when a customer/phone quota is exhausted or membership lookup is unavailable', async () => {
    const rawBody = JSON.stringify({
      user: { id: 'user-1', email: 'customer@example.com', phone: '+8613800001380', phone_confirmed_at: '2026-01-01' },
      sms: { otp: '123456' },
    })
    mocks.consumeQuota.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await POST(request(rawBody))).status).toBe(429)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()

    mocks.phoneOtpAccessForIdentity.mockResolvedValue('unavailable')
    expect((await POST(request(rawBody))).status).toBe(503)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })

  it('sends the initial signup OTP to an unconfirmed phone-only Auth identity when enabled', async () => {
    vi.stubEnv('CHINA_PHONE_SIGNUP_ENABLED', 'true')
    vi.stubEnv('CHINA_PHONE_SMS_DAILY_MAX', '40')
    mocks.phoneOtpAccessForIdentity.mockResolvedValue('none')
    const response = await POST(request(JSON.stringify({
      user: { id: 'new-phone-user', email: '', phone: '+8613800001380', phone_confirmed_at: null },
      sms: { otp: '123456' },
    })))

    expect(response.status).toBe(200)
    expect(mocks.sendChinaVerificationCode).toHaveBeenCalledWith('+8613800001380', 'auth', '123456')
    expect(mocks.consumeQuota).toHaveBeenCalledWith('auth_sms_hook_total_daily', 'china-phone-sms', '2026-09-30T00:00:00.000Z', 40)
  })

  it('fails closed for phone signup when the system-wide daily SMS budget is not configured', async () => {
    vi.stubEnv('CHINA_PHONE_SIGNUP_ENABLED', 'true')
    vi.stubEnv('CHINA_PHONE_SMS_DAILY_MAX', '')
    mocks.phoneOtpAccessForIdentity.mockResolvedValue('none')
    const response = await POST(request(JSON.stringify({
      user: { id: 'new-phone-user', email: '', phone: '+8613800001380', phone_confirmed_at: null },
      sms: { otp: '123456' },
    })))

    expect(response.status).toBe(503)
    expect(mocks.sendChinaVerificationCode).not.toHaveBeenCalled()
  })
})
