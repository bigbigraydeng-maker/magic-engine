import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getKeywordsForSite } from '@/lib/dataforseo/labs'
import { calculateOpportunityScore, recommendPageType } from '@/lib/scoring/opportunity-score'
import type { CompetitorKeywordsRequest, KeywordIntent } from '@/types/magic-engine'

export async function POST(req: NextRequest) {
  try {
    const body: CompetitorKeywordsRequest = await req.json()
    const { competitor_domains, client_id, limit = 50, min_volume = 100, db, production_package_id } = body

    if (!competitor_domains?.length || competitor_domains.length > 4) {
      return NextResponse.json(
        { success: false, error: 'competitor_domains must be 1–4', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }
    if (!client_id) {
      return NextResponse.json(
        { success: false, error: 'client_id required', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }

    const locationCode = db === 'nz' ? 2554 : 2036
    const allRaw = await Promise.all(
      competitor_domains.map(domain => getKeywordsForSite(domain, locationCode, limit))
    )

    const records: object[] = []
    allRaw.forEach((rawData, idx) => {
      const domain = competitor_domains[idx]
      rawData
        .filter(k => (k.search_volume ?? 0) >= min_volume)
        .forEach(item => {
          const volume = item.search_volume ?? 0
          const kd     = item.keyword_difficulty ?? 0
          const cpc    = item.cpc ?? 0
          records.push({
            client_id,
            keyword:               item.keyword,
            volume,
            kd,
            cpc,
            intent:                item.intent as KeywordIntent,
            trend:                 [],
            source:                'semrush_batch' as const,
            competitor_source:     domain,
            semrush_db:            db || 'au',
            opportunity_score:     calculateOpportunityScore({
              volume, kd, cpc,
              intent: item.intent as KeywordIntent,
            }),
            recommended_page_type: recommendPageType(item.keyword, item.intent as KeywordIntent, volume),
            status:                'new' as const,
          })
        })
    })

    const { data, error } = await supabaseAdmin
      .from('keywords')
      .upsert(records, { onConflict: 'client_id,keyword', ignoreDuplicates: false })
      .select()

    if (error) throw error

    const totalFetched = allRaw.reduce((sum, d) => sum + d.length, 0)
    const unitsConsumed = totalFetched * 10

    await supabaseAdmin.from('semrush_usage_logs').insert({
      client_id,
      endpoint: 'competitor-keywords',
      units_consumed: unitsConsumed,
      keywords_count: records.length,
    })

    // Persist snapshot (non-blocking; never fails the main response)
    const topKeywords = (data ?? []).slice(0, 50).map(k => ({
      keyword: (k as Record<string, unknown>).keyword,
      volume:  (k as Record<string, unknown>).volume,
      kd:      (k as Record<string, unknown>).kd,
    }))
    supabaseAdmin.from('competitor_snapshots').insert({
      client_id,
      production_package_id: production_package_id ?? null,
      competitor_domains,
      semrush_db: db || 'au',
      min_volume,
      keywords_count: records.length,
      units_consumed: unitsConsumed,
      top_keywords: topKeywords,
    }).then(({ error: snapErr }) => {
      if (snapErr) console.error('[competitor-keywords] snapshot insert failed:', snapErr)
    })

    return NextResponse.json({
      success: true,
      data: data || [],
      units_consumed: unitsConsumed,
      saved_count: data?.length || 0,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[competitor-keywords]', err)
    return NextResponse.json(
      { success: false, error: message, code: 'SEMRUSH_API_ERROR' },
      { status: 500 }
    )
  }
}
