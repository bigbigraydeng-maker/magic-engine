import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { SeoCollector } from '@/lib/diagnostic/collectors/seo-collector'

// POST /api/baselines/domains/[id]/collect
// Runs SeoCollector for a single domain and writes the score back.
// Called by FDE via the UI "Refresh" button — one domain at a time.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // Fetch the domain row (need industry/sub_industry for history insert)
  const { data: row, error: fetchError } = await supabaseAdmin
    .from('baseline_domains')
    .select('id, domain, keywords, industry, sub_industry')
    .eq('id', params.id)
    .single()

  if (fetchError || !row) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  }

  if (!row.keywords || row.keywords.length === 0) {
    return NextResponse.json({ error: 'No keywords configured for this domain — add keywords before collecting' }, { status: 422 })
  }

  // Run collector — clientId is a placeholder (score only depends on domain + keywords)
  const collector = new SeoCollector(60_000)
  let score: number | null = null
  try {
    // baseline_domains has no per-row market, so fall back to the deploy default.
    const result = await collector.collect('baseline-placeholder', row.domain, row.keywords, [], process.env.SEMRUSH_DB ?? 'au')
    score = result.score
  } catch (err: any) {
    return NextResponse.json({ error: `Collector failed: ${err.message}` }, { status: 500 })
  }

  if (score === null) {
    return NextResponse.json({ error: 'Collector returned null score (API timeout or no data)' }, { status: 500 })
  }

  const collectedAt = new Date().toISOString()

  // Write score back (latest snapshot on baseline_domains)
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('baseline_domains')
    .update({ seo_score: score, last_collected_at: collectedAt })
    .eq('id', params.id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // P30 S5.1: append to history (time-series, never updated)
  // History insert failure should NOT fail the request — log and continue.
  const { error: historyError } = await supabaseAdmin
    .from('baseline_domain_score_history')
    .insert({
      baseline_domain_id: row.id,
      industry: row.industry,
      sub_industry: row.sub_industry,
      domain: row.domain,
      dimension: 'seo',
      score,
      collected_at: collectedAt,
    })

  if (historyError) console.error('[baselines/collect] history insert failed', historyError)

  return NextResponse.json({ score, updated_at: updated.last_collected_at })
}
