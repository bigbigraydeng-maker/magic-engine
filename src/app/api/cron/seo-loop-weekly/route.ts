import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import {
  snapshotRankedKeywordsForClient,
  locationCodeForDb,
  type KeywordSnapshotClient,
} from '@/lib/seo-intelligence/keyword-snapshots'
import { getPositionChangesForClient } from '@/lib/seo-intelligence/position-changes'
import {
  buildBusinessKeywordTerms,
  extractBriefSeedTerms,
  extractExcludedTopics,
  isBusinessRelevantKeyword,
} from '@/lib/seo-intelligence/keyword-relevance'
import {
  competitorBrandTokens,
  isCompetitorBrandKeyword,
} from '@/lib/seo-loop/competitor-brands'
import {
  buildHeadToHead,
  buildOpportunityGap,
  buildStrikingDistance,
  type RankedKeyword,
} from '@/lib/seo-loop/comparisons'
import {
  selectTopicCandidates,
  type AiVisibilityGap,
} from '@/lib/seo-loop/topic-candidates'
import {
  snapshotCompetitorsForClient,
  type CompetitorSnapshotClient,
} from '@/lib/seo-loop/competitor-snapshots'

/**
 * GET /api/cron/seo-loop-weekly
 *
 * The weekly SEO loop, in four stages:
 *   1. collect  — our ranked keywords -> keyword_snapshots
 *                 competitor ranked keywords -> competitor_keyword_snapshots
 *   2. compare  — week-over-week movement, head-to-head, opportunity gap
 *   3. select   — 3 topic candidates per client -> seo_topic_candidates
 *   4. publish  — NOT DONE HERE. Candidates land as status='candidate' and
 *                 wait for a human. This cron never drafts and never
 *                 publishes.
 *
 * Auth: Bearer ${CRON_SECRET}
 *
 * REPORTING SCOPE: this job records what we rank for and how that moved. It
 * deliberately produces no traffic/lead/revenue attribution — see the header
 * of src/lib/seo-loop/comparisons.ts.
 */

export const maxDuration = 900

interface ClientRow {
  id: string
  name: string | null
  domain: string | null
  semrush_db: string | null
  competitor_domains: string[] | null
}

interface ClientOutcome {
  client_id: string
  client_name: string | null
  domain: string
  own_keywords: number
  own_snapshots_written: number
  competitor_snapshots_written: number
  competitors_succeeded: number
  competitors_attempted: number
  head_to_head: number
  gap_keywords: number
  striking_distance: number
  candidates: number
  errors: string[]
}

