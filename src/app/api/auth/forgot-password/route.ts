import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest): Promise<NextResponse> {
  let email: string
  try {
    const body = (await req.json()) as { email?: unknown }
    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
    }
    email = body.email.trim().toLowerCase()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://magicengine.com.au'
  const redirectTo = `${siteUrl}/portal/reset-password`

  // Always return success to prevent email enumeration
  await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo })

  return NextResponse.json({ success: true })
}
