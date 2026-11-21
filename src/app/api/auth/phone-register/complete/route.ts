import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'
import { clientPortalMembershipsForUser } from '@/lib/auth/client-portal-membership'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { resolveRedirectForSession } from '@/lib/auth/resolve-redirect'
import { resolveSelfServeLanding } from '@/lib/auth/self-serve-routing'
import { isChinaPhoneSignupEnabled } from '@/lib/auth/china-phone-otp'

function safePath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/dashboard'
}

function sanitizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || null
}

export async function POST(request: NextRequest) {
  if (!isChinaPhoneSignupEnabled()) {
    return NextResponse.json({ error: 'Phone registration is not enabled' }, { status: 503 })
  }

  const body = await request.json().catch(() => null)
  const businessName = typeof body?.businessName === 'string' ? body.businessName.trim() : ''
  const domain = sanitizeDomain(body?.websiteUrl)
  const next = safePath(body?.next)
  if (businessName.length < 2 || businessName.length > 120) {
    return NextResponse.json({ error: 'Enter a workspace name between 2 and 120 characters.', code: 'invalid_business_name' }, { status: 400 })
  }

  const auth = createServerSupabaseClient()
  const { data: { user }, error: authError } = await auth.auth.getUser()
  if (authError || !user || !user.id) {
    return NextResponse.json({ error: 'Verify your phone number before creating a workspace.', code: 'phone_verification_required' }, { status: 401 })
  }

  const phone = normalizeChinaPhone(user.phone)
  if (!phone || !user.phone_confirmed_at) {
    return NextResponse.json({ error: 'Verify your phone number before creating a workspace.', code: 'phone_verification_required' }, { status: 403 })
  }

  if (getUserPermissions(user.email ?? '') !== null) {
    return NextResponse.json({ error: 'This account uses the existing login flow.', code: 'staff_account' }, { status: 403 })
  }

  const memberships = await clientPortalMembershipsForUser(user)
  if (memberships.error) {
    return NextResponse.json({ error: 'Account access could not be checked. Please retry.', code: 'lookup_failed' }, { status: 503 })
  }
  if (memberships.rows.length > 0) {
    const redirect = await resolveRedirectForSession(auth, next)
    return NextResponse.json({ ok: true, redirect, existingWorkspace: true })
  }

  const { data: clientId, error } = await supabaseAdmin.rpc('create_phone_self_serve_workspace', {
    p_auth_user_id: user.id,
    p_business_name: businessName,
    p_domain: domain,
  })

  if (error || typeof clientId !== 'string') {
    const code = typeof error?.message === 'string' ? error.message : ''
    if (code.includes('business_exists')) {
      return NextResponse.json({ error: 'A workspace with this name already exists. Choose another name.', code: 'business_exists' }, { status: 409 })
    }
    console.error('[phone-register] workspace creation failed:', error)
    return NextResponse.json({ error: 'Workspace setup failed. Please retry while signed in.', code: 'registration_failed' }, { status: 500 })
  }

  const redirect = await resolveSelfServeLanding(clientId, next, false)
  return NextResponse.json({ ok: true, clientId, redirect, welcomeBonusGranted: false }, { status: 201 })
}
