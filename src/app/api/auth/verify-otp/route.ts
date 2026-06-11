/**
 * POST /api/auth/verify-otp
 * Body: { email, token, next? }
 *
 * Completes self-serve signup using a 6-digit email OTP instead of a magic
 * confirmation link (P0-B).
 *
 * Why OTP instead of a link: the previous flow sent a one-time PKCE
 * confirmation URL. Gmail's link pre-scanner fetches that URL before the human
 * clicks it, consuming the single-use code — so exchangeCodeForSession() in
 * /auth/callback returned otp_expired, bailed early, and the 500 MTC welcome
 * bonus was never granted. A 6-digit code is inert plain text the pre-scanner
 * cannot consume.
 *
 * Flow:
 *   1. verifyOtp() on a cookie-backed server client → sets the auth session
 *      cookies on the response (so middleware sees the user on the next nav).
 *   2. Reuse resolveRedirectForSession() to pick the landing page AND grant the
 *      500 MTC welcome bonus — the exact same path session-route uses.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { resolveRedirectForSession } from '@/lib/auth/resolve-redirect'

function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string') return '/dashboard'
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { email, token, next } = body ?? {}
  const safePath = sanitizeNext(next)

  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }

  // Supabase email OTP length varies by project setting (default 6, can be set
  // 6-10 in Dashboard → Authentication → Email Provider). Accept 6-10 digits
  // so the code keeps working if the setting changes — verifyOtp itself does
  // the cryptographic check, length is only a guard against typos.
  const code = typeof token === 'string' ? token.trim() : ''
  if (!/^\d{6,10}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the code from your email' }, { status: 400 })
  }

  const cookieStore = cookies()
  const pendingCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(list) {
          list.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options: options as Record<string, unknown> })
          })
        },
      },
    },
  )

  // type 'email' matches both token kinds GoTrue can have emitted: the signup
  // confirmation code (new, unconfirmed user) AND the magiclink code sent when
  // signInWithOtp hits an already-confirmed user — e.g. someone who verified
  // but whose bonus grant failed mid-flight and re-requested a code. The
  // narrower type 'signup' rejected the latter.
  const { error } = await supabase.auth.verifyOtp({
    email: email.toLowerCase().trim(),
    token: code,
    type: 'email',
  })

  if (error) {
    const expired = /expired|invalid/i.test(error.message)
    return NextResponse.json(
      {
        error: expired
          ? 'That code is invalid or has expired. Request a new one and try again.'
          : 'Verification failed. Please try again.',
      },
      { status: 400 },
    )
  }

  const redirect = await resolveRedirectForSession(supabase, safePath)

  const response = NextResponse.json({ ok: true, redirect })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any))
  return response
}
