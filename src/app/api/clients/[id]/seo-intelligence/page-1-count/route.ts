import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/clients/[id]/seo-intelligence/page-1-count
 *
 * Returns the count of keywords ranking on Google Page 1 (position ≤ 10) in
 * the latest keyword_snapshots batch for this client.
 *
 * This complements the `metrics` endpoint (which serves clicks / impressions /
 * avg_position from flywheel_metrics). Page-1 count is not in flywheel_metrics
 * — it is derived directly from keyword_snapshots and is the most actionable
 * "client SEO baseline" signal for the FDE.
 *
 * Response shape:
 * {
 *   page_1_keywords: number  // 0 if no snapshot exists
 *   snapshot_date:   string | null  // ISO date of the snapshot used
 * }
 *
 * Phase 22.E.S4ext — SEO 列头客户事实快照.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const { id: clientId } = await params

  // Find the latest snapshot_date for this client (any location_code).
  const { data: latestRow, error: latestErr } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', clientId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestErr) {
    return NextResponse.json({ error: latestErr.message }, { status: 500 })
  }

  const snapshotDate = (latestRow as { snapshot_date?: string } | null)?.snapshot_date ?? null

  if (!snapshotDate) {
    return NextResponse.json({ page_1_keywords: 0, snapshot_date: null })
  }

  // Count keywords with position ≤ 10 in the latest snapshot.
  const { count, error: countErr } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('snapshot_date', snapshotDate)
    .not('position', 'is', null)
    .lte('position', 10)

  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 })
  }

  return NextResponse.json({
    page_1_keywords: count ?? 0,
    snapshot_date:   snapshotDate,
  })
}
