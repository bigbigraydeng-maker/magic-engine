/**
 * GET /api/clients/[id]/diagnostic/latest
 *
 * Returns the most recent completed diagnostic run for the client
 * along with its findings sorted by priority_score descending.
 * 404 if no completed run exists.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {

    // Latest completed run (array + take first — avoids single() error on 0 rows)
    const { data: runs, error: runError } = await supabaseAdmin
      .from('diagnostic_runs')
      .select('*')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)

    if (runError) {
      console.error('[diagnostic/latest] Supabase error:', runError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch diagnostic run' },
        { status: 500 },
      )
    }

    const run = (runs as unknown[])?.[0]
    if (!run) {
      return NextResponse.json(
        { success: false, error: 'No completed diagnostic found' },
        { status: 404 },
      )
    }

    const runId = (run as Record<string, unknown>).id as string

    // Findings ordered by priority (highest first)
    const { data: findings } = await supabaseAdmin
      .from('diagnostic_findings')
      .select('*')
      .eq('run_id', runId)
      .order('priority_score', { ascending: false })

    return NextResponse.json({ success: true, run, findings: findings ?? [] })
  } catch (err: unknown) {
    console.error('[diagnostic/latest] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}
