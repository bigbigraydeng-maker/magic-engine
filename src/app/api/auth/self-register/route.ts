import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

// POST /api/auth/self-register
// Body: { email, password, businessName, websiteUrl? }
// Creates a self_serve client + Supabase auth user + portal access.
// Does NOT grant 100 MTC yet — that happens on email verification.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { email, password, businessName, websiteUrl } = body ?? {}

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

  // Create Supabase auth user — triggers confirmation email automatically
  const supabaseAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: authData, error: authError } = await supabaseAuth.auth.admin.createUser({
    email: email.toLowerCase().trim(),
    password,
    email_confirm: false, // require email verification
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
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .insert({
      name: businessName.trim(),
      website_url: websiteUrl?.trim() ?? null,
      source: 'self_serve',
    })
    .select('id')
    .single()

  if (clientError || !client) {
    // Roll back auth user on failure
    await supabaseAuth.auth.admin.deleteUser(authData.user.id)
    console.error('[self-register] client insert failed:', clientError)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }

  // Grant portal access
  const { error: portalError } = await supabaseAdmin.from('client_portal_users').insert({
    email: email.toLowerCase().trim(),
    client_id: client.id,
    display_name: businessName.trim(),
    access_type: 'portal',
  })

  if (portalError) {
    console.error('[self-register] portal user insert failed:', portalError)
    // Non-fatal: client exists, they can still be added manually
  }

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    message: 'Account created. Please check your email to verify your address.',
  })
}
