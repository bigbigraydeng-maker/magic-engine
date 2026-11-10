/**
 * POST /api/clients/[id]/triggered-send/propose
 *
 * Writes (or, without `confirm: true`, only previews) a proposal for the welcome letter: the rule snapshot with its
 * send block, bound to the template's current version and fingerprint. A proposal authorizes nothing and sends
 * nothing; an open proposal is replaced. Global administrator only (`authorization-http.ts`).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3 (plan: §17).
 */
import type { NextRequest } from 'next/server'
import { ProposeCommandSchema, proposeCommand } from '@/lib/messaging/triggered-send/authorization-commands'
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
  const parsed = ProposeCommandSchema.safeParse(read.body)
  if (!parsed.success) return invalidCommand('INVALID_PROPOSE_COMMAND', parsed.error.flatten())
  if (parsed.data.client_id !== params.id) return invalidCommand('CLIENT_ID_MISMATCH', null)
  try {
    return respond(await proposeCommand(createAuthorizationDeps(supabaseAdmin), params.id, gate.actor, parsed.data))
  } catch (error: unknown) {
    // The name only: a failed write's message can echo the row.
    console.error('[triggered-send propose] failed', error instanceof Error ? error.name : 'unknown')
    return internalError()
  }
}
