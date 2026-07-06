/**
 * POST /api/admin/prospecting/analyze
 *
 * Admin-only. Step 4 of the outbound pipeline: run the Zhangqian
 * prospect short-mode (four-pillar scorecard + owner name + email hook)
 * over a batch of `qualified` prospects, highest score first.
 *
 * Body: { limit?: number } — batch size, default 3, max 5 (each analysis
 * takes ~30-60s: Site Analyzer fetch + GEO probe + social scrape + one
 * Strategy Engine call; ~$0.10-0.15 per prospect).
 *
 * Status transition: qualified → analyzed (always — a failed synthesis
 * stores ai_report.error instead of looping the same prospect forever).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { analyzeProspect } from '@/lib/prospecting/analyze'
import type { ScoreSignal } from '@/lib/prospecting/score'

const DEFAULT_BATCH = 3
const MAX_BATCH = 5

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const body  = await req.json().catch(() => null) as { limit?: number } | null
  const limit = Math.min(MAX_BATCH, Math.max(1, body?.limit ?? DEFAULT_BATCH))

  const { data: batch, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, business_name, industry, city, country, website_url, domain, facebook_url, instagram_url, rating, review_count, score_breakdown')
    .eq('status', 'qualified')
    .order('prospect_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!batch || batch.length === 0) {
    return NextResponse.json({ analyzed: 0, failed: 0, remaining: 0 })
  }

  let failed = 0

  for (const prospect of batch) {
    const analysis = await analyzeProspect({
      business_name: prospect.business_name,
      industry:      prospect.industry,
      city:          prospect.city,
      country:       prospect.country,
      website_url:   prospect.website_url,
      domain:        prospect.domain,
      facebook_url:  prospect.facebook_url,
      instagram_url: prospect.instagram_url,
      rating:        prospect.rating,
      review_count:  prospect.review_count,
      score_breakdown: (prospect.score_breakdown ?? null) as ScoreSignal[] | null,
    })
    if (analysis.error) failed++

    const { error: updateError } = await supabaseAdmin
      .from('outbound_prospects')
      .update({
        ai_report: analysis,
        status: 'analyzed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', prospect.id)
      .eq('status', 'qualified')

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message, analyzed_before_failure: prospect.id },
        { status: 500 },
      )
    }
  }

  const { count } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'qualified')

  return NextResponse.json({ analyzed: batch.length, failed, remaining: count ?? 0 })
}
