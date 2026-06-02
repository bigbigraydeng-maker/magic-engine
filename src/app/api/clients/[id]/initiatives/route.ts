/**
 * GET /api/clients/[id]/initiatives
 *
 * Phase 33 — List all non-archived initiatives for a client across all goals.
 * Used by PlanGenerator dropdown to let FDE associate a marketing plan with an initiative.
 *
 * Returns: { initiatives: Array<{id, title, goal_title, initiative_type}> }
 */

import { NextResponse } from 'next/server'
import { listInitiativesForClient } from '@/lib/strategy/initiatives'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const rows = await listInitiativesForClient(supabaseAdmin, clientId)

  // Return slim shape; filter out unassigned migration buckets
  const initiatives = rows
    .filter(r => r.initiative_type !== 'unassigned')
    .map(r => ({
      id:              r.id,
      title:           r.title,
      initiative_type: r.initiative_type,
      goal_id:         r.goal_id,
      goal_title:      r.goal_title,
    }))

  return NextResponse.json({ initiatives })
}
