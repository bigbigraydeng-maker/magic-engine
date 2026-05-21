import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'

/**
 * GET /api/clients/[id]/seo-intelligence/metrics
 *
 * Returns the latest flywheel_metrics snapshot for the SEO flywheel.
 * One value per metric_key — most recent measured_at wins.
 *
 * Response shape:
 * {
 *   organic_keywords: number | null
 *   organic_traffic:  number | null
 *   authority_score:  number | null
 *   published_posts:  number | null
 *   last_updated:     string | null  // ISO timestamp of the most recent measurement
 * }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const { id: clientId } = await params

  const { data, error } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_key, metric_value, measured_at')
    .eq('client_id', clientId)
    .eq('flywheel', 'seo')
    .order('measured_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Deduplicate: keep the most recent row per metric_key (rows are already ordered desc)
  const latest = new Map<string, { value: number; measuredAt: string }>()
  for (const row of data ?? []) {
    if (!latest.has(row.metric_key)) {
      latest.set(row.metric_key, {
        value: row.metric_value as number,
        measuredAt: row.measured_at as string,
      })
    }
  }

  const get = (key: string): number | null => latest.get(key)?.value ?? null

  const allTimestamps = Array.from(latest.values()).map(v => v.measuredAt)
  const lastUpdated = allTimestamps.length > 0
    ? allTimestamps.reduce((a, b) => (a > b ? a : b))
    : null

  return NextResponse.json({
    organic_keywords: get(SEO_METRIC_KEY.ORGANIC_KEYWORDS),
    organic_traffic:  get(SEO_METRIC_KEY.ORGANIC_TRAFFIC),
    authority_score:  get(SEO_METRIC_KEY.AUTHORITY_SCORE),
    published_posts:  get(SEO_METRIC_KEY.PUBLISHED_POSTS),
    last_updated:     lastUpdated,
  })
}
