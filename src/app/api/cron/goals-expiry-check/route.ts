/**
 * GET /api/cron/goals-expiry-check
 *
 * Phase 31 M4 — 每天扫一次，把 period_end < today 且 status='active' 的 Goal
 * 标记为 'expired'，让 FDE 在 UI 上看到"该填 verdict 了"。
 *
 * 不自动 archive — 因为 MVP 阶段 current_value 还要靠 FDE/客户手动填。
 *
 * Auth: Bearer ${CRON_SECRET}
 * 建议调度：每天 03:00 UTC
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { flagExpiredGoals } from '@/lib/strategy/verdict'

export const maxDuration = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await flagExpiredGoals(supabaseAdmin)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    flagged_count: result.flagged_count,
    note: result.flagged_count > 0
      ? `${result.flagged_count} goal(s) moved active → expired; FDE should supply current_value in UI`
      : 'No goals expired today',
  })
}
