import { NextRequest, NextResponse } from 'next/server'
import { runStrategyAnalysis } from '@/lib/strategy/orchestrator'

/**
 * POST /api/clients/[id]/strategy/generate
 *
 * Runs a fresh 3D analysis: AI weak spots × keyword gaps × site-page snapshot.
 * Persists candidates to content_strategy_items and returns a summary.
 *
 * Reference: ROADMAP.md P8.D.1.4
 */
export const maxDuration = 120

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const summary = await runStrategyAnalysis(params.id)
    return NextResponse.json({ success: true, summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
