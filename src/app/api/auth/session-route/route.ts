/**
 * GET /api/auth/session-route?next=<path>
 *
 * Called by the client-side /auth/callback page after Supabase auth completes.
 * Reads the server-side session (set via cookie by the browser Supabase client)
 * and returns the correct redirect destination for this user type.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { getUserPermissions } from '@/lib/auth/whitelist'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const next = searchParams.get('next') ?? '/dashboard'
  const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    // Session not readable server-side — let middleware handle the unauthenticated redirect cleanly
    return NextResponse.json({ redirect: safePath })
  }

  const email = user.email.toLowerCase()

  // Portal users take priority
  const { data: accessRows } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id, access_type')
    .eq('email', email)

  const portalUser = accessRows?.find(row =>
    row.access_type === 'portal' || row.access_type === 'both'
  )

  if (portalUser?.client_id) {
    return NextResponse.json({ redirect: `/portal/${portalUser.client_id}` })
  }

  // Honour explicit /prospect next param (magic link from /discover)
  if (safePath === '/prospect') {
    return NextResponse.json({ redirect: '/prospect' })
  }

  // Admin users go to dashboard
  const adminPerms = getUserPermissions(email)
  if (adminPerms?.role === 'admin') {
    return NextResponse.json({ redirect: safePath })
  }

  // Prospects: have a public_scan_jobs record but no portal/dashboard access
  const { data: scanJob } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle()

  if (scanJob?.id) {
    return NextResponse.json({ redirect: '/prospect' })
  }

  return NextResponse.json({ redirect: safePath })
}
