import { NextRequest, NextResponse } from 'next/server'
import { createMiddlewareSupabaseClient } from '@/lib/supabase-server'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { supabaseAdmin } from '@/lib/supabase'
import { ACCESS_TYPES_DASHBOARD, ACCESS_TYPES_PORTAL } from '@/lib/auth/access-types'

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  const supabase = createMiddlewareSupabaseClient(request, response)

  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname

  // ── Prospect routes (/prospect/*) ────────────────────────────────────────
  // Any authenticated Supabase user (no role requirement) can access /prospect.
  if (path.startsWith('/prospect')) {
    if (!user) {
      const loginUrl = new URL('/portal/login', request.url)
      loginUrl.searchParams.set('next', path)
      return NextResponse.redirect(loginUrl)
    }
    requestHeaders.set('x-user-role', 'prospect')
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // ── Portal routes (/portal/*) ─────────────────────────────────────────────
  if (path.startsWith('/portal')) {
    if (path === '/portal/login' || path === '/portal/register') {
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    if (!user) {
      const loginUrl = new URL('/portal/login', request.url)
      loginUrl.searchParams.set('next', path)
      return NextResponse.redirect(loginUrl)
    }

    // Look up ALL clients this user can access via portal (access_type = portal or both)
    const { data: portalUsers } = await supabaseAdmin
      .from('client_portal_users')
      .select('client_id')
      .eq('email', (user.email ?? '').toLowerCase())
      .in('access_type', ACCESS_TYPES_PORTAL as readonly string[] as string[])

    if (!portalUsers || portalUsers.length === 0) {
      return NextResponse.redirect(new URL('/unauthorized', request.url))
    }

    const allowedClientIds = portalUsers.map((p) => p.client_id)

    // /portal root → redirect to first allowed client
    if (path === '/portal') {
      return NextResponse.redirect(new URL(`/portal/${allowedClientIds[0]}`, request.url))
    }

    // Extract clientId from /portal/{clientId}/...
    const pathClientId = path.split('/')[2]
    if (!pathClientId || !allowedClientIds.includes(pathClientId)) {
      return NextResponse.redirect(new URL(`/portal/${allowedClientIds[0]}`, request.url))
    }

    requestHeaders.set('x-user-role', 'client-viewer')
    requestHeaders.set('x-allowed-client-id', pathClientId)
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // ── Dashboard routes (/dashboard/*) ──────────────────────────────────────
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', path)
    return NextResponse.redirect(loginUrl)
  }

  // Admin check (fast env-var path: ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN)
  const adminPerms = getUserPermissions(user.email ?? '')
  if (adminPerms?.role === 'admin') {
    requestHeaders.set('x-user-role', 'admin')
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Client-viewer: DB lookup (new UI-managed path)
  const email = (user.email ?? '').toLowerCase()
  const { data: clientUsers } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id')
    .eq('email', email)
    .in('access_type', ACCESS_TYPES_DASHBOARD as readonly string[] as string[])

  // Fallback: CLIENT_VIEWERS env var (backward compat — keeps existing Render configs working)
  const envPerms = getUserPermissions(email)
  if ((!clientUsers || clientUsers.length === 0) && envPerms?.role !== 'client-viewer') {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  const allowedClientIds = clientUsers && clientUsers.length > 0
    ? clientUsers.map((u) => u.client_id)
    : [envPerms!.allowedClientId!]

  const firstClientId = allowedClientIds[0]

  // Paths client-viewers are allowed beyond their own client page
  const CLIENT_VIEWER_ALLOWED = ['/dashboard/content', '/dashboard/visuals']

  if (path.startsWith('/dashboard/clients/')) {
    // Restrict to their own client only
    const pathClientId = path.split('/')[3]
    if (!allowedClientIds.includes(pathClientId)) {
      return NextResponse.redirect(
        new URL(`/dashboard/clients/${firstClientId}`, request.url)
      )
    }
    requestHeaders.set('x-allowed-client-id', pathClientId)
  } else if (CLIENT_VIEWER_ALLOWED.some((p) => path === p || path.startsWith(p + '/'))) {
    // Allow social matrix + launch hub — pages filter by client internally
    requestHeaders.set('x-allowed-client-id', firstClientId)
  } else {
    // Any other dashboard path → redirect to their client home
    return NextResponse.redirect(
      new URL(`/dashboard/clients/${firstClientId}`, request.url)
    )
  }

  requestHeaders.set('x-user-role', 'client-viewer')
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/dashboard/:path*', '/portal/:path*', '/prospect/:path*', '/prospect'],
}
