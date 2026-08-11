import { requireDashboardClientAccess } from '@/lib/auth/client-access'
// Enrich Campaign Brief with DataForSEO keyword data + URL parsing
// Pulls question keywords + related keywords for the campaign topic
// Parses source URLs via Jina Reader

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getKeywordIdeas } from '@/lib/dataforseo/labs'
import type { CampaignKeywordSnapshot } from '@/types/magic-engine'

type RouteContext = { params: { id: string; campaignId: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const { id: clientId, campaignId } = params

  try {
    // 1. Load campaign
    const { data: campaign, error: loadErr } = await supabaseAdmin
      .from('campaign_briefs')
      .select('*')
      .eq('id', campaignId)
      .eq('client_id', clientId)
      .single()

    if (loadErr || !campaign) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const db: string = body.db ?? 'au'
    const warnings: string[] = []

    // 2. Load active Master Brief to get curated keyword seeds
    const { data: brief } = await supabaseAdmin
      .from('master_briefs')
      .select('keyword_seeds')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .maybeSingle()

    // Seed priority: Master Brief keyword_seeds (top 3) → campaign title fallback
    const briefSeeds: string[] = (brief?.keyword_seeds ?? []).slice(0, 3)
    const seeds: string[] = briefSeeds.length > 0 ? briefSeeds : [campaign.title]

    // 3. Parse source URLs with Jina (non-fatal)
    let parsed_content = campaign.parsed_content ?? ''
    const urlsToParse: string[] = (campaign.source_urls ?? []).filter(Boolean)

    if (urlsToParse.length > 0 && !parsed_content) {
      const texts: string[] = []
      for (const url of urlsToParse.slice(0, 3)) {
        try {
          const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
            headers: { Accept: 'text/plain' },
            signal: AbortSignal.timeout(15000),
          })
          if (jinaRes.ok) {
            const text = await jinaRes.text()
            texts.push(text.slice(0, 2000))
          }
        } catch {
          warnings.push(`Failed to parse URL: ${url}`)
        }
      }
      if (texts.length > 0) {
        parsed_content = texts.join('\n\n---\n\n')
      }
    }

    // 4. DataForSEO: run questions + related for each seed in parallel (non-fatal)
    const locationCode = db === 'nz' ? 2554 : 2036
    const semrush_keywords: CampaignKeywordSnapshot[] = []

    try {
      // Each seed fires 2 calls (questions + related), all in parallel
      const seedCalls = seeds.flatMap(seed => [
        getKeywordIdeas(seed, locationCode, 15, true),   // question-form keywords
        getKeywordIdeas(seed, locationCode, 15, false),  // related keywords
      ])
      const results = await Promise.allSettled(seedCalls)

      // Deduplicate by keyword string, keeping highest volume entry
      const byKeyword = new Map<string, CampaignKeywordSnapshot>()
      results.forEach((result, idx) => {
        if (result.status !== 'fulfilled') {
          warnings.push(`Keyword fetch failed for seed "${seeds[Math.floor(idx / 2)]}": ${result.reason}`)
          return
        }
        const isQuestion = idx % 2 === 0
        for (const k of result.value) {
          const existing = byKeyword.get(k.keyword)
          if (!existing || (k.search_volume ?? 0) > (existing.volume ?? 0)) {
            byKeyword.set(k.keyword, {
              keyword: k.keyword,
              volume:  k.search_volume ?? 0,
              kd:      k.keyword_difficulty ?? 0,
              intent:  k.intent,
              type:    isQuestion ? 'question' : 'related',
            })
          }
        }
      })

      // Sort by volume desc, keep top 40
      semrush_keywords.push(
        ...Array.from(byKeyword.values())
          .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
          .slice(0, 40)
      )
    } catch (err) {
      warnings.push(`Keyword enrichment skipped: ${String(err)}`)
    }

    // 4. Save enriched data back to campaign
    const { data: updated, error: saveErr } = await supabaseAdmin
      .from('campaign_briefs')
      .update({
        parsed_content:   parsed_content || campaign.parsed_content,
        semrush_keywords: semrush_keywords.length > 0 ? semrush_keywords : campaign.semrush_keywords,
        updated_at:       new Date().toISOString(),
      })
      .eq('id', campaignId)
      .select()
      .single()

    if (saveErr) throw saveErr

    return NextResponse.json({
      success: true,
      campaign: updated,
      keywords_found: semrush_keywords.length,
      seeds_used: seeds,
      urls_parsed: urlsToParse.length,
      warnings,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[campaign/enrich]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
