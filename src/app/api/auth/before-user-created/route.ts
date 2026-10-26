import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'
import { isChinaPhoneSignupEnabled } from '@/lib/auth/china-phone-otp'

export const runtime = 'nodejs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(request: NextRequest) {
  const rawSecret = process.env.SUPABASE_AUTH_BEFORE_USER_CREATED_SECRET?.trim()
  if (!rawSecret) {
    return NextResponse.json({ error: 'Signup hook is not configured' }, { status: 503 })
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

  if (!isRecord(event) || !isRecord(event.user)) {
    return NextResponse.json({ error: 'Invalid hook request' }, { status: 400 })
  }

  const email = typeof event.user.email === 'string' ? event.user.email.trim() : ''
  const phone = typeof event.user.phone === 'string' ? event.user.phone.trim() : ''
  if (!email && phone) {
    if (isChinaPhoneSignupEnabled() && normalizeChinaPhone(phone)) {
      return NextResponse.json({})
    }
    return NextResponse.json({
      error: {
        http_code: 403,
        message: 'Phone-only account creation is not enabled.',
      },
    }, { status: 403 })
  }

  return NextResponse.json({})
}
