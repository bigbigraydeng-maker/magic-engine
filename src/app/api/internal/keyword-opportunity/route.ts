import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getKeywordIdeas } from '@/lib/dataforseo/labs-keywords'
import { locationCodeFor } from '@/lib/dataforseo/client'
import { domainRoot } from '@/lib/seo-weekly-list/candidates'
import {
  buildOpportunityRows,
  estimateMaxCostUsd,
  EST_COST_PER_CALL_USD,
  EST_COST_PER_ITEM_USD,
  MAX_IDEAS_PER_SEED,
  pickSeeds,
  summariseOpportunity,
  type OwnRank,
  type SeedIdeas,
} from '@/lib/seo-intelligence/keyword-opportunity'

/**
 * GET /api/internal/keyword-opportunity   (manual only — NOT a cron: lives outside /api/cron so the
 * cron-coverage check does not mistake it for an unscheduled job)
 *
 * Full-market opportunity view for one client: pulls keyword ideas for the client's active-brief
 * seeds and compares them with the client's own tracked keywords. Writes NOTHING to the database.
 *
 * PAID in real mode: a real run makes one DataForSEO keyword-ideas call per seed. A run is REAL
 * only when the query carries `dry_run=0` exactly; a missing or any other `dry_run` value is a DRY
 * RUN and makes ZERO vendor calls. Triggered through the manual trial workflow
 * (`manual-cron-trial.yml`), which carries the CRON_SECRET; the vendor credentials live on the
 * server, never in a developer window.
 *
 * Query: client_id=<uuid> (REQUIRED — one client per call keeps the run inside its time limit),
 *        limit=<20..MAX_IDEAS_PER_SEED> (default 150), dry_run=0 (only this value spends money)
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_LIMIT = 150
const MIN_LIMIT = 20

interface ClientRow {
  id: string
  domain: string | null
  semrush_db: string | null
  brand_aliases: string[] | null
  competitor_domains: string[] | null
}

/** limit must be an integer inside [20, MAX_IDEAS_PER_SEED]; anything else falls back to 150. */
function parseLimit(raw: string | null): number {
  const n = Number(raw ?? String(DEFAULT_LIMIT))
  if (!Number.isInteger(n) || n < MIN_LIMIT || n > MAX_IDEAS_PER_SEED) return DEFAULT_LIMIT
  return n
}

/** Latest snapshot day for this client/location, or null when the client has no snapshot yet. */
async function latestSnapshotDay(clientId: string, locationCode: number): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', clientId)
    .eq('location_code', locationCode)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('snapshot read failed')
  return (data as { snapshot_date: string } | null)?.snapshot_date ?? null
}

/** Own tracked keywords for the latest snapshot day; [] when there is no snapshot. */
async function loadOwnRanks(clientId: string, locationCode: number): Promise<OwnRank[]> {
  const day = await latestSnapshotDay(clientId, locationCode)
  if (!day) return []
  const { data, error } = await supabaseAdmin
    .from('keyword_snapshots')
    .select('keyword, position')
    .eq('client_id', clientId)
    .eq('location_code', locationCode)
    .eq('snapshot_date', day)
    .limit(2000)
  if (error) throw new Error('snapshot read failed')
  return ((data ?? []) as Array<{ keyword: string; position: number | null }>).map(r => ({
    keyword: r.keyword,
    position: r.position,
  }))
}

/** One paid call per seed, strictly in order; a failed seed is recorded, never surfaced as text. */
async function runSeeds(seeds: string[], locationCode: number, limit: number): Promise<SeedIdeas[]> {
  const results: SeedIdeas[] = []
  for (const seed of seeds) {
    try {
      const ideas = await getKeywordIdeas(seed, locationCode, limit)
      results.push({ seed, status: ideas.length > 0 ? 'ok' : 'empty', ideas })
    } catch {
      console.error('[keyword-opportunity] seed failed')
      results.push({ seed, status: 'error', ideas: [] })
    }
  }
  return results
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
  const limit = parseLimit(params.get('limit'))
  const dryRun = params.get('dry_run') !== '0'

  const { data: clientData, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, domain, semrush_db, brand_aliases, competitor_domains')
    .eq('id', clientId)
    .maybeSingle()
  if (clientError) return NextResponse.json({ success: false, error: 'client read failed' }, { status: 500 })
  if (!clientData) return NextResponse.json({ success: false, error: 'client not found' }, { status: 404 })
  const client = clientData as ClientRow

  const { data: briefData, error: briefError } = await supabaseAdmin
    .from('master_briefs')
    .select('keyword_seeds')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (briefError) return NextResponse.json({ success: false, error: 'brief read failed' }, { status: 500 })
  const seeds = pickSeeds((briefData as { keyword_seeds: unknown } | null)?.keyword_seeds)
  if (seeds.length === 0) {
    return NextResponse.json(
      { success: true, dry_run: dryRun, read_only: true, status: 'no_seeds', paid_calls_made: 0 },
      { status: 200 },
    )
  }

  const locationCode = locationCodeFor(client.semrush_db)

  let own: OwnRank[]
  try {
    own = await loadOwnRanks(clientId, locationCode)
  } catch {
    return NextResponse.json({ success: false, error: 'snapshot read failed' }, { status: 500 })
  }

  if (dryRun) {
    return NextResponse.json(
      {
        success: true,
        dry_run: true,
        read_only: true,
        paid_calls_made: 0,
        plan: {
          seeds,
          limit_per_seed: limit,
          paid_calls_planned: seeds.length,
          est_max_cost_usd: estimateMaxCostUsd(seeds.length, limit),
          location_code: locationCode,
          own_tracked_keywords: own.length,
        },
      },
      { status: 200 },
    )
  }

  const results = await runSeeds(seeds, locationCode, limit)
  const paidCalls = results.length
  const totalItems = results.reduce((sum, r) => sum + r.ideas.length, 0)
  const estCost = Math.round((paidCalls * EST_COST_PER_CALL_USD + totalItems * EST_COST_PER_ITEM_USD) * 10000) / 10000

  const { rows, excluded } = buildOpportunityRows(results, own, {
    brandRoot: domainRoot(client.domain ?? ''),
    brandAliases: client.brand_aliases,
    competitorDomains: client.competitor_domains ?? [],
  })
  const summary = summariseOpportunity(rows, excluded, results)

  if (totalItems === 0) {
    return NextResponse.json(
      { success: false, dry_run: false, read_only: true, paid_calls_made: paidCalls, est_cost_usd: estCost, status: 'no_data', summary },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      success: true,
      dry_run: false,
      read_only: true,
      paid_calls_made: paidCalls,
      est_cost_usd: estCost,
      estimate_note: 'cost is an estimate from public list prices, not a billing figure',
      location_code: locationCode,
      summary,
    },
    { status: 200 },
  )
}
