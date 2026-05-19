/**
 * GET /api/clients/[id]/zhuge/latest-actions
 *
 * Returns the most recent Zhuge conductor session's priority actions
 * for a client, read from flywheel_actions (persisted by P12.G.3).
 *
 * Strategy:
 *   1. Find the latest flywheel_action row for this client that has a
 *      zhuge_session_key in its payload (→ that row's executed_at is the
 *      session timestamp).
 *   2. Fetch all rows sharing that session_key.
 *   3. Return them sorted by payload.rank ASC.
 *
 * Responses:
 *   200  { success: true, actions: ZhugeActionRow[], generated_at: string }
 *   200  { success: true, actions: [], generated_at: null }  — no session yet
 *   404  client not found
 *   500  DB error
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P12.G.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'

export const dynamic = 'force-dynamic'

export interface ZhugeActionRow {
  id: string
  flywheel: string
  action_type: string
  execution_mode: string
  expected_metric: string | null
  executed_at: string
  payload: {
    rank: number
    why_now: string
    evidence_refs: string[]
    expected_impact: 'low' | 'medium' | 'high'
    effort: 'low' | 'medium' | 'high'
    executable_by: string | null
    zhuge_session_key: string
    discovery_id: string
    diagnostic_run_id: string | null
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId } = params

  // Verify client exists
  const { data: clientRow, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .single()

  if (clientError || !clientRow) {
    return NextResponse.json(
      { success: false, error: `Client ${clientId} not found.` },
      { status: 404 },
    )
  }

  // Step 1: Find the latest Zhuge session key
  const { data: latestRow, error: latestError } = await supabaseAdmin
    .from('flywheel_actions')
    .select('payload, executed_at')
    .eq('client_id', clientId)
    .not('payload->>zhuge_session_key', 'is', null)
    .order('executed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestError) {
    console.error('[zhuge/latest-actions] DB error finding latest session:', latestError.message)
    return NextResponse.json({ success: false, error: latestError.message }, { status: 500 })
  }

  if (!latestRow) {
    return NextResponse.json({ success: true, actions: [], generated_at: null })
  }

  const sessionKey = (latestRow.payload as { zhuge_session_key?: string }).zhuge_session_key
  if (!sessionKey) {
    return NextResponse.json({ success: true, actions: [], generated_at: null })
  }

  // Step 2: Fetch all actions for that session
  const { data: actions, error: actionsError } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, flywheel, action_type, execution_mode, expected_metric, executed_at, payload')
    .eq('client_id', clientId)
    .eq('payload->>zhuge_session_key', sessionKey)
    .order('executed_at', { ascending: true })

  if (actionsError) {
    console.error('[zhuge/latest-actions] DB error fetching session actions:', actionsError.message)
    return NextResponse.json({ success: false, error: actionsError.message }, { status: 500 })
  }

  // Sort by rank from payload (ascending)
  const sorted = ((actions ?? []) as ZhugeActionRow[]).sort(
    (a, b) => (a.payload?.rank ?? 99) - (b.payload?.rank ?? 99),
  )

  return NextResponse.json({
    success: true,
    actions: sorted,
    generated_at: latestRow.executed_at as string,
  })
}
