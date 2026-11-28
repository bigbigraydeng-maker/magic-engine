import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Webhook } from 'standardwebhooks'

vi.mock('@/lib/auth/china-phone-otp', () => ({
  isChinaPhoneSignupEnabled: () => process.env.CHINA_PHONE_OTP_ENABLED === 'true'
    && process.env.CHINA_PHONE_SIGNUP_ENABLED === 'true'
    && Number.parseInt(process.env.CHINA_PHONE_SMS_DAILY_MAX ?? '', 10) > 0,
}))

import { POST } from '../route'

const secret = `whsec_${Buffer.from('before-user-created-test-secret').toString('base64')}`
const signer = new Webhook(secret)

function request(payload: unknown, signedPayload: unknown = payload) {
  const id = 'before-user-created-test-1'
  const timestamp = new Date()
  const body = JSON.stringify(payload)
  const signedBody = JSON.stringify(signedPayload)
  const signature = signer.sign(id, timestamp, signedBody)
  return new NextRequest('http://localhost/api/auth/before-user-created', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': `${Math.floor(timestamp.getTime() / 1000)}`,
      'webhook-signature': signature,
    },
    body,
  })
}

describe('POST /api/auth/before-user-created', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_AUTH_BEFORE_USER_CREATED_SECRET', `v1,${secret}`)
    vi.stubEnv('CHINA_PHONE_OTP_ENABLED', 'true')
    vi.stubEnv('CHINA_PHONE_SIGNUP_ENABLED', 'false')
    vi.stubEnv('CHINA_PHONE_SMS_DAILY_MAX', '40')
  })

  it('rejects phone-only signups before Supabase creates an Auth user', async () => {
    const response = await POST(request({ user: { email: '', phone: '+8613800001380' } }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { http_code: 403 },
    })
  })

  it('allows existing email-based registration flows to keep creating users', async () => {
    const response = await POST(request({ user: { email: 'customer@example.com', phone: '' } }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  it('allows valid mainland phone-only users only when phone registration is enabled', async () => {
    vi.stubEnv('CHINA_PHONE_SIGNUP_ENABLED', 'true')
    const response = await POST(request({ user: { email: '', phone: '+8613800001380' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  it('does not enable non-mainland phone-only account creation', async () => {
    vi.stubEnv('CHINA_PHONE_SIGNUP_ENABLED', 'true')
    const response = await POST(request({ user: { email: '', phone: '+12025550123' } }))
    expect(response.status).toBe(403)
  })

  it('rejects invalid hook signatures', async () => {
    const response = await POST(request(
      { user: { email: 'customer@example.com', phone: '' } },
      { user: { email: '', phone: '+8613800001380' } },
    ))

    expect(response.status).toBe(401)
  })

  it('fails closed if the hook secret is missing', async () => {
    vi.stubEnv('SUPABASE_AUTH_BEFORE_USER_CREATED_SECRET', '')
    const response = await POST(request({ user: { email: 'customer@example.com', phone: '' } }))

    expect(response.status).toBe(503)
  })
})
