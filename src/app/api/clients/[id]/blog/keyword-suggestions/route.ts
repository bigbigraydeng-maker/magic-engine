import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { RankedKeyword, SeoGapAnalysis } from '@/lib/seo-gap/analyzer'
import { getActiveBrief } from '@/lib/content/brief-injector'
import {
  buildBusinessKeywordTerms,
  extractBriefSeedTerms,
  isBusinessRelevantKeyword,
} from '@/lib/seo-intelligence/keyword-relevance'

export interface KeywordSuggestion {
  keyword: string
  volume: number
  kd: number
  intent: string | null
  tier: 'A' | 'B'
}

/**
 * GET /api/clients/[id]/blog/keyword-suggestions
 *
 * Returns up to 15 keyword suggestions from the client's latest completed
 * SEO gap analysis (tier_b "blog content" keywords first, then tier_a).
 * Used by the blog page to replace manual keyword input with system suggestions.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const [{ data: client }, activeBrief] = await Promise.all([
      supabaseAdmin
        .from('clients')
        .select('domain, industry')
        .eq('id', clientId)
        .maybeSingle(),
      getActiveBrief(clientId).catch(() => null),
    ])
    const businessTerms = buildBusinessKeywordTerms({
      domain: (client?.domain as string | null) ?? null,
      industry: (client?.industry as string | null) ?? null,
      seedTerms: extractBriefSeedTerms(activeBrief as Record<string, unknown> | null),
    })

    const { data, error } = await supabaseAdmin
      .from('seo_analyses')
      .select('analysis_json')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !data?.analysis_json) {
      return NextResponse.json({ success: true, suggestions: [] })
    }

    const analysis = data.analysis_json as unknown as SeoGapAnalysis
    const tierB: KeywordSuggestion[] = (analysis.tier_b ?? [])
      .slice(0, 10)
      .map((kw: RankedKeyword) => ({
        keyword: kw.keyword,
        volume: kw.volume,
        kd: kw.kd,
        intent: kw.intent ?? null,
        tier: 'B' as const,
      }))

    const tierA: KeywordSuggestion[] = (analysis.tier_a ?? [])
      .slice(0, 5)
      .map((kw: RankedKeyword) => ({
        keyword: kw.keyword,
        volume: kw.volume,
        kd: kw.kd,
        intent: kw.intent ?? null,
        tier: 'A' as const,
      }))

    const suggestions: KeywordSuggestion[] = [...tierB, ...tierA]
      .filter((suggestion) => isBusinessRelevantKeyword(suggestion.keyword, businessTerms))
      .slice(0, 15)

    return NextResponse.json({ success: true, suggestions })
  } catch (err: unknown) {
    console.error('[keyword-suggestions GET]', err)
    return NextResponse.json({ success: false, error: 'Failed to retrieve suggestions' }, { status: 500 })
  }
}
