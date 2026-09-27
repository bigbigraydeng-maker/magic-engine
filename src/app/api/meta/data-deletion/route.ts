import { NextResponse } from 'next/server'
import { parseSignedRequest, processDeletion } from '@/lib/meta-oauth/data-deletion'

/**
 * Meta data deletion callback: POST application/x-www-form-urlencoded with `signed_request`.
 * Answers { url, confirmation_code } as Meta requires; the url is our public status page.
 * Never logs the Facebook user id.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.FACEBOOK_APP_SECRET
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!secret || !origin) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

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
    const result = await processDeletion(parsed)
    const url = `${new URL(origin).origin}/data-deletion/status?code=${encodeURIComponent(result.confirmationCode)}`
    return NextResponse.json({ url, confirmation_code: result.confirmationCode })
  } catch {
    console.error('[meta-data-deletion] processing failed')
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
