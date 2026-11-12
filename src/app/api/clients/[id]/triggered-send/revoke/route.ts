/**
 * POST /api/clients/[id]/triggered-send/revoke
 *
 * The emergency brake: revokes one open proposal or authorization of this client, whatever its rule or template.
 * One database write; the event is best-effort and never undoes it. Takes effect from the next letter on (a letter
 * already handed to the provider is not recalled). Global administrator only (`authorization-http.ts`).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3 (plan: §17).
 */
import type { NextRequest } from 'next/server'
import { RevokeCommandSchema, revokeCommand } from '@/lib/messaging/triggered-send/authorization-commands'
import { createAuthorizationDeps } from '@/lib/messaging/triggered-send/authorization-deps-prod'
import {
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
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = RevokeCommandSchema.safeParse(read.body)
  if (!parsed.success) return invalidCommand('INVALID_REVOKE_COMMAND', parsed.error.flatten())
  if (parsed.data.client_id !== params.id) return invalidCommand('CLIENT_ID_MISMATCH', null)
  try {
    return respond(await revokeCommand(createAuthorizationDeps(supabaseAdmin), params.id, gate.actor, parsed.data))
  } catch (error: unknown) {
    console.error('[triggered-send revoke] failed', error instanceof Error ? error.name : 'unknown')
    return internalError()
  }
}
