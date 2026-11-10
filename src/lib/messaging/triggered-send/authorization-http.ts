/**
 * The door of the four authorization endpoints: a logged-in GLOBAL administrator (an exact `ADMIN_EMAILS` match that
 * is not limited to one client). A scoped or demo admin has FDE powers inside one client, a portal user (even a paying
 * owner) has none here (§4.3, precedent: the daily-plan auto-publisher). AUTHORIZING needs more: the person must also
 * be on `TRIGGERED_SEND_APPROVER_EMAILS` (exact list; not set or empty = nobody may authorize, never a fall-back to the
 * admin list, which has several people): "authorize: the PM himself only" (§4.3), like the ad-spend approver list.
 * The write endpoints also require a JSON body, so a cross-site form cannot post to them.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3, §13 (plan: §17).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import type { Actor, CommandResult } from './authorization-core'

const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const APPROVER_ENV = 'TRIGGERED_SEND_APPROVER_EMAILS'

/** Exact, case-insensitive; not configured = nobody (fail closed). */
export function isTriggeredSendApprover(email: string, env: (name: string) => string | undefined = (n) => process.env[n]): boolean {
  const normalised = email.toLowerCase().trim()
  if (normalised === '') return false
  const list = (env(APPROVER_ENV) ?? '').split(',').map((e) => e.toLowerCase().trim()).filter((e) => e.length > 0)
  return list.includes(normalised)
}

/** Live state: never let a browser or proxy keep an old answer. */
export const NO_STORE = { 'Cache-Control': 'no-store' }

export type AdminGate = { ok: true; actor: Actor; canAuthorize: boolean } | { ok: false; response: NextResponse; reason: 'denied' | 'not_admin' }

export async function requireTriggeredSendAdmin(clientId: string): Promise<AdminGate> {
  if (!CLIENT_ID_RE.test(clientId)) {
    return { ok: false, reason: 'denied', response: NextResponse.json({ success: false, error: 'INVALID_CLIENT_ID' }, { status: 400, headers: NO_STORE }) }
  }
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return { ok: false, reason: 'denied', response: NextResponse.json({ success: false, error: access.error }, { status: access.status, headers: NO_STORE }) }
  }
  const email = (access.user.email ?? '').toLowerCase().trim()
  if (!isGlobalAdminEmail(email) || access.allowedClientId !== null) {
    return {
      ok: false,
      reason: 'not_admin',
      response: NextResponse.json({ success: false, error: 'GLOBAL_ADMIN_REQUIRED' }, { status: 403, headers: NO_STORE }),
    }
  }
  return { ok: true, actor: { email, userId: access.user.id }, canAuthorize: isTriggeredSendApprover(email) }
}

/** The body of a write command: JSON only, read after the door. `null` = not JSON (or no body). */
export async function readJsonBody(req: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const type = req.headers.get('content-type') ?? ''
  if (!/^application\/json(\s*;|$)/i.test(type)) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'JSON_REQUIRED' }, { status: 415, headers: NO_STORE }) }
  }
  return { ok: true, body: await req.json().catch(() => null) }
}

export function respond(result: CommandResult): NextResponse {
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
}

export function invalidCommand(error: string, details: unknown): NextResponse {
  return NextResponse.json({ success: false, error, details }, { status: 400, headers: NO_STORE })
}

export function internalError(): NextResponse {
  return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500, headers: NO_STORE })
}

export function approverRequired(): NextResponse {
  return NextResponse.json({ success: false, error: 'APPROVER_REQUIRED' }, { status: 403, headers: NO_STORE })
}
