/**
 * GET /api/goals/[goalId]/execution-summary
 *
 * P33.12 — Returns action completion stats grouped by initiative_id.
 * Used by Goal detail page to render per-initiative progress bars.
 *
 * Response:
 *   {
 *     byInitiative: Record<string, { total: number; completed: number; in_progress: number; pending: number }>
 *     totals: { total: number; completed: number; in_progress: number; pending: number }
 *   }
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'

export async function GET(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const clientId = access.row.client_id

  // Get all initiatives for this goal (to know which initiative_ids belong here)
  const { data: initiatives, error: initErr } = await supabaseAdmin
    .from('initiatives')
    .select('id')
    .eq('goal_id', params.goalId)
    .neq('initiative_type', 'unassigned')

  if (initErr) {
    return NextResponse.json({ error: 'Failed to load initiatives' }, { status: 500 })
  }

  const initiativeIds = (initiatives ?? []).map(i => i.id)

  if (initiativeIds.length === 0) {
    return NextResponse.json({
      byInitiative: {},
      totals: { total: 0, completed: 0, in_progress: 0, pending: 0 },
    })
  }

  // Get all execution_items for this client that belong to these initiatives
  const { data: items, error: itemErr } = await supabaseAdmin
    .from('execution_items')
    .select('id, status, initiative_id')
    .eq('client_id', clientId)
    .in('initiative_id', initiativeIds)

  if (itemErr) {
    return NextResponse.json({ error: 'Failed to load execution items' }, { status: 500 })
  }

  const rows = items ?? []

  type Counts = { total: number; completed: number; in_progress: number; pending: number }
  const byInitiative: Record<string, Counts> = {}

  for (const id of initiativeIds) {
    byInitiative[id] = { total: 0, completed: 0, in_progress: 0, pending: 0 }
  }

  for (const item of rows) {
    if (!item.initiative_id || !byInitiative[item.initiative_id]) continue
    const c = byInitiative[item.initiative_id]
    c.total++
    if (item.status === 'completed') c.completed++
    else if (item.status === 'in_progress') c.in_progress++
    else c.pending++
  }

  const totals = rows.reduce<Counts>(
    (acc, item) => {
      acc.total++
      if (item.status === 'completed') acc.completed++
      else if (item.status === 'in_progress') acc.in_progress++
      else acc.pending++
      return acc
    },
    { total: 0, completed: 0, in_progress: 0, pending: 0 },
  )

  return NextResponse.json({ byInitiative, totals })
}