async function loadAiVisibilityGaps(clientId: string): Promise<AiVisibilityGap[]> {
  const { data, error } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('client_brand_rank, query:ai_visibility_queries!inner(question)')
    .eq('client_id', clientId)
    .or('client_brand_rank.is.null,client_brand_rank.gt.3')
    .order('ran_at', { ascending: false })
    .limit(50)

  if (error || !data) return []

  const worst = new Map<string, AiVisibilityGap>()
  for (const row of data as unknown as Array<{
    client_brand_rank: number | null
    query: { question?: string } | Array<{ question?: string }> | null
  }>) {
    const query = Array.isArray(row.query) ? row.query[0] : row.query
    const question = query?.question?.trim()
    if (!question) continue
    const existing = worst.get(question)
    // Not mentioned at all (null) is worse than mentioned-but-low.
    if (!existing || (existing.brand_rank != null && row.client_brand_rank == null)) {
      worst.set(question, { question, brand_rank: row.client_brand_rank })
    }
  }
  return Array.from(worst.values())
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('seo-loop-weekly')

  const { data: clientRows, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain, semrush_db, competitor_domains')
    .not('domain', 'is', null)

  if (clientErr) {
    await cronRun.finish({ failed: 1, error: clientErr.message })
    return NextResponse.json(
      { error: `Failed to load clients: ${clientErr.message}` },
      { status: 500 },
    )
  }

  const eligible = ((clientRows ?? []) as ClientRow[])
    .filter(c => typeof c.domain === 'string' && c.domain.trim().length > 0)

  // Zero-object guard: a run that processed nothing is NOT a success. Reporting
  // success here is exactly how keyword collection stayed dead for 53 days
  // without anyone noticing.
  if (eligible.length === 0) {
    const message = 'No clients with a domain — collected nothing'
    await cronRun.finish({ processed: 0, completed: 0, failed: 1, error: message })
    return NextResponse.json(
      { success: false, error: message, clients_processed: 0 },
      { status: 500 },
    )
  }

  const outcomes: ClientOutcome[] = []

  for (const client of eligible) {
    const domain = client.domain as string
    const locationCode = locationCodeForDb(client.semrush_db)
    const outcome: ClientOutcome = {
      client_id: client.id,
      client_name: client.name,
      domain,
      own_keywords: 0,
      own_snapshots_written: 0,
      competitor_snapshots_written: 0,
      competitors_succeeded: 0,
      competitors_attempted: 0,
      head_to_head: 0,
      gap_keywords: 0,
      striking_distance: 0,
      candidates: 0,
      errors: [],
    }

    // --- Stage 1a: our own ranked keywords -------------------------------
    let ownKeywords: RankedKeyword[] = []
    try {
      const snapshot = await snapshotRankedKeywordsForClient({
        id: client.id, domain, semrush_db: client.semrush_db,
      } as KeywordSnapshotClient)
      outcome.own_keywords = snapshot.keywords_seen
      outcome.own_snapshots_written = snapshot.snapshots_written
    } catch (err) {
      outcome.errors.push(`own snapshot: ${err instanceof Error ? err.message : 'unknown'}`)
    }

    // Re-read what we just stored so comparisons use one consistent source.
    const { data: ownRows } = await supabaseAdmin
      .from('keyword_snapshots')
      .select('keyword, position, search_volume, keyword_difficulty, intent')
      .eq('client_id', client.id)
      .eq('location_code', locationCode)
      .eq('snapshot_date', new Date().toISOString().slice(0, 10))
    ownKeywords = (ownRows ?? []) as RankedKeyword[]

    // --- Stage 1b: competitor ranked keywords ----------------------------
    const competitorResult = await snapshotCompetitorsForClient(
      client as CompetitorSnapshotClient, locationCode,
    )
    outcome.competitor_snapshots_written = competitorResult.snapshots_written
    outcome.competitors_succeeded = competitorResult.competitors_succeeded
    outcome.competitors_attempted = competitorResult.competitors_attempted
    for (const e of competitorResult.errors) outcome.errors.push(`${e.domain}: ${e.message}`)

    // --- Stage 2: comparisons --------------------------------------------
    // Week-over-week movement reuses the existing P12.I.9 implementation.
    try {
      await getPositionChangesForClient(client.id)
    } catch (err) {
      outcome.errors.push(`position changes: ${err instanceof Error ? err.message : 'unknown'}`)
    }

    const { data: brief } = await supabaseAdmin
      .from('master_briefs')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle()

    const businessTerms = buildBusinessKeywordTerms({
      domain,
      seedTerms: extractBriefSeedTerms(brief as Record<string, unknown> | null),
    })
    const excludedTopics = extractExcludedTopics(brief as Record<string, unknown> | null)
    const brandTokens = competitorBrandTokens(client.competitor_domains ?? [])

    const headToHead = buildHeadToHead(ownKeywords, competitorResult.rankings)
    const gap = buildOpportunityGap(ownKeywords, competitorResult.rankings, {
      // Both gates are required: relevance alone lets a competitor's own brand
      // name through (it is maximally "relevant"), and the brand gate alone
      // lets off-business categories through.
      isEligible: keyword =>
        isBusinessRelevantKeyword(keyword, businessTerms, excludedTopics) &&
        !isCompetitorBrandKeyword(keyword, brandTokens),
    })
    const striking = buildStrikingDistance(ownKeywords)

    outcome.head_to_head = headToHead.length
    outcome.gap_keywords = gap.length
    outcome.striking_distance = striking.length

    // --- Stage 3: topic candidates (candidates only — never auto-written) --
    const aiGaps = await loadAiVisibilityGaps(client.id)
    const candidates = selectTopicCandidates({ gap, striking, aiGaps }, 3)

    if (candidates.length > 0) {
      const weekOf = new Date().toISOString().slice(0, 10)
      const { error: candidateErr } = await supabaseAdmin
        .from('seo_topic_candidates')
        .upsert(
          candidates.map(c => ({
            client_id: client.id,
            week_of: weekOf,
            keyword: c.keyword,
            source: c.source,
            priority: c.priority,
            my_position: c.my_position,
            search_volume: c.search_volume,
            keyword_difficulty: c.keyword_difficulty,
            competitors_ranking: c.competitors_ranking,
            reason: c.reason,
            status: 'candidate',
          })),
          { onConflict: 'client_id,week_of,keyword' },
        )
      if (candidateErr) outcome.errors.push(`candidates: ${candidateErr.message}`)
      else outcome.candidates = candidates.length
    }

    outcomes.push(outcome)
  }

  const collectedAnything = outcomes.some(
    o => o.own_snapshots_written > 0 || o.competitor_snapshots_written > 0,
  )
  const failedCount = outcomes.filter(o => o.errors.length > 0).length

  // Second zero-object guard: we had clients but stored nothing. Almost always
  // a DataForSEO credential/balance problem, and it must surface as a failure.
  if (!collectedAnything) {
    const message = `Processed ${outcomes.length} clients but wrote 0 snapshots`
    await cronRun.finish({
      processed: outcomes.length, completed: 0, failed: outcomes.length, error: message,
    })
    return NextResponse.json(
      { success: false, error: message, clients_processed: outcomes.length, results: outcomes },
      { status: 500 },
    )
  }

  await cronRun.finish({
    processed: outcomes.length,
    completed: outcomes.length - failedCount,
    failed: failedCount,
    summary: {
      own_snapshots: outcomes.reduce((s, o) => s + o.own_snapshots_written, 0),
      competitor_snapshots: outcomes.reduce((s, o) => s + o.competitor_snapshots_written, 0),
      candidates: outcomes.reduce((s, o) => s + o.candidates, 0),
    },
  })

  return NextResponse.json({
    success: true,
    clients_processed: outcomes.length,
    own_snapshots: outcomes.reduce((s, o) => s + o.own_snapshots_written, 0),
    competitor_snapshots: outcomes.reduce((s, o) => s + o.competitor_snapshots_written, 0),
    candidates: outcomes.reduce((s, o) => s + o.candidates, 0),
    failed: failedCount,
    results: outcomes,
  })
}
