import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGa4FormFunnelRaw, Ga4ApiError } from '@/lib/ga4/client'
import { summariseFormFunnel, type FormFunnelSummary } from '@/lib/ga4/form-funnel'

/**
 * GET /api/internal/ga4-form-funnel   (manual only — NOT a cron: lives outside /api/cron so the
 * cron-coverage check does not mistake it for an unscheduled job)
 *
 * Read-only report: how many people started a form (GA4 `form_start`) vs reached the
 * thank-you page, per client with a connected GA4 property. Writes nothing anywhere, so
 * `dry_run` is accepted for interface parity with the other trial routes but changes nothing.
 *
 * Triggered through the manual trial workflow (`manual-cron-trial.yml`), which carries the
 * CRON_SECRET; the GA4 credentials live on the server, never in a developer window.
 *
 * Query: client_id=<uuid> (REQUIRED — one client per call keeps the run inside its time limit),
 *        days=<1..90> (default 28), dry_run=1|0 (ignored: read-only)
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ClientResult {
  client_id: string
  status: 'ok' | 'no_ga4_connection' | 'no_token' | 'error'
  summary?: FormFunnelSummary
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
    try {
      const raw = await fetchGa4FormFunnelRaw(propertyId, c.client_id, days)
      results.push(raw
        ? { client_id: c.client_id, status: 'ok', summary: summariseFormFunnel(raw) }
        : { client_id: c.client_id, status: 'no_token' })
    } catch (err) {
      // Fixed short code only: Google's response text (account / property details) stays in the server log.
      const code = err instanceof Ga4ApiError ? `GA4 HTTP ${err.httpStatus} ${err.googleStatus}`.slice(0, 80) : 'GA4 read failed'
      results.push({ client_id: c.client_id, status: 'error', error: code })
    }
  }

  // no_token (not authorised / authorisation revoked) is a client state, not a system fault: shown, not counted as failed.
  const failed = results.filter(r => r.status === 'error').length
  return NextResponse.json(
    { success: failed === 0, dry_run: dryRun, read_only: true, days, clients_processed: results.length, failed, results },
    { status: failed === 0 ? 200 : 500 },
  )
}
