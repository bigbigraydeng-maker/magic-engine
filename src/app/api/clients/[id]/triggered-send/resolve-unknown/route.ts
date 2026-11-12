/**
 * POST /api/clients/[id]/triggered-send/resolve-unknown
 *
 * The PM settles one welcome letter whose outcome nobody could tell: 「已发出」 or 「没发出」 (`resolve-unknown.ts`).
 * Preview unless `confirm: true`. Sends nothing and calls no provider. 「没发出」 means this guest is never welcomed
 * automatically again, so it is the PM himself only: a global administrator who is ALSO on the approver list, the same
 * door as authorizing (`authorization-http.ts`).
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.2, §4.3, §17.4.
 */
import type { NextRequest } from 'next/server'
import {
  approverRequired,
  internalError,
  invalidCommand,
  readJsonBody,
  requireTriggeredSendAdmin,
  respond,
} from '@/lib/messaging/triggered-send/authorization-http'
import { createResolveDeps } from '@/lib/messaging/triggered-send/resolve-store'
import { ResolveUnknownCommandSchema, resolveUnknownCommand } from '@/lib/messaging/triggered-send/resolve-unknown'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireTriggeredSendAdmin(params.id)
  if (!gate.ok) return gate.response
  if (!gate.canAuthorize) return approverRequired()
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = ResolveUnknownCommandSchema.safeParse(read.body)
  if (!parsed.success) return invalidCommand('INVALID_RESOLVE_COMMAND', parsed.error.flatten())
  if (parsed.data.client_id !== params.id) return invalidCommand('CLIENT_ID_MISMATCH', null)
  try {
    return respond(await resolveUnknownCommand(createResolveDeps(supabaseAdmin), params.id, gate.actor, parsed.data))
  } catch (error: unknown) {
    console.error('[triggered-send resolve-unknown] failed', error instanceof Error ? error.name : 'unknown')
    return internalError()
  }
}
