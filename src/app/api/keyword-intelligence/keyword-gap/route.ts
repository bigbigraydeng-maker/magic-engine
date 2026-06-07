import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getKeywordsGap } from '@/lib/dataforseo/labs'
import { calculateOpportunityScore, recommendPageType } from '@/lib/scoring/opportunity-score'
import type { KeywordGapRequest, KeywordIntent } from '@/types/magic-engine'

export async function POST(req: NextRequest) {
  try {
    const body: KeywordGapRequest = await req.json()
    const { client_domain, competitor_domains, client_id, limit = 100, min_volume = 100, max_kd = 60, db } = body

    if (!client_domain?.trim()) {
      return NextResponse.json(
        { success: false, error: 'client_domain required', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }
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
    const rawData = await getKeywordsGap(client_domain, competitor_domains, locationCode, limit)

    const mapped = rawData.map(item => ({
      keyword: item.keyword,
      volume:  item.search_volume ?? 0,
      kd:      item.keyword_difficulty ?? 0,
      cpc:     item.cpc ?? 0,
      intent:  item.intent,
      trend:   [] as unknown[],
    }))

    const filtered = mapped.filter(k => k.volume >= min_volume && k.kd <= max_kd)

    const records = filtered.map(item => ({
      client_id,
      keyword:               item.keyword,
      volume:                item.volume,
      kd:                    item.kd,
      cpc:                   item.cpc,
      intent:                item.intent as KeywordIntent,
      trend:                 item.trend,
      source:                'semrush_gap' as const,
      semrush_db:            db || 'au',
      opportunity_score:     calculateOpportunityScore({
        volume: item.volume, kd: item.kd, cpc: item.cpc,
        intent: item.intent as KeywordIntent,
        isGap: true,
      }),
      recommended_page_type: recommendPageType(item.keyword, item.intent as KeywordIntent, item.volume),
      status:                'new' as const,
    }))

    const { data, error } = await supabaseAdmin
      .from('keywords')
      .upsert(records, { onConflict: 'client_id,keyword', ignoreDuplicates: false })
      .select()

    if (error) throw error

    await supabaseAdmin.from('semrush_usage_logs').insert({
      client_id,
      endpoint: 'keyword-gap',
      units_consumed: rawData.length * 10,
      keywords_count: filtered.length,
    })

    return NextResponse.json({
      success: true,
      data: data || [],
      units_consumed: rawData.length * 10,
      saved_count: data?.length || 0,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[keyword-gap]', err)
    return NextResponse.json(
      { success: false, error: message, code: 'SEMRUSH_API_ERROR' },
      { status: 500 }
    )
  }
}
