/**
 * GET /api/clients/[id]/messenger/conversations/[conversationId]/drafts
 *
 * The AI-drafted replies still waiting on a human decision for this thread
 * (Issue #1588, `conversation_reply_drafts` from #1574). Only `verifier_status
 * = 'pending'` rows come back — a draft only reaches this table's `pending`
 * state after clearing every Verifier gate (#1579), so "在待批准列表里" already
 * means "过关了"; blocked/sent/rejected/etc. drafts belong to history, not the
 * approval queue, and are not this endpoint's job.
 *
 * Same ownership rule as the sibling `messages` route: the conversation id
 * comes from the URL, so it is re-proven against this client and channel
 * rather than trusted from the access guard alone.
 *
 * Responses:
 *   200  { drafts: [...] }
 *   401  not authenticated
 *   403  not a member of this client
 *   404  no such thread for this client
 *   500  query failed
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { CTS_CLIENT_ID, ctsVerifierGates } from '@/lib/messenger-agent/verifier/policies/cts'

interface RouteParams {
  params: { id: string; conversationId: string }
}

/**
 * A row only reaches `verifier_status='pending'` after clearing every gate
 * in its client's Verifier policy (#1579) — so "过关记录" for the portal is
 * just that policy's gate id list, reused rather than re-declared here. The
 * Verifier is currently CTS-only (`cts.ts`'s own header: "L4 客户专属"), so
 * this only attaches a real list for CTS; another client's drafts (none
 * exist yet — F2/#1585 hasn't shipped for any client) get an empty list
 * rather than this route silently presenting CTS's gates as platform truth.
 */
function passedGateIdsFor(clientId: string): string[] {
  return clientId === CTS_CLIENT_ID ? ctsVerifierGates.map((g) => g.id) : []
}

interface DraftRow {
  id: string
  draft_body: string
  agent_confidence: number | null
  quoted_offering_names: string[] | null
  verifier_output_json: { ok?: boolean; blocked_reasons?: string[] } | null
  created_at: string
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data: convo } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('id', params.conversationId)
    .eq('client_id', params.id)
    .eq('channel', 'messenger')
    .maybeSingle()

  if (!convo) {
    return NextResponse.json({ error: '对话不存在' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin
    .from('conversation_reply_drafts')
    .select('id, draft_body, agent_confidence, quoted_offering_names, verifier_output_json, created_at')
    .eq('client_id', params.id)
    .eq('conversation_id', params.conversationId)
    .eq('verifier_status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as DraftRow[]
  const passedGateIds = passedGateIdsFor(params.id)

  return NextResponse.json({
    drafts: rows.map((d) => ({
      id: d.id,
      draftBody: d.draft_body,
      agentConfidence: d.agent_confidence,
      quotedOfferingNames: d.quoted_offering_names ?? [],
      verifierOutputJson: d.verifier_output_json,
      passedGateIds,
      createdAt: d.created_at,
    })),
  })
}
