import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'
import { sendChinaVerificationCode } from '@/lib/sms/aliyun-pnvs'
import { phoneOtpAccessForIdentity } from '@/lib/auth/phone-link-access'
import { consumeQuota, dayStartUtc } from '@/lib/zhangqian/rate-limiter'
import { chinaPhoneSmsDailyMax, isChinaPhoneOtpEnabled, isChinaPhoneSignupEnabled, phoneQuotaKey } from '@/lib/auth/china-phone-otp'

export const runtime = 'nodejs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(request: NextRequest) {
  if (!isChinaPhoneOtpEnabled()) {
    return NextResponse.json({ error: 'Phone OTP is not enabled' }, { status: 503 })
  }

  const rawSecret = process.env.SUPABASE_AUTH_SMS_HOOK_SECRET?.trim()
  if (!rawSecret) {
    return NextResponse.json({ error: 'SMS hook is not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  if (rawBody.length > 16_384) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 413 })
  }

  let event: unknown
  try {
    const webhook = new Webhook(rawSecret.replace(/^v1,/, ''))
    event = webhook.verify(rawBody, {
      'webhook-id': request.headers.get('webhook-id') ?? '',
      'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',
      'webhook-signature': request.headers.get('webhook-signature') ?? '',
    })
  } catch {
    return NextResponse.json({ error: 'Invalid hook signature' }, { status: 401 })
  }

  if (!isRecord(event) || !isRecord(event.user) || !isRecord(event.sms)) {
    return NextResponse.json({ error: 'Invalid hook request' }, { status: 400 })
  }

  const phone = normalizeChinaPhone(event.user.phone)
  const otp = event.sms.otp
  const email = typeof event.user.email === 'string' ? event.user.email : ''
  const userId = typeof event.user.id === 'string' ? event.user.id : ''
  if (
    !phone
    || !userId
    || typeof otp !== 'string'
    || !/^\d{4,8}$/.test(otp)
  ) {
    return NextResponse.json({ error: 'Invalid hook request' }, { status: 400 })
  }

  const signupEnabled = isChinaPhoneSignupEnabled()
  if (process.env.CHINA_PHONE_SIGNUP_ENABLED === 'true' && !signupEnabled) {
    return NextResponse.json({ error: 'SMS service is temporarily unavailable' }, { status: 503 })
  }
  // Existing customer identities must be eligible. A phone-only identity with
  // no workspace is allowed to receive the initial code only while public
  // self-service phone signup is explicitly enabled.
  const access = await phoneOtpAccessForIdentity(userId, email)
  if (access === 'unavailable') return NextResponse.json({ error: 'SMS service is temporarily unavailable' }, { status: 503 })
  if (access === 'denied' || (access === 'none' && !signupEnabled)) {
    // Do not disclose account or customer eligibility through Hook responses.
    return new NextResponse(null, { status: 200 })
  }

  const webhookId = request.headers.get('webhook-id')
  if (!webhookId) return NextResponse.json({ error: 'Invalid hook request' }, { status: 400 })

  try {
    const firstDelivery = await consumeQuota(
      'auth_sms_hook_event',
      phoneQuotaKey(webhookId),
      dayStartUtc(),
      1,
    )
    if (!firstDelivery) return new NextResponse(null, { status: 200 })

    const phoneAllowed = await consumeQuota(
      'auth_sms_hook_phone_daily',
      phoneQuotaKey(phone),
      dayStartUtc(),
      5,
    )
    if (!phoneAllowed) return NextResponse.json({ error: 'SMS limit reached' }, { status: 429 })

    const userAllowed = await consumeQuota(
      'auth_sms_hook_user_daily',
      userId,
      dayStartUtc(),
      5,
    )
    if (!userAllowed) return NextResponse.json({ error: 'SMS limit reached' }, { status: 429 })

    if (signupEnabled) {
      const dailyCap = chinaPhoneSmsDailyMax()!
      const globalAllowed = await consumeQuota(
        'auth_sms_hook_total_daily',
        'china-phone-sms',
        dayStartUtc(),
        dailyCap,
      )
      if (!globalAllowed) return NextResponse.json({ error: 'SMS limit reached' }, { status: 429 })
    }
  } catch {
    return NextResponse.json({ error: 'SMS service is temporarily unavailable' }, { status: 503 })
  }

  try {
    await sendChinaVerificationCode(phone, 'auth', otp)
    return new NextResponse(null, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'SMS delivery failed' }, { status: 502 })
  }
}
