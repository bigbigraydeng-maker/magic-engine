/**
 * Story auto-publish — shared route helpers (slice 2b).
 *
 * Turns an authenticated dashboard session into a `StoryActor`, validates the path ids
 * and maps a service result onto an HTTP response. No business rule lives here.
 */
import { NextResponse } from 'next/server'

import { requireDashboardClientAccess } from '@/lib/auth/client-access'

import type { StoryActor } from './service-ports'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** Result of resolving the caller: an actor, or a ready-made error response. */
export type ActorResolution = { ok: true; actor: StoryActor } | { ok: false; response: NextResponse }

/** Validate the ids in the path and resolve the signed-in person. */
export async function resolveStoryActor(clientId: string, packId: string): Promise<ActorResolution> {
  if (!isUuid(clientId) || !isUuid(packId)) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'BAD_ID' }, { status: 400 }) }
  }
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: access.error }, { status: access.status }) }
  }
  return {
    ok: true,
    actor: { id: access.user.id, email: access.user.email ?? '', allowedClientId: access.allowedClientId },
  }
}

/** Shape of every service result the routes forward. */
export type ForwardableResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; details?: unknown; rollback?: 'OK' | 'FAILED' }

/** Map a service result to JSON: success => 200 with the value spread in; failure => its status. */
export function toResponse<T extends object>(result: ForwardableResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ success: true, ...result.value })
  }
  const body: Record<string, unknown> = { success: false, error: result.error }
  if (result.details !== undefined) body.details = result.details
  if (result.rollback !== undefined) {
    body.rollback = result.rollback
    if (result.rollback === 'FAILED') {
      body.hint = 'The grant could not be rolled back and may still exist — revoke it explicitly.'
    }
  }
  return NextResponse.json(body, { status: result.status })
}

/**
 * State-changing routes accept JSON only. A cross-site form post cannot send `application/json`
 * without a CORS preflight, so this closes the plain-form request path.
 */
export function requireJsonContentType(req: { headers: { get(name: string): string | null } }): NextResponse | null {
  const type = (req.headers.get('content-type') ?? '').toLowerCase()
  if (type.startsWith('application/json')) return null
  return NextResponse.json({ success: false, error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 })
}

/** A fixed, never-leaky 500 body for anything unexpected. */
export function internalError(): NextResponse {
  return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 })
}
