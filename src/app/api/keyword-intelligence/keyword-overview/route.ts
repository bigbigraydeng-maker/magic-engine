import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { bulkKeywordVolume } from '@/lib/dataforseo/labs'
import { calculateOpportunityScore, recommendPageType } from '@/lib/scoring/opportunity-score'
import type { KeywordOverviewRequest, KeywordIntent } from '@/types/magic-engine'

export async function POST(req: NextRequest) {
  try {
    const body: KeywordOverviewRequest = await req.json()
    const { keywords, client_id, db } = body

    if (!keywords?.length || keywords.length > 100) {
      return NextResponse.json(
        { success: false, error: 'keywords must be 1–100', code: 'INVALID_INPUT' },
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
    const rawData = await bulkKeywordVolume(keywords, locationCode)

    const mapped = rawData.map(item => ({
      keyword: item.keyword,
      volume:  item.search_volume ?? 0,
      kd:      item.keyword_difficulty ?? 0,
      cpc:     item.cpc ?? 0,
      intent:  item.intent,
      trend:   [] as unknown[],
    }))

    const records = mapped.map(item => ({
      client_id,
      keyword:               item.keyword,
      volume:                item.volume,
      kd:                    item.kd,
      cpc:                   item.cpc,
      intent:                item.intent as KeywordIntent,
      trend:                 item.trend,
      source:                'semrush_batch' as const,
      semrush_db:            db || 'au',
      opportunity_score:     calculateOpportunityScore({
        volume: item.volume, kd: item.kd, cpc: item.cpc,
        intent: item.intent as KeywordIntent,
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
      endpoint: 'keyword-overview',
      units_consumed: rawData.length * 10,
      keywords_count: rawData.length,
    })

    return NextResponse.json({
      success: true,
      data: data || [],
      units_consumed: rawData.length * 10,
      saved_count: data?.length || 0,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : (err as Record<string, unknown>)?.message as string ?? 'Unknown error'
    console.error('[keyword-overview]', err)
    return NextResponse.json(
      { success: false, error: message, code: 'SEMRUSH_API_ERROR' },
      { status: 500 }
    )
  }
}
