/**
 * GET /api/clients/[id]/initiatives
 *
 * Phase 33 — List all non-archived initiatives for a client across all goals.
 *
 * Used by:
 *   - PlanGenerator dropdown (filters `initiative_type !== 'unassigned'` on the client side)
 *   - Execution Kanban Goal filter + Initiative badge (needs ALL initiatives including
 *     unassigned migration buckets, so the "未归类 Actions" group can identify them)
 *
 * P33.10 fix (2026-06-03): previously this endpoint filtered out unassigned buckets,
 * which broke the Kanban's ability to detect "actions assigned to a migration placeholder"
 * as unassigned. Now returns everything; callers filter as needed.
 *
 * Returns: { initiatives: Array<{id, title, goal_id, goal_title, initiative_type}> }
 */

import { NextResponse } from 'next/server'
import { listInitiativesForClient } from '@/lib/strategy/initiatives'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const rows = await listInitiativesForClient(supabaseAdmin, clientId)

  // Return slim shape — ALL initiatives including unassigned migration buckets.
  // Callers filter by `initiative_type` as needed.
  const initiatives = rows.map(r => ({
    id:              r.id,
    title:           r.title,
    initiative_type: r.initiative_type,
    goal_id:         r.goal_id,
    goal_title:      r.goal_title,
  }))

  return NextResponse.json({ initiatives })
}
