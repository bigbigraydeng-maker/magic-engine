import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * GET /api/clients/[id]/dashboard-summary
 *
 * Aggregates the 4 status dimensions shown on the client detail page:
 *   1. DNZ site pages (crawled / failed counts)
 *   2. Strategy items (total + priority breakdown)
 *   3. Master Brief existence
 *   4. GEO Directives active count
 *
 * Reference: ROADMAP.md P8.D.3
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  const [
    { count: crawledPages, error: e1 },
    { count: failedPages, error: e2 },
    { data: strategyRows, error: e3 },
    { data: brief, error: e4 },
    { count: geoCount, error: e5 },
  ] = await Promise.all([
    supabaseAdmin
      .from('client_site_pages')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('crawl_status', 'crawled'),
    supabaseAdmin
      .from('client_site_pages')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('crawl_status', 'failed'),
    supabaseAdmin
      .from('content_strategy_items')
      .select('priority')
      .eq('client_id', clientId),
    supabaseAdmin
      .from('master_briefs')
      .select('id, updated_at')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('geo_directives')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'active'),
  ])

  if (e1 || e2 || e3 || e4 || e5) {
    const msg = [e1, e2, e3, e4, e5].find(Boolean)?.message ?? 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }

  const priorities = (strategyRows ?? []).map((r: { priority: string }) => r.priority)
  const countBy = (p: string) => priorities.filter((x) => x === p).length

  return NextResponse.json({
    success: true,
    dnz: {
      crawled: crawledPages ?? 0,
      failed: failedPages ?? 0,
      total: (crawledPages ?? 0) + (failedPages ?? 0),
    },
    strategy: {
      total: priorities.length,
      critical: countBy('critical'),
      high: countBy('high'),
      medium: countBy('medium'),
      low: countBy('low'),
    },
    master_brief: {
      exists: !!brief,
      updated_at: brief ? (brief as any).updated_at : null,
    },
    geo: {
      active_count: geoCount ?? 0,
    },
  })
}
