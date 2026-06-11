import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string') {
    return '/dashboard'
  }

  return next.startsWith('/') && !next.startsWith('//')
    ? next
    : '/dashboard'
}

// Best-effort per-IP throttle on the resend branch. The old code returned 409
// for every repeat POST and never reached signInWithOtp, so resends had zero
// email-send surface; now that repeats genuinely re-send, cap them. Render
// runs a single long-lived instance so an in-memory window works there; on
// multi-instance deploys it degrades to per-instance limiting — the hard
// backstops are Supabase's per-email 60s cooldown and project email quota.
const RESEND_WINDOW_MS = 60 * 60 * 1000
const RESEND_MAX_PER_WINDOW = 10
const resendHits = new Map<string, number[]>()

function consumeResendQuota(ip: string): boolean {
  if (resendHits.size > 10_000) resendHits.clear()
  const now = Date.now()
  const hits = (resendHits.get(ip) ?? []).filter(t => now - t < RESEND_WINDOW_MS)
  if (hits.length >= RESEND_MAX_PER_WINDOW) {
    resendHits.set(ip, hits)
    return false
  }
  resendHits.set(ip, [...hits, now])
  return true
}

// POST /api/auth/self-register
// Body: { email, businessName, websiteUrl? }
// Creates a self_serve client + Supabase auth user (passwordless) + portal access.
// Sends a 6-digit OTP via signInWithOtp — NOT signUp(password).
// Does NOT grant MTC yet — that happens after OTP verify in /api/auth/verify-otp
// which calls resolveRedirectForSession() → grantSignupBonus().
//
// P0-F (2026-06-05): switched from signUp(password) to signInWithOtp because
// signUp generates a 56-byte hex confirmation_token (not a 6-digit OTP) regardless
// of "Email OTP Length" setting. signInWithOtp is the only API that actually
// emits the 6-digit OTP that {{ .Token }} renders in the email template.
// Passwordless aligns with the P0-B decision (drop single-use confirmation links).
//
// Resend (2026-06-11): a repeat POST for an email that registered but never
// verified now re-sends a fresh OTP (200 { resent: true }) instead of 409 —
// previously an expired code left the user with no way to get a new one.
// Creation order is DB rows first, signInWithOtp last: rollback then only
// needs the ids we already hold, replacing the listUsers() email scan that
// silently missed users beyond the first page. If the auth user outlives a
// failed email send, the next attempt's signInWithOtp re-sends idempotently.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { email, businessName, websiteUrl, next } = body ?? {}
  const safeNext = sanitizeNext(next)

  if (!email || !businessName) {
    return NextResponse.json(
      { error: 'email and businessName are required' },
      { status: 400 },
    )
  }

  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const emailLower = email.toLowerCase().trim()

  // signInWithOtp creates the auth.users row (shouldCreateUser: true) AND emits
  // a 6-digit OTP via the Magic Link / Email OTP template ({{ .Token }}).
  // No password. emailRedirectTo is harmless on OTP-only flow — Supabase only
  // uses it when {{ .ConfirmationURL }} is in the template.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.magicengine.com.au'
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  function sendOtp() {
    return supabaseAnon.auth.signInWithOtp({
      email: emailLower,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    })
  }

  // Same email already registered → resend or refuse, depending on verification.
  const { data: existingPortalUser } = await supabaseAdmin
    .from('client_portal_users')
    .select('id, client_id')
    .eq('email', emailLower)
    .limit(1)
    .single()

  if (existingPortalUser) {
    const { data: existingClient } = await supabaseAdmin
      .from('clients')
      .select('email_verified_at')
      .eq('id', existingPortalUser.client_id)
      .single()

    if (existingClient && !existingClient.email_verified_at) {
      // Registered but never verified — treat as a resend request. For a
      // confirmed-but-unstamped user (bonus grant failed mid-flight) Supabase
      // sends a magiclink-type code; verify-otp accepts both via type 'email'.
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
      if (!consumeResendQuota(ip)) {
        return NextResponse.json(
          { error: 'Too many attempts — please try again later.' },
          { status: 429 },
        )
      }
      const { error: resendError } = await sendOtp()
      if (resendError) {
        // Most likely Supabase's built-in 60s email cooldown.
        console.error('[self-register] OTP resend failed:', resendError)
        return NextResponse.json(
          { error: 'We just sent you a code — wait a minute before requesting another.' },
          { status: 429 },
        )
      }
      return NextResponse.json({
        ok: true,
        resent: true,
        email: emailLower,
        next: safeNext,
        needsVerification: true,
        message: 'A new verification code is on its way.',
      })
    }

    // Verified accounts land here — and so does a dangling portal row whose
    // clients record is gone (DB integrity anomaly): refusing with "log in"
    // is deliberate; re-sending a code there would verify into a workspace
    // that no longer exists. Admin cleanup is the fix for that state.
    return NextResponse.json(
      { error: 'An account with this email already exists. Please log in.' },
      { status: 409 },
    )
  }

  // Different email but same business name → refuse (one workspace per name).
  const { data: existing } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('name', businessName.trim())
    .eq('source', 'self_serve')
    .limit(1)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'An account with this business name already exists. Please log in.' },
      { status: 409 },
    )
  }

  // Create clients row
  //
  // P0-C fix: contact_email is the canonical channel for FDE/admin outreach
  // (support tickets, MTC top-up reminders, account recovery). It was previously
  // left NULL because grant-signup-bonus reads the email from
  // client_portal_users.email instead — so the bonus path still works without
  // it — but downstream tooling (admin UI, billing reminders, A2.2 GSC brand
  // search heuristics) all expect contact_email to be populated. Writing it
  // here is non-breaking: clients.contact_email was already nullable, and
  // existing rows just keep their NULL until they're touched.
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .insert({
      name: businessName.trim(),
      contact_email: emailLower,
      domain: (websiteUrl?.trim() || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || null,
      source: 'self_serve',
    })
    .select('id')
    .single()

  if (clientError || !client) {
    console.error('[self-register] client insert failed:', clientError)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }

  // Grant portal access. Without this row the user can verify but lands with
  // no workspace and no bonus (resolveRedirectForSession finds nothing), so a
  // failure here is fatal: roll back the client and let them retry cleanly.
  const { error: portalError } = await supabaseAdmin.from('client_portal_users').insert({
    email: emailLower,
    client_id: client.id,
    display_name: businessName.trim(),
    access_type: 'self_serve',
  })

  if (portalError) {
    await supabaseAdmin.from('clients').delete().eq('id', client.id)
    console.error('[self-register] portal user insert failed:', portalError)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }

  // Send the OTP last — on failure, roll back the rows we just created using
  // the ids in hand. No listUsers() scan needed; if the auth user was created
  // anyway, the next registration attempt re-sends to it idempotently.
  const { error: otpError } = await sendOtp()

  if (otpError) {
    await supabaseAdmin.from('client_portal_users').delete().eq('client_id', client.id)
    await supabaseAdmin.from('clients').delete().eq('id', client.id)
    console.error('[self-register] signInWithOtp failed:', otpError)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }

  const { data: latestScan } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id, domain, result, client_id')
    .eq('email', emailLower)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestScan?.id && !latestScan.client_id) {
    if (latestScan.result) {
      await supabaseAdmin
        .from('client_discovery')
        .insert({
          client_id: client.id,
          domain: latestScan.domain ?? client.id,
          payload: latestScan.result,
          cost_usd: 0,
          model: 'public-scan',
          tool_calls: 0,
        })
        .then(() => undefined, (err) => console.error('[self-register] client_discovery insert failed:', err))
    }

    await supabaseAdmin
      .from('public_scan_jobs')
      .update({ client_id: client.id })
      .eq('id', latestScan.id)
      .then(() => undefined, (err) => console.error('[self-register] public_scan_jobs bind failed:', err))
  }

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    email: emailLower,
    next: safeNext,
    needsVerification: true,
    message: 'Account created. Enter the verification code we just emailed you to verify.',
  })
}
