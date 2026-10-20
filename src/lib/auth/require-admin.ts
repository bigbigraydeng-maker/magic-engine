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
 * 用在**影响多个客户**的写接口、花钱 / 对外发布 / 运维类动作上；
 * 按客户操作的接口用 `requireAdminScope` + `scopeAllowsClient` 核客户 ——
 * 只套 `guardAdmin` 会放行限定客户的管理员去碰别的客户。
 */
export async function guardGlobalAdmin(): Promise<NextResponse | null> {
  const result = await requireGlobalAdmin()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return null
}

/**
 * 同 guardGlobalAdmin 的判据，但把 user 带回来（需要记审计 actor 的接口用）。
 *
 * 这是「内部员工」的唯一判据：ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN。
 * `client_portal_users.access_type='fde'` **不算** —— 那是按客户发放的成员行，
 * 付费客户自己就能给任意邮箱发（clients/[id]/users），不能当内部身份用。
 */
export async function requireGlobalAdmin(): Promise<AdminResult> {
  const session = await requireSession()
  if (!session.ok) return session

  const perms = getUserPermissions(session.user.email ?? '')
  if (!perms || perms.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  if (perms.allowedClientId) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden — this endpoint affects every client, scoped admins cannot use it',
    }
  }
  return { ok: true, user: session.user }
}

/** 管理员的客户范围：全局（内部员工），或被限定在某一个客户（DEMO_ADMINS）。 */
export type AdminScope = { kind: 'global' } | { kind: 'client'; clientId: string }

export type ScopedAdminResult =
  | { ok: true; user: User; scope: AdminScope }
  | { ok: false; status: 401 | 403; error: string }

/**
 * 一次读取同时给出「是不是管理员」和「被限定在哪个客户」。
 *
 * 范围和授权必须来自同一次读取。读不到身份一律拒，不会退成全局管理员 ——
 * 原来 guardAdmin + 第二次 requireAdmin 的写法，第二次读失败时会被当成没有限定。
 *
 * 只认环境变量里的管理员，和 requireAdmin / requireGlobalAdmin 同一个判据；
 * 库里 scoped_admin=true 的账号这里仍然是 403。
 *
 * 邮箱为空一律拒：`getUserPermissions('')` 在 ADMIN_EMAILS 多一个逗号时会返回全局管理员。
 *
 * 客户 id 统一转小写、去首尾空白再比较（见 scopeAllowsClient）。
 */
export async function requireAdminScope(): Promise<ScopedAdminResult> {
  const session = await requireSession()
  if (!session.ok) return session

  const email = (session.user.email ?? '').trim()
  if (!email) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  const perms = getUserPermissions(email)
  if (!perms || perms.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  if (perms.allowedClientId === null) {
    return { ok: true, user: session.user, scope: { kind: 'global' } }
  }

  return {
    ok: true,
    user: session.user,
    scope: { kind: 'client', clientId: perms.allowedClientId.trim().toLowerCase() },
  }
}

/** 全局管理员恒可；被限定在某个客户的管理员只能碰自己那一个（比较时不区分大小写、忽略首尾空白）。 */
export function scopeAllowsClient(scope: AdminScope, clientId: string): boolean {
  return scope.kind === 'global' || scope.clientId === clientId.trim().toLowerCase()
}
