import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { getPublicOrigin } from '@/lib/auth/public-origin'

const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128
const USERS_PER_PAGE = 1000

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(getPublicOrigin(request)).origin
  } catch {
    return false
  }
}

/** Set or reset a password for an email that already has client access. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }

  const access = await requireGlobalAdmin()
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // JSON.parse accepts null, arrays, and primitives; reject them before any
  // property access so a malformed body cannot throw outside the parse catch.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const body = parsed as { email?: unknown; password?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.` },
      { status: 400 },
    )
  }

  // Limit resets to an email already granted Portal/FDE/client access. The
  // browser never supplies a Supabase Auth user id or an arbitrary account.
  const { data: portalUser, error: portalError } = await supabaseAdmin
    .from('client_portal_users')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle()

  if (portalError) {
    return NextResponse.json({ error: 'Could not verify account access.' }, { status: 500 })
  }
  if (!portalUser) {
    return NextResponse.json({ error: 'No Portal or FDE access exists for this email.' }, { status: 404 })
  }

  // Supabase Auth's admin API is server-only. Search all pages so accounts
  // past the first 1,000 users cannot be mistaken for missing accounts.
  let authUser: { id: string; email?: string | null } | undefined
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE })
    if (error) {
      return NextResponse.json({ error: 'Could not load the account.' }, { status: 500 })
    }
    authUser = data.users.find(user => user.email?.trim().toLowerCase() === email)
    if (authUser || data.users.length < USERS_PER_PAGE) break
  }

  const result = authUser
    ? await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password })
    : await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true })

  if (result.error) {
    // Deliberately omit the request body and provider error from logs/responses.
    return NextResponse.json({ error: 'Password could not be saved. Please try again.' }, { status: 500 })
  }

  console.info('[admin/users/password-reset]', {
    actorEmail: access.user.email ?? null,
    targetEmail: email,
    createdAuthUser: !authUser,
  })

  return NextResponse.json(
    { ok: true, createdAuthUser: !authUser },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
