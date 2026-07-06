/**
 * POST /api/admin/prospecting/analyze
 *
 * Admin-only. Step 4 of the outbound pipeline: run the Zhangqian
 * prospect short-mode (four-pillar scorecard + owner name + email hook)
 * over `qualified` prospects, highest score first.
 *
 * Body: { limit?: number } — batch size, default 1, max 3. Each analysis
 * takes up to ~2 minutes (page fetch + GEO probe + social scrape + one
 * Strategy Engine call, all individually time-boxed; ~$0.10-0.15 per
 * prospect). The console drives multi-prospect runs as sequential
 * single-prospect requests.
 *
 * Concurrency: each prospect is claimed with an optimistic lock
 * (conditional update on updated_at) before any paid call, so two
 * concurrent runs never double-spend on the same prospect.
 *
 * Status transitions:
 *   qualified → analyzed          (synthesis succeeded)
 *   qualified → qualified (retry) (synthesis failed, attempts < 2 —
 *                                  transient outages must not consume
 *                                  the prospect)
 *   qualified → analyzed (error)  (second failure — parked with the
 *                                  error visible instead of looping)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { analyzeProspect, type ProspectAnalysis } from '@/lib/prospecting/analyze'
import type { ScoreSignal } from '@/lib/prospecting/score'

const DEFAULT_BATCH = 1
const MAX_BATCH = 3
const MAX_ATTEMPTS = 2

type StoredReport = (ProspectAnalysis & { attempts?: number }) | null

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  // Preflight: without the synthesis engine every analysis fails AFTER
  // paying for the probe + scrape stages. Refuse before spending.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI 分析引擎未配置（缺少环境变量）' }, { status: 400 })
  }

  const body  = await req.json().catch(() => null) as { limit?: number } | null
  const limit = Math.min(MAX_BATCH, Math.max(1, body?.limit ?? DEFAULT_BATCH))

  const { data: batch, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, business_name, industry, city, country, website_url, domain, facebook_url, instagram_url, rating, review_count, score_breakdown, ai_report, updated_at')
    .eq('status', 'qualified')
    .order('prospect_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!batch || batch.length === 0) {
    return NextResponse.json({ analyzed: 0, retrying: 0, skipped: 0, remaining: 0 })
  }

  let analyzed = 0
  let retrying = 0
  let skipped = 0

  for (const prospect of batch) {
    // Optimistic claim before any paid call: bump updated_at conditionally;
    // zero rows matched means a concurrent run already took this prospect.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('outbound_prospects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', prospect.id)
      .eq('status', 'qualified')
      .eq('updated_at', prospect.updated_at)
      .select('id')
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 })
    if (!claimed || claimed.length === 0) { skipped++; continue }

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

    const attempts = ((prospect.ai_report as StoredReport)?.attempts ?? 0) + 1
    const report = { ...analysis, attempts }
    // Transient failure keeps the prospect in the queue for one retry;
    // repeated failure parks it as analyzed-with-error so it never loops.
    const nextStatus = analysis.error && attempts < MAX_ATTEMPTS ? 'qualified' : 'analyzed'
    if (nextStatus === 'qualified') retrying++
    else analyzed++

    const { error: updateError } = await supabaseAdmin
      .from('outbound_prospects')
      .update({ ai_report: report, status: nextStatus, updated_at: new Date().toISOString() })
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

  return NextResponse.json({ analyzed, retrying, skipped, remaining: count ?? 0 })
}
