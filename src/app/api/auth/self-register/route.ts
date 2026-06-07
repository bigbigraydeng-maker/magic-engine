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

  // Check for existing registration (prevent duplicate clients)
  const { data: existing } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('name', businessName.trim())
    .eq('source', 'self_serve')
    .limit(1)
    .single()

  // Also check by email in portal users
  const { data: existingPortalUser } = await supabaseAdmin
    .from('client_portal_users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .limit(1)
    .single()

  if (existing || existingPortalUser) {
    return NextResponse.json(
      { error: 'An account with this email or business name already exists. Please log in.' },
      { status: 409 },
    )
  }

  // signInWithOtp creates the auth.users row (shouldCreateUser: true) AND emits
  // a 6-digit OTP via the Magic Link / Email OTP template ({{ .Token }}).
  // No password. emailRedirectTo is harmless on OTP-only flow — Supabase only
  // uses it when {{ .ConfirmationURL }} is in the template.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.magicengine.com.au'
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { error: otpError } = await supabaseAnon.auth.signInWithOtp({
    email: email.toLowerCase().trim(),
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(safeNext)}`,
    },
  })

  if (otpError) {
    // signInWithOtp does not throw "already registered" because it works for
    // existing users too (passwordless re-login). The duplicate check above
    // catches the portal_users / clients row collision.
    console.error('[self-register] signInWithOtp failed:', otpError)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }

  // Fetch the auth user that signInWithOtp just created so we can roll it back
  // on downstream failure. We use the admin client to look up by email.
  const { data: userList } = await supabaseAdmin.auth.admin.listUsers()
  const authUser = userList?.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase().trim(),
  )

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
      contact_email: email.toLowerCase().trim(),
      domain: (websiteUrl?.trim() || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || null,
      source: 'self_serve',
    })
    .select('id')
    .single()

  if (clientError || !client) {
    // Roll back auth user on failure
    if (authUser?.id) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.id)
    }
    console.error('[self-register] client insert failed:', clientError)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }

  // Grant portal access
  const { error: portalError } = await supabaseAdmin.from('client_portal_users').insert({
    email: email.toLowerCase().trim(),
    client_id: client.id,
    display_name: businessName.trim(),
    access_type: 'self_serve',
  })

  if (portalError) {
    console.error('[self-register] portal user insert failed:', portalError)
    // Non-fatal: client exists, they can still be added manually
  }

  const { data: latestScan } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id, domain, result, client_id')
    .eq('email', email.toLowerCase().trim())
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
    email: email.toLowerCase().trim(),
    next: safeNext,
    needsVerification: true,
    message: 'Account created. Enter the verification code we just emailed you to verify.',
  })
}
