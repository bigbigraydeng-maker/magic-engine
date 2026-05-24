/**
 * POST /api/auth/magic-link
 *
 * Server-side magic link sender for admin login.
 * Uses supabaseAdmin (no PKCE) so the resulting link works regardless of
 * which browser or email client the user clicks it from.
 *
 * Body: { email: string; redirectTo: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest): Promise<NextResponse> {
  let email: string, redirectTo: string

  try {
    const body = (await req.json()) as { email?: unknown; redirectTo?: unknown }
    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json({ error: 'email is required.' }, { status: 400 })
    }
    if (!body.redirectTo || typeof body.redirectTo !== 'string') {
      return NextResponse.json({ error: 'redirectTo is required.' }, { status: 400 })
    }
    email = body.email.trim().toLowerCase()
    redirectTo = body.redirectTo
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // Only allow relative-safe redirect paths to prevent open redirect abuse
  try {
    const parsed = new URL(redirectTo)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    if (appUrl && !redirectTo.startsWith(appUrl)) {
      return NextResponse.json({ error: 'Invalid redirectTo.' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid redirectTo URL.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: false,
    },
  })

  if (error) {
    console.error('[api/auth/magic-link] OTP error', error.message)
    // Return generic success to prevent email enumeration
  }

  return NextResponse.json({ success: true })
}
