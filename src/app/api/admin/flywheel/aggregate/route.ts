/**
 * GET /api/admin/flywheel/aggregate
 *
 * Returns verdict statistics grouped by action_type across all clients
 * (or a single client when client_id is specified).
 *
 * Used by:
 *  - Admin Dashboard "飞轮成效" card (P12.C.1)
 *  - P22.B.3 Action attribution analysis
 *
 * Query params:
 *   top        — number of top entries to return, default 5 (max 20)
 *   min        — minimum total outcomes required per entry, default 2
 *   client_id  — optional; when provided, scopes results to that client only
 *   flywheel   — optional; filter by flywheel ("seo" | "geo" | "ads" | "social")
 *
 * Security: Admin-only (guardAdmin).
 * Reference: ROADMAP.md Phase 12.C.1 + Phase 22.B.3
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildAggregateRows, pickTop } from '@/lib/flywheel/aggregate/outcome-aggregate'
import { guardAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

type OutcomeRow = {
  verdict: string
  flywheel_actions: { action_type: string; flywheel: string | null } | { action_type: string; flywheel: string | null }[]
}

export async function GET(request: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const { searchParams } = new URL(request.url)
  const top       = Math.min(Math.max(parseInt(searchParams.get('top')  ?? '5', 10), 1), 20)
  const min       = Math.max(parseInt(searchParams.get('min')  ?? '2', 10), 1)
  const clientId  = searchParams.get('client_id') ?? null
  const flywheel  = searchParams.get('flywheel')  ?? null

  // ── Build query ─────────────────────────────────────────────────────────────

  let query = supabaseAdmin
    .from('flywheel_outcomes')
    .select('verdict, flywheel_actions!inner(action_type, flywheel, client_id)')

  if (clientId) {
    // PostgREST: filter on joined table column via dot notation
    query = (query as typeof query).eq('flywheel_actions.client_id', clientId)
  }
  if (flywheel) {
    query = (query as typeof query).eq('flywheel_actions.flywheel', flywheel)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Flatten and aggregate ───────────────────────────────────────────────────

  const rows = (data as OutcomeRow[] ?? []).map(r => {
    const actions = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
    return { action_type: actions?.action_type ?? 'unknown', verdict: r.verdict }
  })

  const aggregate  = buildAggregateRows(rows)
  const topEntries = pickTop(aggregate, top, min)

  return NextResponse.json({
    top: topEntries,
    total_actions: aggregate.length,
    total_outcomes: rows.length,
    filters: { client_id: clientId, flywheel },
  })
}
