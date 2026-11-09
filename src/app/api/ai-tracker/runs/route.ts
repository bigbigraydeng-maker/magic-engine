import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/ai-tracker/runs?client_id=...&limit=60
 *
 * Returns recent AI Visibility runs for a client, ordered by ran_at DESC.
 * Used by the frontend to populate Engine Comparison and Model Stats tabs.
 *
 * Reference: ROADMAP.md P7.1.12
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const clientId = url.searchParams.get('client_id')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '60', 10), 200)

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: 'client_id is required' },
        { status: 400 }
      )
    }

    const access = await requireDashboardClientAccess(clientId)
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status },
      )
    }

    const { data, error } = await supabaseAdmin
      .from('ai_visibility_runs')
      .select(
        'id, query_id, ai_engine, ai_model, brands_mentioned, client_brand_rank, tokens_used, cost_usd, latency_ms, error_message, parse_error_message, ran_at'
      )
      .eq('client_id', clientId)
      .order('ran_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      runs: data ?? [],
      count: data?.length ?? 0,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
