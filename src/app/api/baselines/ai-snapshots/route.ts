/**
 * GET /api/baselines/ai-snapshots — query snapshot history (admin only)
 *
 * Query params:
 *   ?question_id=...     — limit to one question
 *   ?industry=...        — limit to one industry
 *   ?platform=...        — limit to one platform
 *   ?weeks=12            — last N weeks (default 12)
 *   ?latest_only=true    — return only latest snapshot per (question, platform)
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
  const platform    = searchParams.get('platform')
  const weeksParam  = searchParams.get('weeks')
  const weeks       = weeksParam ? Math.max(1, Math.min(52, parseInt(weeksParam, 10) || 12)) : 12
  const latestOnly  = searchParams.get('latest_only') === 'true'

  // Compute cutoff date (weeks back from today)
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7)
  const cutoffISO = cutoff.toISOString().slice(0, 10)

  let query = supabaseAdmin
    .from('industry_ai_visibility_snapshots')
    .select(`
      id, question_id, platform, collected_at, week_of,
      brands_mentioned, top3_brands,
      ai_answer_text, ai_citation_sources,
      serp_organic_top10, serp_local_pack, serp_paid_domains, serp_people_also_ask,
      model_version, tokens_used, cost_usd, parse_confidence,
      error_code, error_message,
      industry_ai_visibility_questions:question_id ( industry_code, intent_layer, country, city, language, question_text )
    `)
    .gte('week_of', cutoffISO)
    .order('week_of', { ascending: false })
    .limit(500)

  if (questionId) query = query.eq('question_id', questionId)
  if (platform)   query = query.eq('platform', platform)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows = data ?? []

  // Industry filter is a join filter — apply in JS since join isn't filterable on supabase-js
  if (industry) {
    rows = rows.filter(r => {
      const q = (r as { industry_ai_visibility_questions?: { industry_code?: string } | null }).industry_ai_visibility_questions
      return q?.industry_code === industry
    })
  }

  // Latest-only: keep first occurrence per (question_id, platform) — rows are
  // already ordered by week_of DESC, so first = newest.
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
