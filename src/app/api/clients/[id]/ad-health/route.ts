/**
 * GET /api/clients/[id]/ad-health
 *
 * Returns the Ad Strategy Engine's latest daily verdict for a client, plus a
 * short history of overall verdicts for the trend strip. Read by the ads-health
 * dashboard (P21.K.3). Everything shown is computed by the daily cron and
 * stored in ad_health_narratives — this route only reads.
 *
 * Query params:
 *   history — days of overall-verdict history to include (default 30, max 90)
 *
 * Returns: { success, latest: { insight_date, overall_verdict, headline, payload } | null,
 *            history: [{ insight_date, overall_verdict }], industry: string | null }
 *
 * Reference: docs/superpowers/specs/2026-07-13-ad-strategy-engine.md §8.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const rawHistory = req.nextUrl.searchParams.get('history')
  const historyDays = Math.min(parseInt(rawHistory ?? '30', 10) || 30, 90)

  const [latestRes, historyRes, clientRes] = await Promise.all([
    supabaseAdmin
      .from('ad_health_narratives')
      .select('insight_date, overall_verdict, headline, payload')
      .eq('client_id', clientId)
      .order('insight_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('ad_health_narratives')
      .select('insight_date, overall_verdict')
      .eq('client_id', clientId)
      .order('insight_date', { ascending: false })
      .limit(historyDays),
    // Industry only picks the words the page shows (ads playbook, G11).
    supabaseAdmin
      .from('clients')
      .select('industry')
      .eq('id', clientId)
      .maybeSingle(),
  ])
  if (clientRes.error) {
    console.warn('[api/ad-health] 读客户行业失败，页面改用中性词', { clientId, error: clientRes.error.message })
  }

  if (latestRes.error) {
    return NextResponse.json({ error: latestRes.error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    latest: latestRes.data ?? null,
    // Oldest → newest for the trend strip.
    history: (historyRes.data ?? []).slice().reverse(),
    industry: (clientRes.data as { industry?: string | null } | null)?.industry ?? null,
  })
}
