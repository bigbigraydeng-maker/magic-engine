/**
 * GET /api/baselines/ai-snapshots — query snapshot history (admin only)
 *
 * Query params:
 *   ?question_id=...     — limit to one question
 *   ?industry=...        — limit to one industry_code
 *   ?country=...         — 'nz' | 'au'
 *   ?city=...            — 'auckland' | 'sydney' | etc.
 *   ?language=...        — 'en' | 'zh'
 *   ?platform=...        — limit to one platform
 *   ?days=30             — last N days (default 30, max 365). Replaces the
 *                          previous ?weeks param when used. If neither is
 *                          provided, defaults to 30 days.
 *   ?weeks=N             — legacy alias for days*7 (kept for backward compat)
 *   ?latest_only=true    — return only the most recent snapshot per
 *                          (question, platform). Time axis is now
 *                          collected_date (daily), not week_of (weekly).
 *
 * Filtering strategy:
 *   - All question-side filters (industry/country/city/language) are pushed
 *     down to the database via referenced-table syntax on the join, so they
 *     also cap the query (server-side), not just trim after the fact.
 *   - Snapshot-side filters (question_id/platform) are normal column filters.
 *
 * Granularity note:
 *   Migration 20260622000003 introduced `collected_date` as the primary
 *   time axis (one snapshot per question×platform×day). `week_of` is kept
 *   for backward-compatible weekly rollups but is no longer the unique key.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

export async function GET(req: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const { searchParams } = new URL(req.url)
  const questionId  = searchParams.get('question_id')
  const industry    = searchParams.get('industry')
  const country     = searchParams.get('country')
  const city        = searchParams.get('city')
  const language    = searchParams.get('language')
  const platform    = searchParams.get('platform')

  // Time window: prefer ?days, fall back to ?weeks*7, default 30 days.
  const daysParam  = searchParams.get('days')
  const weeksParam = searchParams.get('weeks')
  let days: number
  if (daysParam) {
    days = Math.max(1, Math.min(365, parseInt(daysParam, 10) || 30))
  } else if (weeksParam) {
    days = Math.max(1, Math.min(365, (parseInt(weeksParam, 10) || 12) * 7))
  } else {
    days = 30
  }

  const latestOnly  = searchParams.get('latest_only') === 'true'

  // Compute cutoff date (days back from today, UTC)
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  const cutoffISO = cutoff.toISOString().slice(0, 10)

  // Use !inner so question-side filters become JOIN constraints
  // (i.e. snapshots without a matching question are excluded — and the
  // referenced-table .eq() below actually filters at the DB level).
  let query = supabaseAdmin
    .from('industry_ai_visibility_snapshots')
    .select(`
      id, question_id, platform, collected_at, collected_date, week_of,
      brands_mentioned, top3_brands,
      ai_answer_text, ai_citation_sources,
      serp_organic_top10, serp_local_pack, serp_paid_domains, serp_people_also_ask,
      model_version, tokens_used, cost_usd, parse_confidence,
      error_code, error_message,
      industry_ai_visibility_questions:question_id!inner (
        industry_code, intent_layer, country, city, language, question_text
      )
    `)
    .gte('collected_date', cutoffISO)
    .order('collected_date', { ascending: false })
    .limit(1000)

  // Snapshot-side filters
  if (questionId) query = query.eq('question_id', questionId)
  if (platform)   query = query.eq('platform', platform)

  // Question-side filters via referenced-table syntax — pushes down to DB
  if (industry) query = query.eq('industry_ai_visibility_questions.industry_code', industry)
  if (country)  query = query.eq('industry_ai_visibility_questions.country',       country)
  if (city)     query = query.eq('industry_ai_visibility_questions.city',          city)
  if (language) query = query.eq('industry_ai_visibility_questions.language',      language)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows = data ?? []

  // Latest-only: keep first occurrence per (question_id, platform). Rows are
  // already ordered by collected_date DESC, so first = newest day.
  if (latestOnly) {
    const seen = new Set<string>()
    const filtered: typeof rows = []
    for (const r of rows) {
      const key = `${(r as { question_id: string }).question_id}::${(r as { platform: string }).platform}`
      if (!seen.has(key)) {
        seen.add(key)
        filtered.push(r)
      }
    }
    rows = filtered
  }

  return NextResponse.json({ snapshots: rows })
}
