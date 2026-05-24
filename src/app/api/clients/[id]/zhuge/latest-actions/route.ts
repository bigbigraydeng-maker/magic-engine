/**
 * GET /api/clients/[id]/zhuge/latest-actions
 *
 * Returns the most recent Zhuge conductor session's priority actions for a
 * client, read from zhuge_sessions (persisted by the updated action-persister).
 *
 * zhuge_sessions stores the FULL ZhugeOutput including reputation/competitor
 * dimensions that were previously lost because flywheel_actions only accepted
 * the 4 flywheel-mapped dimensions.
 *
 * Strategy:
 *   1. Find the latest zhuge_sessions row for this client.
 *   2. Map output.top_actions → ZhugeActionRow shape for the widget.
 *
 * Falls back to flywheel_actions for clients that have sessions persisted
 * before this migration (legacy path).
 *
 * Responses:
 *   200  { success: true, actions: ZhugeActionRow[], generated_at: string }
 *   200  { success: true, actions: [], generated_at: null }  — no session yet
 *   404  client not found
 *   500  DB error
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P12.G.4 (updated for zhuge_sessions)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type { ZhugeOutput, PriorityAction } from '@/lib/zhuge/types'

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

/** Map a PriorityAction from ZhugeOutput to the ZhugeActionRow shape the widget expects. */
function mapActionToRow(action: PriorityAction, sessionKey: string, generatedAt: string): ZhugeActionRow {
  return {
    // Use rank+action_type as a stable synthetic ID (no DB row for these)
    id: `${sessionKey}-${action.rank}`,
    flywheel: action.dimension,
    action_type: action.action_type,
    execution_mode: action.execution_mode,
    expected_metric: null,
    executed_at: generatedAt,
    payload: {
      rank: action.rank,
      why_now: action.why_now,
      evidence_refs: action.evidence_refs,
      expected_impact: action.expected_impact,
      effort: action.effort,
      executable_by: action.executable_by,
      zhuge_session_key: sessionKey,
      discovery_id: '',
      diagnostic_run_id: null,
    },
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

  // ── Primary path: read from zhuge_sessions (all 6 dimensions) ────────────────
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('zhuge_sessions')
    .select('session_key, output, generated_at')
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionError) {
    console.error('[zhuge/latest-actions] zhuge_sessions error:', sessionError.message)
    // Fall through to legacy path
  }

  if (session) {
    const output = session.output as ZhugeOutput
    const actions = (output.top_actions ?? [])
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map((a) => mapActionToRow(a, session.session_key as string, session.generated_at as string))

    return NextResponse.json({
      success: true,
      actions,
      generated_at: session.generated_at,
      output,
    })
  }

  // ── Legacy fallback: read from flywheel_actions (pre-migration sessions) ─────
  const { data: latestRow, error: latestError } = await supabaseAdmin
    .from('flywheel_actions')
    .select('payload, executed_at')
    .eq('client_id', clientId)
    .not('payload->>zhuge_session_key', 'is', null)
    .order('executed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestError) {
    console.error('[zhuge/latest-actions] flywheel_actions fallback error:', latestError.message)
    return NextResponse.json({ success: false, error: latestError.message }, { status: 500 })
  }

  if (!latestRow) {
    return NextResponse.json({ success: true, actions: [], generated_at: null, output: null })
  }

  const sessionKey = (latestRow.payload as { zhuge_session_key?: string }).zhuge_session_key
  if (!sessionKey) {
    return NextResponse.json({ success: true, actions: [], generated_at: null, output: null })
  }

  const { data: legacyActions, error: legacyError } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, flywheel, action_type, execution_mode, expected_metric, executed_at, payload')
    .eq('client_id', clientId)
    .eq('payload->>zhuge_session_key', sessionKey)
    .order('executed_at', { ascending: true })

  if (legacyError) {
    return NextResponse.json({ success: false, error: legacyError.message }, { status: 500 })
  }

  const sorted = ((legacyActions ?? []) as ZhugeActionRow[]).sort(
    (a, b) => (a.payload?.rank ?? 99) - (b.payload?.rank ?? 99),
  )

  return NextResponse.json({
    success: true,
    actions: sorted,
    generated_at: latestRow.executed_at as string,
    output: null,
  })
}
