import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { SeoCollector } from '@/lib/diagnostic/collectors/seo-collector'

// POST /api/baselines/domains/[id]/collect
// Runs SeoCollector for a single domain and writes the score back.
// Called by FDE via the UI "Refresh" button — one domain at a time.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // Fetch the domain row
  const { data: row, error: fetchError } = await supabaseAdmin
    .from('baseline_domains')
    .select('id, domain, keywords')
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
    const result = await collector.collect('baseline-placeholder', row.domain, row.keywords)
    score = result.score
  } catch (err: any) {
    return NextResponse.json({ error: `Collector failed: ${err.message}` }, { status: 500 })
  }

  if (score === null) {
    return NextResponse.json({ error: 'Collector returned null score (API timeout or no data)' }, { status: 500 })
  }

  // Write score back
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('baseline_domains')
    .update({ seo_score: score, last_collected_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ score, updated_at: updated.last_collected_at })
}
