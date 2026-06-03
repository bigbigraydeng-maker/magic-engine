/**
 * GET /api/cron/ai-visibility-weekly
 *
 * Weekly Industry AI Visibility collection cron.
 * Triggered by Render scheduled task every Monday 06:00 UTC (≈18:00 NZST).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 *
 * Runs all active questions across all platforms (chatgpt + google_ai_overview + google_serp).
 * One row written per (question, platform, week_of) into industry_ai_visibility_snapshots.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runCollection } from '@/lib/industry-ai-visibility/orchestrator'

// 500 questions × ~3-4s each = ~30min worst case. Render allows long jobs.
// Vercel maxDuration caps at 300s on Pro plan — but ME runs on Render
// for cron workloads so this is fine.
export const maxDuration = 600

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runCollection({ triggeredBy: 'cron' })
    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST for admin retry from UI (e.g., "rerun this week's batch")
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runCollection({ triggeredBy: 'admin_manual' })
    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
