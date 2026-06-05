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
// Body: { email, password, businessName, websiteUrl? }
// Creates a self_serve client + Supabase auth user + portal access.
// Does NOT grant MTC yet — that happens on first login via auth/callback.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { email, password, businessName, websiteUrl, next } = body ?? {}
  const safeNext = sanitizeNext(next)

  if (!email || !password || !businessName) {
    return NextResponse.json(
      { error: 'email, password, and businessName are required' },
      { status: 400 },
    )
  }

  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
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

  // Use signUp (not admin.createUser) so Supabase sends the signup confirmation
  // email. The Supabase email template uses {{ .Token }} (a 6-digit OTP), NOT
  // {{ .ConfirmationURL }} — P0-B. The user enters that code on the next screen,
  // which POSTs to /api/auth/verify-otp. emailRedirectTo is kept as a harmless
  // fallback for any environment still on the link template.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.magicengine.com.au'
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { data: authData, error: authError } = await supabaseAnon.auth.signUp({
    email: email.toLowerCase().trim(),
    password,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(safeNext)}`,
    },
  })

  if (authError || !authData.user) {
    if (authError?.message?.includes('already registered')) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please log in.' },
        { status: 409 },
      )
    }
    console.error('[self-register] auth create failed:', authError)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
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
      contact_email: email.toLowerCase().trim(),
      domain: (websiteUrl?.trim() || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || null,
      source: 'self_serve',
    })
    .select('id')
    .single()

  if (clientError || !client) {
    // Roll back auth user on failure
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
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
    message: 'Account created. Enter the 6-digit code we just emailed you to verify.',
  })
}
