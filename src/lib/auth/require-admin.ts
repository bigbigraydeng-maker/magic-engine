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
