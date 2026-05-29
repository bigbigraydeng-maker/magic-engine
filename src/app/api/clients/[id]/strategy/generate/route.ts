/**
 * POST /api/clients/[id]/strategy/generate
 *
 * Generates a three-dimensional content strategy for a client by:
 * 1. Fetching client pages, weak AI queries, and keyword opportunities
 * 2. Analyzing them into raw opportunities
 * 3. Scoring each opportunity
 * 4. Inserting all items into content_strategy_items
 *
 * Phase 8.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  fetchClientPages,
  fetchWeakAIQueries,
  fetchKeywordOpportunities,
  analyzeOpportunities,
} from '@/lib/strategy/analyzer'
import { scoreOpportunity } from '@/lib/strategy/scorer'
import type { ModeBoostMap } from '@/lib/strategy/scorer'
import {
  fetchSeoBlogConfidenceByMode,
  getModeBoost,
} from '@/lib/case-library/outcome-confidence'
import type { StrategyItem, RawOpportunity } from '@/lib/strategy/types'

export const maxDuration = 60

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

export interface GenerateResponse {
  strategy_run_id: string
  items: StrategyItem[]
  count: number
  /** P14.C.3: candidates skipped because (client_id, proposed_title) already exists. */
  skipped_duplicates?: number
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const clientId = params.id

  try {
    // Step 1: Verify client exists
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Step 2: Fetch data in parallel
    const [pages, weakQueries, keywords] = await Promise.all([
      fetchClientPages(clientId),
      fetchWeakAIQueries(clientId),
      fetchKeywordOpportunities(clientId),
    ])

    // Step 3: Analyze opportunities
    const rawOpportunities: RawOpportunity[] = await analyzeOpportunities(
      clientId,
      pages,
      weakQueries,
      keywords
    )

    // Generate a unique run ID for this strategy generation
    const strategy_run_id = crypto.randomUUID()

    // Handle empty results
    if (rawOpportunities.length === 0) {
      return NextResponse.json(
        { strategy_run_id, items: [], count: 0 } satisfies GenerateResponse,
        { status: 200 }
      )
    }

    // P14.C.5: load flywheel feedback (per-client SEO blog confidence by mode)
    // so the scorer can boost modes that have proven to work for this client.
    // Failure-mode: empty map → boosts default to 0 → behavior identical to pre-P14.C.5.
    const seoModeConfidence = await fetchSeoBlogConfidenceByMode(supabaseAdmin, clientId)
    const modeBoosts: ModeBoostMap = {
      unified:  getModeBoost(seoModeConfidence.unified),
      geo_only: getModeBoost(seoModeConfidence.geo_only),
      seo_only: getModeBoost(seoModeConfidence.seo_only),
    }

    // Step 4: Score each opportunity
    const scoredItems = rawOpportunities.map((opp) => {
      const scored = scoreOpportunity(opp.scoring_context, modeBoosts)
      return {
        client_id: clientId,
        strategy_run_id,
        action_type: scored.action_type,
        content_mode: scored.content_mode,
        priority: scored.priority,
        priority_score: scored.priority_score,
        proposed_title: opp.proposed_title,
        rationale: opp.rationale,
        content_angle: opp.content_angle,
        source_page_id: opp.source_page_id,
        source_query_id: opp.source_query_id,
        source_keyword: opp.source_keyword,
        keyword_volume: opp.keyword_volume,
        keyword_kd: opp.keyword_kd,
        status: 'pending' as const,
        linked_blog_post_id: null,
      }
    })

    // Step 5: Sort by priority_score DESC
    scoredItems.sort((a, b) => b.priority_score - a.priority_score)

    // Step 6: Upsert into DB. P14.C.3: ignore rows whose (client_id, proposed_title)
    // already exists so re-running strategy does not pollute the kanban with
    // duplicate candidates. Existing rows keep their current status/strategy_run_id;
    // only genuinely new candidates are inserted.
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('content_strategy_items')
      .upsert(scoredItems, {
        onConflict:        'client_id,proposed_title',
        ignoreDuplicates:  true,
      })
      .select()

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message ?? 'Failed to insert strategy items' },
        { status: 500 }
      )
    }

    const items = (inserted ?? []) as StrategyItem[]

    return NextResponse.json(
      {
        strategy_run_id,
        items,
        count:                items.length,
        skipped_duplicates:   scoredItems.length - items.length,
      } satisfies GenerateResponse,
      { status: 200 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
