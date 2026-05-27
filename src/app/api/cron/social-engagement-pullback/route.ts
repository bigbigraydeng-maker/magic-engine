/**
 * GET /api/cron/social-engagement-pullback
 *
 * Pulls Publer post engagement (likes / comments / shares) for all published
 * content_posts and writes metrics to flywheel_metrics.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Schedule: every day at 04:00 UTC (Render Cron — registered in render.yaml)
 *
 * Reference: ROADMAP.md P12.C.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { pullbackAllEngagement } from '@/lib/publer/engagement-pullback'

// Pulling engagement for many posts may take a while; allow up to 5 min.
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const auth = request.headers.get('Authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!auth || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await pullbackAllEngagement(supabaseAdmin)
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      ...result,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/social-engagement-pullback]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
