/**
 * POST /api/clients/[id]/triggered-send/authorize
 *
 * The PM approves one proposal exactly as he saw it (its rule and template fingerprints are part of the request).
 * Preview unless `confirm: true`; armed only after the authorization event went out (`authorization-authorize.ts`).
 * Sends nothing by itself: real sending also needs the deploy switches, which only the PM turns on.
 * A global administrator who is ALSO on the approver list (the PM himself), `authorization-http.ts`.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3 (plan: §17).
 */
import type { NextRequest } from 'next/server'
import { AuthorizeCommandSchema, authorizeCommand } from '@/lib/messaging/triggered-send/authorization-authorize'
import { createAuthorizationDeps } from '@/lib/messaging/triggered-send/authorization-deps-prod'
import {
  approverRequired,
  internalError,
  invalidCommand,
  readJsonBody,
  requireTriggeredSendAdmin,
  respond,
} from '@/lib/messaging/triggered-send/authorization-http'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireTriggeredSendAdmin(params.id)
  if (!gate.ok) return gate.response
  if (!gate.canAuthorize) return approverRequired()
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = AuthorizeCommandSchema.safeParse(read.body)
  if (!parsed.success) return invalidCommand('INVALID_AUTHORIZE_COMMAND', parsed.error.flatten())
  if (parsed.data.client_id !== params.id) return invalidCommand('CLIENT_ID_MISMATCH', null)
  try {
    return respond(await authorizeCommand(createAuthorizationDeps(supabaseAdmin), params.id, gate.actor, parsed.data))
  } catch (error: unknown) {
    console.error('[triggered-send authorize] failed', error instanceof Error ? error.name : 'unknown')
    return internalError()
  }
}
