/**
 * requireAdmin / guardAdmin
 *
 * Second-layer admin guard for /api/admin/* route handlers.
 * The middleware protects /dashboard pages, but API routes need their own
 * check because the middleware matcher does not cover /api/*.
 *
 * Usage:
 *   const guard = await guardAdmin()
 *   if (guard) return guard   // 401 or 403 response
 *   // proceed with admin logic
 */

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { requireSession } from './require-session'
import { getUserPermissions } from './whitelist'

export type AdminResult =
  | { ok: true; user: User }
  | { ok: false; status: 401 | 403; error: string }

export async function requireAdmin(): Promise<AdminResult> {
  const session = await requireSession()
  if (!session.ok) return session

  const perms = getUserPermissions(session.user.email ?? '')
  if (!perms || perms.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  return { ok: true, user: session.user }
}

/**
 * Convenience wrapper: returns a NextResponse error if not admin, null if ok.
 *
 * const guard = await guardAdmin()
 * if (guard) return guard
 */
export async function guardAdmin(): Promise<NextResponse | null> {
  const result = await requireAdmin()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return null
}

/**
 * 只放行**全局** admin —— 受限管理员（DEMO_ADMINS，带 allowedClientId）一律拒。
 *
 * 为什么单独一个（2026-08-04 狄仁杰复验查出）：
 *   `requireAdmin` 只判 `role === 'admin'`，而 `whitelist.ts` 给 DEMO_ADMINS 返回的
 *   正是 `{ role: 'admin', allowedClientId: X }` —— 演示/试用账号照样过。
 *   middleware 只覆盖 `/dashboard/:path*`，不管 `/api/*`，所以页面拦得住、接口拦不住。
 *
 *   后果不是数据泄露，是**平台级写权限**：一个只该看到自己那一个客户的演示账号，
 *   能静默关停一条跨客户经验，影响全部客户的 AI 行为。
 *
 * 判据很简单：`allowedClientId` 有值 = 这个人被限定在某一个客户里 = 不该碰平台级开关。
 *
 * 用在**影响多个客户**的写接口上（跨客户经验开关、全局配置…）；
 * 只动单个客户数据的接口继续用 `guardAdmin`。
 */
export async function guardGlobalAdmin(): Promise<NextResponse | null> {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const perms = getUserPermissions(session.user.email ?? '')
  if (!perms || perms.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (perms.allowedClientId) {
    return NextResponse.json(
      { error: 'Forbidden — this endpoint affects every client, scoped admins cannot use it' },
      { status: 403 },
    )
  }
  return null
}
