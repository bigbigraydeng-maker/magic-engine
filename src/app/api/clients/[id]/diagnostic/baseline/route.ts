/**
 * GET /api/clients/[id]/diagnostic/baseline
 *
 * Returns industry baseline percentiles (P50/P75/P90) per dimension for the
 * client's industry. Used by the diagnostic page to surface "行业 p50=67 / 你=54"
 * alongside each ScoreGauge so FDE can interpret the number — fixes BUG-FMT-S14
 * "评分莫名其妙" by anchoring every score to an industry comparison.
 *
 * Security: requires paid-client access (same as latest/run endpoints).
 *
 * Reuses the existing huatuo baselines table the agent already consumes —
 * no new infra, no DataForSEO calls. Returns nulls for dimensions without
 * a baseline so the UI can render "无行业基准" rather than fabricating numbers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { fetchBenchmarks } from '@/lib/huatuo/benchmarks'
import { mapIndustryToCategory } from '@/lib/huatuo/industry-mapper'
import type { BenchmarkDimension } from '@/lib/huatuo/types'

interface BaselineDto {
  p50: number | null
  p75: number | null
  p90: number | null
  source: string | null
  sampleSize: number | null
}

const ALL: BenchmarkDimension[] = ['seo', 'social', 'reputation', 'ai_visibility']

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('industry, city')
      .eq('id', clientId)
      .single()

    const raw = client as { industry: string | null; city: string | null } | null
    const industryTags = raw?.industry ? raw.industry.split(/[,\s]+/).filter(Boolean) : []
    const industryCategory = mapIndustryToCategory(industryTags)

    if (!industryCategory) {
      const empty: Record<BenchmarkDimension, BaselineDto> = {
        seo:           { p50: null, p75: null, p90: null, source: null, sampleSize: null },
        social:        { p50: null, p75: null, p90: null, source: null, sampleSize: null },
        reputation:    { p50: null, p75: null, p90: null, source: null, sampleSize: null },
        ai_visibility: { p50: null, p75: null, p90: null, source: null, sampleSize: null },
      }
      return NextResponse.json({
        success: true,
        industryCategory: null,
        city: raw?.city ?? null,
        baselines: empty,
      })
    }

    const benchmarks = await fetchBenchmarks(supabaseAdmin, {
      industryCategory,
      city: raw?.city ?? null,
    })

    const baselines = ALL.reduce<Record<BenchmarkDimension, BaselineDto>>((acc, dim) => {
      const row = benchmarks[dim]
      acc[dim] = row
        ? {
            p50: row.score_p50 ?? null,
            p75: row.score_p75 ?? null,
            p90: row.score_p90 ?? null,
            source: row.source ?? null,
            sampleSize: row.sample_size ?? null,
          }
        : { p50: null, p75: null, p90: null, source: null, sampleSize: null }
      return acc
    }, {} as Record<BenchmarkDimension, BaselineDto>)

    return NextResponse.json({
      success: true,
      industryCategory,
      city: raw?.city ?? null,
      baselines,
    })
  } catch (err: unknown) {
    console.error('[diagnostic/baseline] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Failed to load industry baselines' },
      { status: 500 },
    )
  }
}
