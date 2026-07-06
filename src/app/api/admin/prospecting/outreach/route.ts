/**
 * POST /api/admin/prospecting/outreach
 *
 * Admin-only. Step 5 of the outbound pipeline: draft outreach emails for
 * a batch of `analyzed` prospects (those whose analysis succeeded).
 *
 * Body: { limit?: number } — default 5, max 10. One short Strategy Engine
 * call per prospect (~$0.02, a few seconds each).
 *
 * Status transition: analyzed → outreach_ready. Prospects whose analysis
 * ended in error are skipped (no evidence to write from) — archive or
 * re-analyze them from the console instead.
 * Generation failure keeps the prospect in `analyzed` for a simple retry.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { generateOutreachEmail } from '@/lib/prospecting/outreach'
import type { ProspectAnalysis } from '@/lib/prospecting/analyze'

const DEFAULT_BATCH = 5
const MAX_BATCH = 10

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI 引擎未配置（缺少环境变量）' }, { status: 400 })
  }

  const body  = await req.json().catch(() => null) as { limit?: number } | null
  const limit = Math.min(MAX_BATCH, Math.max(1, body?.limit ?? DEFAULT_BATCH))

  // Error-parked analyses are excluded — otherwise a handful of high-score
  // error rows would occupy every batch forever while healthy prospects
  // below them never get drafted.
  const { data: batch, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, business_name, industry, city, country, domain, rating, review_count, ai_report, updated_at')
    .eq('status', 'analyzed')
    .is('ai_report->error', null)
    .order('prospect_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let drafted = 0
  let skipped = 0
  let failed = 0

  for (const prospect of batch ?? []) {
    const report = prospect.ai_report as ProspectAnalysis | null
    if (!report || report.error) { skipped++; continue }

    // Optimistic claim (same pattern as /analyze): concurrent runs must not
    // draft the same prospect twice.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('outbound_prospects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', prospect.id)
      .eq('status', 'analyzed')
      .eq('updated_at', prospect.updated_at)
      .select('id')
    if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 })
    if (!claimed || claimed.length === 0) { skipped++; continue }

    try {
      const email = await generateOutreachEmail({
        business_name: prospect.business_name,
        industry:      prospect.industry,
        city:          prospect.city,
        country:       prospect.country,
        domain:        prospect.domain,
        rating:        prospect.rating,
        review_count:  prospect.review_count,
        ai_report:     report,
      })

      const { error: updateError } = await supabaseAdmin
        .from('outbound_prospects')
        .update({ outreach_email: email, status: 'outreach_ready', updated_at: new Date().toISOString() })
        .eq('id', prospect.id)
        .eq('status', 'analyzed')
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
      drafted++
    } catch (err) {
      // Stays `analyzed`; next run retries. Neutral log only.
      console.error('[prospecting/outreach] generation failed:', err instanceof Error ? err.message : err)
      failed++
    }
  }

  const { count } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'analyzed')
    .is('ai_report->error', null)

  return NextResponse.json({ drafted, skipped, failed, remaining: count ?? 0 })
}
