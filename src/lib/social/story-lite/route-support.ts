/**
 * Story "lite" — route helpers: resolve the signed-in person into a `LiteActor` and map a service
 * result onto an HTTP response. Reuses the id check and JSON guard of the shared story route helpers.
 */
import { NextResponse } from 'next/server'

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isUuid } from '@/lib/social/story-publish/route-support'

import type { LiteResult } from './service'
import type { LiteActor } from './types'

export type LiteActorResolution = { ok: true; actor: LiteActor } | { ok: false; response: NextResponse }

/** Validate the path ids and resolve the signed-in person; returns a ready-made error response otherwise. */
export async function resolveLiteActor(clientId: string, packId: string): Promise<LiteActorResolution> {
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

/** Success => 200 with the value spread in; failure => its status with a fixed body (no internals). */
export function toLiteResponse<T extends object>(result: LiteResult<T>): NextResponse {
  if (result.ok) return NextResponse.json({ success: true, ...result.value })
  const body: Record<string, unknown> = { success: false, error: result.error }
  if (result.details !== undefined) body.details = result.details
  return NextResponse.json(body, { status: result.status })
}

/** Like `resolveLiteActor`, for routes that have no pack id (the pack list). */
export async function resolveLiteClientActor(clientId: string): Promise<LiteActorResolution> {
  if (!isUuid(clientId)) {
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
