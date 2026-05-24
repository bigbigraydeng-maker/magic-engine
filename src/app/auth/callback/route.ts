/**
 * GET /auth/callback?code=<code>&next=<path>
 *
 * Server-side OAuth callback handler. Exchanges the PKCE authorization code
 * entirely on the server so the code verifier is read from the incoming
 * request cookies (set by /api/auth/google-login) — no client-side
 * createBrowserClient needed, no localStorage/cookie mismatch.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { getUserPermissions } from '@/lib/auth/whitelist'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const safePath = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url))
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
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url))
  }

  // Determine redirect destination based on user type
  const { data: { user } } = await supabase.auth.getUser()
  let destination = safePath

  if (user?.email) {
    const email = user.email.toLowerCase()

    const { data: portalUser } = await supabaseAdmin
      .from('client_portal_users')
      .select('client_id')
      .eq('email', email)
      .maybeSingle()

    if (portalUser?.client_id) {
      destination = `/portal/${portalUser.client_id}`
    } else if (safePath === '/prospect') {
      destination = '/prospect'
    } else {
      const adminPerms = getUserPermissions(email)
      if (!adminPerms || adminPerms.role !== 'admin') {
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

  const response = NextResponse.redirect(new URL(destination, request.url))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options as any))
  return response
}
