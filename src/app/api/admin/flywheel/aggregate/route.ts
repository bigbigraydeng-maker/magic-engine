/**
 * GET /api/admin/flywheel/aggregate
 *
 * Returns verdict statistics grouped by action_type across all clients.
 * Used by the Admin Dashboard "飞轮成效" card (P12.C.1).
 *
 * Query params:
 *   top     — number of entries to return, default 5
 *   min     — minimum total outcomes required per entry, default 2
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildAggregateRows, pickTop } from '@/lib/flywheel/aggregate/outcome-aggregate'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const top = Math.min(Math.max(parseInt(searchParams.get('top') ?? '5', 10), 1), 20)
  const min = Math.max(parseInt(searchParams.get('min') ?? '2', 10), 1)

  const { data, error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .select('verdict, flywheel_actions!inner(action_type)')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []).map((r: { verdict: string; flywheel_actions: { action_type: string } | { action_type: string }[] }) => {
    const actions = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
    return { action_type: actions?.action_type ?? 'unknown', verdict: r.verdict }
  })

  const aggregate = buildAggregateRows(rows)
  const topEntries = pickTop(aggregate, top, min)

  return NextResponse.json({
    top: topEntries,
    total_actions: aggregate.length,
    total_outcomes: rows.length,
  })
}
