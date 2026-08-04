import { NextRequest, NextResponse } from 'next/server'
import { createMiddlewareSupabaseClient } from '@/lib/supabase-server'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { supabaseAdmin } from '@/lib/supabase'
import {
  ACCESS_TYPES_DASHBOARD,
  tierForAccessType,
  type AccessType,
  type AccessTier,
} from '@/lib/auth/access-types'

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

  // ── Portal routes (/portal/*) — legacy, redirecting to /dashboard ────────
  //
  // Phase X.S4: portal is being phased out. Existing 'both'-tier users have
  // dashboard access too, so any /portal hit gets a 308 to the equivalent
  // /dashboard URL. The login/register pages are preserved because some
  // bookmarks land there. New 'portal'-only users should not exist after
  // 20260626000002 — this branch logs and falls through to dashboard auth.
  if (path.startsWith('/portal')) {
    // /portal/login + /portal/register stay open — they have their own UI
    // and the old prospect → magic-link flow still uses them.
    if (path === '/portal/login' || path === '/portal/register') {
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    if (!user) {
      // Unauth → bounce to the unified dashboard login.
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', path.replace(/^\/portal/, '/dashboard/clients'))
      return NextResponse.redirect(loginUrl)
    }

    // /portal → /dashboard
    // /portal/<clientId> → /dashboard/clients/<clientId>
    // /portal/<clientId>/foo → /dashboard/clients/<clientId>/foo
    const parts = path.split('/')
    const clientId = parts[2]
    const rest = parts.slice(3).join('/')
    const dest = clientId
      ? `/dashboard/clients/${clientId}${rest ? '/' + rest : ''}`
      : '/dashboard'
    return NextResponse.redirect(new URL(dest, request.url), 308)
  }

  // ── Dashboard routes (/dashboard/*) ──────────────────────────────────────
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', path)
    return NextResponse.redirect(loginUrl)
  }

  // Admin check (fast env-var path: ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN / DEMO_ADMINS)
  const adminPerms = getUserPermissions(user.email ?? '')
  if (adminPerms?.role === 'admin') {
    // 受限管理员（DEMO_ADMINS）：FDE 视角照给，但锁死在自己那一个客户上。
    // 平台级页面（客户总览 / 账单 / MTC / Prospecting …）会聚合全部客户数据，
    // 所以统一弹回自己的客户主页 —— 不能只靠前端不显示入口来挡。
    const scopedClientId = adminPerms.allowedClientId
    if (scopedClientId) {
      const onOwnClient =
        path.startsWith('/dashboard/clients/') && path.split('/')[3] === scopedClientId

      if (!onOwnClient) {
        return NextResponse.redirect(
          new URL(`/dashboard/clients/${scopedClientId}`, request.url)
        )
      }

      requestHeaders.set('x-user-role', 'admin')
      requestHeaders.set('x-user-tier', 'admin')
      requestHeaders.set('x-allowed-client-id', scopedClientId)
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    requestHeaders.set('x-user-role', 'admin')
    requestHeaders.set('x-user-tier', 'admin')
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Client-viewer: DB lookup (new UI-managed path). Pull access_type so we
  // can map to a semantic tier and forward it to the layout — the sidebar
  // and FeatureLockGate need to know whether the visitor is paid or self_serve.
  const email = (user.email ?? '').toLowerCase()
  const { data: clientUsers } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id, access_type, scoped_admin')
    .eq('email', email)
    .in('access_type', ACCESS_TYPES_DASHBOARD as readonly string[] as string[])

  // 受限管理员（DB 版）：client_portal_users.scoped_admin = true
  //
  // 与 DEMO_ADMINS 环境变量等价，但配置落在客户数据里 —— 开一个演示账号
  // 不再需要动 Render。范围仍然锁死，只是可以是**多个**客户：
  // 演示账号常常要展示「不同行业长出不同的工具」，一个客户不够。
  const scopedClientIds = (clientUsers ?? [])
    .filter((r) => (r as { scoped_admin?: boolean }).scoped_admin === true)
    .map((r) => (r as { client_id: string }).client_id)

  if (scopedClientIds.length > 0) {
    const home = `/dashboard/clients/${scopedClientIds[0]}`
    const requested = path.startsWith('/dashboard/clients/') ? path.split('/')[3] : null
    const onOwnClient = requested !== null && scopedClientIds.includes(requested)

    // 客户列表页可以放行：/api/clients 对非全局管理员只返回门户白名单里的客户，
    // 也就是这个演示账号自己那几个。有多个客户时它就是现成的切换器，
    // 不必为此另造一个组件。
    const onClientList = path === '/dashboard/clients'

    if (!onOwnClient && !onClientList) {
      return NextResponse.redirect(new URL(home, request.url))
    }

    requestHeaders.set('x-user-role', 'admin')
    requestHeaders.set('x-user-tier', 'admin')
    requestHeaders.set('x-allowed-client-id', requested ?? scopedClientIds[0])
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Fallback: CLIENT_VIEWERS env var (backward compat — keeps existing Render configs working)
  const envPerms = getUserPermissions(email)
  if ((!clientUsers || clientUsers.length === 0) && envPerms?.role !== 'client-viewer') {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  type ClientUserRow = { client_id: string; access_type: AccessType }
  const rows: ClientUserRow[] = clientUsers && clientUsers.length > 0
    ? (clientUsers as ClientUserRow[])
    : [{ client_id: envPerms!.allowedClientId!, access_type: 'client' as AccessType }]

  const allowedClientIds = rows.map(r => r.client_id)
  const firstClientId = allowedClientIds[0]

  // Derive the tier this visitor will use on this request. When a user holds
  // multiple rows (e.g. self_serve on one workspace + client on another),
  // we use the one matching the requested clientId; otherwise we take the
  // strongest tier across all rows so the sidebar stays consistent.
  function pickTier(): AccessTier {
    const targetClientId = path.split('/')[3]
    const matching = rows.find(r => r.client_id === targetClientId)
    const accessTypes = matching ? [matching.access_type] : rows.map(r => r.access_type)
    const tiers = accessTypes.map(tierForAccessType)
    // Strength order: paid_client > self_serve > portal_only.
    if (tiers.includes('paid_client')) return 'paid_client'
    if (tiers.includes('self_serve'))  return 'self_serve'
    return 'portal_only'
  }
  const tier = pickTier()

  // Paths client-viewers are allowed beyond their own client page.
  // P0-J: only paid_client tier gets the multi-client aggregate views.
  // self_serve users on these paths previously saw OTHER clients' content
  // (data leak — raydeng@workvisas.work saw 41 strangers' posts).
  const CLIENT_VIEWER_ALLOWED = tier === 'paid_client'
    ? ['/dashboard/content', '/dashboard/visuals']
    : []

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
  requestHeaders.set('x-user-tier', tier)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/dashboard/:path*', '/portal/:path*', '/prospect/:path*', '/prospect'],
}
