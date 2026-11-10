/**
 * GET /api/clients/[id]/triggered-send/status
 *
 * Read-only status of the welcome letter's authorization for the PM's page (`authorization-status.ts`).
 * A logged-in user who is not a global administrator gets a bare `{ success: true, can_manage: false }` and nothing
 * else, so the answer does not even say whether a proposal exists. Never writes and never sends.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3 (plan: §17).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createAuthorizationStatusDeps } from '@/lib/messaging/triggered-send/authorization-deps-prod'
import { internalError, NO_STORE, requireTriggeredSendAdmin, respond } from '@/lib/messaging/triggered-send/authorization-http'
import { statusQuery } from '@/lib/messaging/triggered-send/authorization-status'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireTriggeredSendAdmin(params.id)
  if (!gate.ok) {
    if (gate.reason === 'not_admin') return NextResponse.json({ success: true, can_manage: false }, { headers: NO_STORE })
    return gate.response
  }
  try {
    return respond(await statusQuery(createAuthorizationStatusDeps(supabaseAdmin), params.id))
  } catch (error: unknown) {
    console.error('[triggered-send status] failed', error instanceof Error ? error.name : 'unknown')
    return internalError()
  }
}
