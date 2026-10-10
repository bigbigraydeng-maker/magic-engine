import { NextResponse } from 'next/server'
import { parseSignedRequest, processDeletion, recordDeletionFailure } from '@/lib/meta-oauth/data-deletion'

/** Meta's form body is a few hundred bytes; refuse anything large before reading it (狄仁杰 2026-09-27). */
const MAX_BODY_BYTES = 8192

/**
 * Meta data deletion callback: POST application/x-www-form-urlencoded with `signed_request`.
 * Answers { url, confirmation_code } as Meta requires; the url is our public status page.
 * Never logs the Facebook user id.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.FACEBOOK_APP_SECRET
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!secret || !origin) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  let signed: string | null = null
  try {
    const form = await request.formData()
    const value = form.get('signed_request')
    signed = typeof value === 'string' ? value : null
  } catch {
    signed = null
  }
  if (!signed || signed.length > 4096) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  const parsed = parseSignedRequest(signed, secret, Math.floor(Date.now() / 1000))
  if (!parsed) return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })

  try {
    const result = await processDeletion(parsed, secret)
    const url = `${new URL(origin).origin}/data-deletion/status?code=${encodeURIComponent(result.confirmationCode)}`
    return NextResponse.json({ url, confirmation_code: result.confirmationCode })
  } catch {
    console.error('[meta-data-deletion] processing failed')
    await recordDeletionFailure(parsed, secret)
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
