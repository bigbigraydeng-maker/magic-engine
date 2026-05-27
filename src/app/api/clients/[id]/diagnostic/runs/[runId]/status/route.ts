/**
 * GET /api/clients/[id]/diagnostic/runs/[runId]/status
 *
 * Lightweight status probe — returns the run's current status
 * without the full findings list.
 * Polled by useDiagnosticStatus every 3 s while run is active.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; runId: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { runId } = params

    const { data: run, error } = await supabaseAdmin
      .from('diagnostic_runs')
      .select('id, status, overall_score, dimension_scores, started_at, completed_at, error_message')
      .eq('id', runId)
      .eq('client_id', clientId)
      .single()

    if (error || !run) {
      return NextResponse.json(
        { success: false, error: 'Run not found' },
        { status: 404 },
      )
    }

    return NextResponse.json({ success: true, run })
  } catch (err: unknown) {
    console.error('[diagnostic/runs/status] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}
