import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGa4OrganicLandingLeadsRaw, Ga4ApiError } from '@/lib/ga4/client'
import { summariseOrganicLandingLeads, type OrganicLandingLeadsSummary } from '@/lib/ga4/organic-landing-leads'
import { getLandingClassConfig } from '@/lib/ga4/landing-class-config'

/**
 * GET /api/internal/ga4-organic-landing-leads   (manual only — NOT a cron: lives outside /api/cron)
 *
 * Read-only report: Organic Search × first landing page × enquiry events (the site's unified
 * `enquiry_thank_you` event, plus the legacy thank-you page views and `form_submit` for comparison).
 * Writes nothing anywhere, costs nothing (GA4 Data API only). `dry_run` is accepted for interface
 * parity with the other trial routes but changes nothing.
 *
 * Triggered through the manual trial workflow (`manual-cron-trial.yml`), which carries the
 * CRON_SECRET; the GA4 credentials live on the server, never in a developer window.
 *
 * Query: client_id=<uuid> (REQUIRED), days=<1..90> (default 28), dry_run=1|0 (ignored: read-only)
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ClientResult {
  client_id: string
  status: 'ok' | 'not_configured' | 'no_ga4_connection' | 'no_token' | 'error'
  summary?: OrganicLandingLeadsSummary
  error?: string
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const clientId = params.get('client_id')
  if (!clientId || !UUID.test(clientId)) {
    return NextResponse.json({ error: 'client_id (UUID) is required' }, { status: 400 })
  }
  const daysRaw = Number(params.get('days') ?? '28')
  const days = Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 90 ? daysRaw : 28
  const dryRun = params.get('dry_run') === '1'

  const { data: conns, error } = await supabaseAdmin
    .from('client_connectors')
    .select('client_id, config')
    .eq('client_id', clientId)
    .eq('anchor', 'ga4')
    .eq('status', 'connected')
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  const results: ClientResult[] = []
  for (const c of (conns ?? []) as Array<{ client_id: string; config: { property_id?: string } | null }>) {
    const propertyId = c.config?.property_id
    if (!propertyId) {
      results.push({ client_id: c.client_id, status: 'no_ga4_connection' })
      continue
    }
    const cfg = getLandingClassConfig(c.client_id)
    if (!cfg) {
      // No per-client rules (event name, product/guide URL patterns): report that, never guess another client's.
      results.push({ client_id: c.client_id, status: 'not_configured' })
      continue
    }
    try {
      const raw = await fetchGa4OrganicLandingLeadsRaw(propertyId, c.client_id, cfg, days)
      results.push(raw
        ? { client_id: c.client_id, status: 'ok', summary: summariseOrganicLandingLeads(raw, cfg) }
        : { client_id: c.client_id, status: 'no_token' })
    } catch (err) {
      // Fixed short code only: Google's response text (account / property details) stays in the server log.
      const code = err instanceof Ga4ApiError ? `GA4 HTTP ${err.httpStatus} ${err.googleStatus}`.slice(0, 80) : 'GA4 read failed'
      results.push({ client_id: c.client_id, status: 'error', error: code })
    }
  }

  const failed = results.filter(r => r.status === 'error').length
  return NextResponse.json(
    { success: failed === 0, dry_run: dryRun, read_only: true, days, clients_processed: results.length, failed, results },
    { status: failed === 0 ? 200 : 500 },
  )
}
