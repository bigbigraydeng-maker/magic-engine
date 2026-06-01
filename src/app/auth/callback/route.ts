/**
 * GET /auth/callback?code=<code>&next=<path>
 *
 * Server-side OAuth callback handler. Exchanges the PKCE authorization code
 * entirely on the server so the code verifier is read from the incoming
 * request cookies (set by /api/auth/google-login) — no client-side
 * createBrowserClient needed, no localStorage/cookie mismatch.
 *
 * All redirects use APP_URL (via getPublicOrigin) instead of request.url
 * because on Render, request.url is the internal localhost:PORT address.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { grantSignupBonus } from '@/lib/mtc/grant-signup-bonus'

export async function GET(request: NextRequest) {
  const origin = getPublicOrigin(request)
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
  const loginPath = safePath.startsWith('/portal') ? '/portal/login' : '/login'
  const failedUrl = `${origin}${loginPath}?error=auth_failed&next=${encodeURIComponent(safePath)}`

  if (!code) {
    return NextResponse.redirect(failedUrl)
  }

  const cookieStore = cookies()
  const pendingCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) {
          list.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options: options as Record<string, unknown> })
          })
        },
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession:', error.message)
    return NextResponse.redirect(failedUrl)
  }

  // Determine redirect destination based on user type
  const { data: { user } } = await supabase.auth.getUser()
  let destination = safePath

  if (user?.email) {
    const email = user.email.toLowerCase()
    const adminPerms = getUserPermissions(email)

    if (adminPerms?.role === 'admin') {
      destination = safePath.startsWith('/dashboard') ? safePath : '/dashboard'
    } else {
      // Fetch all access rows for this email in one query
      const { data: accessRows } = await supabaseAdmin
        .from('client_portal_users')
        .select('client_id, access_type')
        .eq('email', email)

      // Portal users (access_type = 'portal' | 'both' | 'self_serve') → /portal/[clientId]
      const portalRow = accessRows?.find(r =>
        r.access_type === 'portal' || r.access_type === 'both' || r.access_type === 'self_serve'
      )
      // Dashboard/FDE users (access_type = 'dashboard' | 'fde' | 'both') → /dashboard/clients/[clientId]
      const dashboardRow = accessRows?.find(r =>
        r.access_type === 'dashboard' || r.access_type === 'fde' || r.access_type === 'both'
      )

      if (portalRow?.client_id) {
        // Grant 500 MTC welcome bonus on first login for self_serve clients
        const bonusGranted = await grantSignupBonus(portalRow.client_id).catch(() => false)
        destination = bonusGranted
          ? `/dashboard/clients/${portalRow.client_id}/wallet?welcome=1`
          : `/portal/${portalRow.client_id}`
      } else if (dashboardRow?.client_id) {
        destination = `/dashboard/clients/${dashboardRow.client_id}`
      } else if (safePath === '/prospect') {
        destination = '/prospect'
      } else {
        const { data: scanJob } = await supabaseAdmin
          .from('public_scan_jobs')
          .select('id')
          .eq('email', email)
          .limit(1)
          .maybeSingle()
        if (scanJob?.id) destination = '/prospect'
      }
    }
  }

  const response = NextResponse.redirect(`${origin}${destination}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any))
  return response
}
