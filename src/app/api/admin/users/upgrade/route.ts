/**
 * POST /api/admin/users/upgrade
 *
 * Phase X.S3 H1 — Admin-only endpoint for promoting a self_serve user to
 * a paid tier. The actual logic lives in `lib/auth/upgrade-self-serve.ts`;
 * this route is a thin auth + validation wrapper.
 *
 * Body:
 *   {
 *     email: string                  // required — the user to upgrade
 *     to_access_type?: 'client'      // default 'client'; pass 'dashboard'/'fde'/'both' as needed
 *                   | 'dashboard'
 *                   | 'fde'
 *                   | 'both'
 *     merge_into_client_id?: string  // optional — UUID of an existing client to merge into
 *     display_name?: string          // optional — override display name on the upgraded row
 *   }
 *
 * Responses:
 *   200 { ok: true, client_id, already_upgraded, merged }
 *   400 invalid body or unknown email
 *   403 admin-only
 *   500 db error
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardAdmin } from '@/lib/auth/require-admin'
import { upgradeSelfServeToPaid } from '@/lib/auth/upgrade-self-serve'

type AllowedToType = 'client' | 'dashboard' | 'fde' | 'both'
const ALLOWED_TO_TYPES: ReadonlySet<AllowedToType> = new Set(['client', 'dashboard', 'fde', 'both'])

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  let body: {
    email?: unknown
    to_access_type?: unknown
    merge_into_client_id?: unknown
    display_name?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (typeof body.email !== 'string' || !body.email.trim()) {
    return NextResponse.json({ error: 'email is required.' }, { status: 400 })
  }

  let toAccessType: AllowedToType | undefined
  if (body.to_access_type != null) {
    if (typeof body.to_access_type !== 'string' || !ALLOWED_TO_TYPES.has(body.to_access_type as AllowedToType)) {
      return NextResponse.json(
        { error: `to_access_type must be one of: ${[...ALLOWED_TO_TYPES].join(' | ')}.` },
        { status: 400 },
      )
    }
    toAccessType = body.to_access_type as AllowedToType
  }

  const mergeIntoClientId =
    typeof body.merge_into_client_id === 'string' && body.merge_into_client_id.trim()
      ? body.merge_into_client_id.trim()
      : undefined
  const displayName =
    typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim()
      : undefined

  const result = await upgradeSelfServeToPaid({
    email: body.email,
    toAccessType,
    mergeIntoClientId,
    displayName,
  })

  if (!result.ok) {
    const status =
      result.reason === 'no_self_serve_row' || result.reason === 'target_client_missing' ? 404
        : result.reason === 'unique_violation' ? 409
        : 500
    return NextResponse.json({ error: result.message, reason: result.reason }, { status })
  }

  return NextResponse.json({
    ok:               true,
    email:            result.email,
    client_id:        result.clientId,
    already_upgraded: result.alreadyUpgraded,
    merged:           result.merged,
    /** Phase X.S6 M-3 — only present when merge succeeded but the old
     *  self_serve row could not be deleted; admin UI should surface this. */
    cleanup_pending:  result.cleanupPending ?? false,
    cleanup_row_id:   result.cleanupRowId,
  })
}
