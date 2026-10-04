import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGa4FormFunnelRaw } from '@/lib/ga4/client'
import { summariseFormFunnel, type FormFunnelSummary } from '@/lib/ga4/form-funnel'

/**
 * GET /api/cron/ga4-form-funnel   (manual only — NOT scheduled, no render.yaml entry)
 *
 * Read-only report: how many people started a form (GA4 `form_start`) vs reached the
 * thank-you page, per client with a connected GA4 property. Writes nothing anywhere, so
 * `dry_run` is accepted for interface parity with the other trial routes but changes nothing.
 *
 * Triggered through the manual trial workflow (`manual-cron-trial.yml`), which carries the
 * CRON_SECRET; the GA4 credentials live on the server, never in a developer window.
 *
 * Query: client_id=<uuid> (optional), days=<1..90> (default 28), dry_run=1|0 (ignored: read-only)
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
  const clientId = params.get('client_id') ?? undefined
  if (clientId !== undefined && !UUID.test(clientId)) {
    return NextResponse.json({ error: 'client_id must be a UUID' }, { status: 400 })
  }
  const daysRaw = Number(params.get('days') ?? '28')
  const days = Number.isInteger(daysRaw) && daysRaw >= 1 && daysRaw <= 90 ? daysRaw : 28
  const dryRun = params.get('dry_run') === '1'

  let q = supabaseAdmin
    .from('client_connectors')
    .select('client_id, config')
    .eq('anchor', 'ga4')
    .eq('status', 'connected')
  if (clientId) q = q.eq('client_id', clientId)
  const { data: conns, error } = await q
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
      results.push({ client_id: c.client_id, status: 'error', error: (err instanceof Error ? err.message : String(err)).slice(0, 200) })
    }
  }

  const failed = results.filter(r => r.status === 'error' || r.status === 'no_token').length
  return NextResponse.json(
    { success: failed === 0, dry_run: dryRun, read_only: true, days, clients_processed: results.length, failed, results },
    { status: failed === 0 ? 200 : 500 },
  )
}
