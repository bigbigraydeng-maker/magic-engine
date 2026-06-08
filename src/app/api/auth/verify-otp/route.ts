/**
 * POST /api/auth/verify-otp
 * Body: { email, token, next?, type? }
 *
 * Completes email-based authentication using a 6-digit OTP instead of a magic
 * confirmation link.
 *
 * Two flows share this route:
 *   - type='signup' (default): new self-serve signup confirming a fresh account.
 *     This is the original P0-B flow.
 *   - type='email': existing user logging in via /login or /portal/login.
 *     Supabase tags signInWithOtp emails for already-confirmed users with
 *     type=email; using 'signup' here returns "Token has expired or is invalid".
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
 *      (grantSignupBonus is idempotent so login replays are safe.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { resolveRedirectForSession } from '@/lib/auth/resolve-redirect'

function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string') return '/dashboard'
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
}

// Whitelist of OTP types we accept from the client. Supabase supports a wider
// set (recovery, invite, sms, phone_change, …) but we only ever issue 'signup'
// (new account confirmation) and 'email' (existing user passwordless sign-in)
// from our own routes, so anything else would be a forged request.
const ACCEPTED_OTP_TYPES = ['signup', 'email'] as const
type AcceptedOtpType = typeof ACCEPTED_OTP_TYPES[number]

function sanitizeOtpType(value: unknown): AcceptedOtpType {
  if (typeof value === 'string' && (ACCEPTED_OTP_TYPES as readonly string[]).includes(value)) {
    return value as AcceptedOtpType
  }
  // Default keeps the original /portal/register behaviour working unchanged.
  return 'signup'
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { email, token, next, type } = body ?? {}
  const safePath = sanitizeNext(next)
  const otpType = sanitizeOtpType(type)

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

  const { error } = await supabase.auth.verifyOtp({
    email: email.toLowerCase().trim(),
    token: code,
    type: otpType,
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
