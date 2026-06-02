/**
 * GET /api/cron/baseline-domains-monthly
 *
 * Phase 30 S5.2 — 月度自动重跑 baseline_domains 的 SeoCollector
 *
 * 流程：
 *   1. 读取所有 baseline_domains（含 keywords）
 *   2. 串行跑 SeoCollector（间隔 2s 避免限速）
 *   3. 写回 baseline_domains.seo_score / last_collected_at
 *   4. 同步插入 baseline_domain_score_history（时序快照）
 *   5. 返回汇总报告
 *
 * Auth: Bearer ${CRON_SECRET}
 * 建议调度：每月 1 号 03:00 UTC
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { SeoCollector } from '@/lib/diagnostic/collectors/seo-collector'

export const maxDuration = 300

interface DomainRow {
  id: string
  industry: string
  sub_industry: string
  domain: string
  keywords: string[]
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rows, error } = await supabaseAdmin
    .from('baseline_domains')
    .select('id, industry, sub_industry, domain, keywords')
    .order('sub_industry')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const domains = (rows ?? []) as DomainRow[]
  if (domains.length === 0) {
    return NextResponse.json({ success: true, message: 'No baseline domains configured', processed: 0 })
  }

  const collector = new SeoCollector(60_000)
  const results: Array<{ domain: string; sub_industry: string; score: number | null; error?: string }> = []
  let succeeded = 0
  let failed = 0

  for (const row of domains) {
    if (!row.keywords || row.keywords.length === 0) {
      results.push({ domain: row.domain, sub_industry: row.sub_industry, score: null, error: 'no_keywords' })
      failed += 1
      continue
    }

    try {
      const result = await collector.collect('baseline-cron', row.domain, row.keywords)
      const score = result.score

      if (score === null) {
        results.push({ domain: row.domain, sub_industry: row.sub_industry, score: null, error: 'collector_null' })
        failed += 1
      } else {
        const collectedAt = new Date().toISOString()

        // Update latest snapshot
        await supabaseAdmin
          .from('baseline_domains')
          .update({ seo_score: score, last_collected_at: collectedAt })
          .eq('id', row.id)

        // Append to time-series history
        await supabaseAdmin
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

        results.push({ domain: row.domain, sub_industry: row.sub_industry, score })
        succeeded += 1
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      results.push({ domain: row.domain, sub_industry: row.sub_industry, score: null, error: msg })
      failed += 1
    }

    // Polite delay between calls (DataForSEO rate limit safety)
    await new Promise(r => setTimeout(r, 2000))
  }

  return NextResponse.json({
    success: true,
    processed: domains.length,
    succeeded,
    failed,
    results,
  })
}
