/**
 * POST /api/ai/zhugeliang/proactive
 *
 * Reads all fresh anomaly_signals (written by AnomalyDetectorJob, P22.D.1),
 * calls 诸葛亮 Proactive (Claude Haiku) to decide which signals warrant action,
 * then:
 *   - Writes flywheel_actions(source='proactive_signal') for acted signals
 *   - Writes execution_items(source='proactive_signal') for kanban visibility
 *   - Updates anomaly_signals.status → 'processed' | 'dismissed'
 *
 * Can be called:
 *   1. Manually (internal tooling / admin)
 *   2. By the daily cron at /api/cron/anomaly-detector (P22.D.3)
 *
 * Auth: Bearer $CRON_SECRET (same key as other internal cron routes)
 *
 * Response:
 *   200 { success: true, result: BatchProactiveResult }
 *   401 Unauthorized
 *   500 Error
 *
 * Reference: ROADMAP.md § Phase 22.D.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { runProactivePass } from '@/lib/zhuge/proactive'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runProactivePass()

    return NextResponse.json({
      success: true,
      result,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[zhugeliang/proactive] unhandled error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
