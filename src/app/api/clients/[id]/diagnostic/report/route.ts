/**
 * GET /api/clients/[id]/diagnostic/report
 *
 * Generates the three-artifact diagnostic report for the latest completed run
 * (or a specific run via ?run_id=xxx).
 *
 * Returns: { success, run_id, html, markdown, evidence: { filename, json } }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S4.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { generateReport } from '@/lib/diagnostic/report-generator'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId } = params
  const url = new URL(req.url)
  let runId = url.searchParams.get('run_id')

  if (!runId) {
    const { data: runs, error: runError } = await supabaseAdmin
      .from('diagnostic_runs')
      .select('id')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)

    if (runError) {
      console.error('[diagnostic/report] fetch latest run error:', runError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch diagnostic run' },
        { status: 500 },
      )
    }

    const latest = (runs as unknown[])?.[0] as { id: string } | undefined
    if (!latest) {
      return NextResponse.json(
        { success: false, error: 'No completed diagnostic found' },
        { status: 404 },
      )
    }
    runId = latest.id
  }

  try {
    const artifacts = await generateReport(supabaseAdmin, runId, clientId)

    return NextResponse.json({
      success: true,
      run_id: runId,
      html: artifacts.html,
      markdown: artifacts.markdown,
      evidence: artifacts.evidence,
    })
  } catch (err: unknown) {
    console.error('[diagnostic/report] generation error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Report generation failed',
      },
      { status: 500 },
    )
  }
}
