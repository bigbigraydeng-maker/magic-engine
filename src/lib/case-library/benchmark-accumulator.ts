/**
 * Benchmark Accumulator — P8.12.S2.4
 *
 * 行业基准自动累积：从 prescription_outcomes 聚合 P50/P75/P90，
 * 写回 industry_benchmarks。需最低样本阈值（MIN_SAMPLE_THRESHOLD）。
 *
 * 数据流：
 *   prescription_outcomes (actual_value, kpi_metric)
 *     ↓ JOIN prescription_cases (industry_category, business_size, market)
 *   GROUP BY (industry_category, business_size, market, kpi_metric)
 *     ↓ 过滤 REPRESENTATIVE_KPIS
 *   calcPercentiles → P50/P75/P90
 *     ↓ sample_size >= MIN_SAMPLE_THRESHOLD
 *   UPSERT industry_benchmarks
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Constants ─────────────────────────────────────────────────────────────────

/** 最少样本数，低于此阈值不写入基准（冷启动保护）。 */
export const MIN_SAMPLE_THRESHOLD = 5

/**
 * 每个 benchmark dimension 的代表性 KPI 指标。
 * P50/P75/P90 从该指标的 actual_value 中计算。
 * 当前只有 SEMrush 自动回填数据（authority_score 是 0–100 分，最适合作 dimension 分数）。
 */
export const REPRESENTATIVE_KPIS: Record<string, { dimension: string }> = {
  authority_score: { dimension: 'seo' },
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccumulatorResult {
  benchmarksUpdated: number
  groupsSkipped: number
  errors: string[]
}

interface GroupEntry {
  industry_category: string
  business_size: string
  market: string
  dimension: string
  values: number[]
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * 从数值数组计算 P50/P75/P90（线性插值，sort-safe）。
 * 返回 null 表示输入为空。
 */
export function calcPercentiles(
  values: number[],
): { p50: number; p75: number; p90: number } | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length

  const percentile = (p: number): number => {
    const idx = (p / 100) * (n - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
  }

  const round1 = (v: number) => Math.round(v * 10) / 10

  return {
    p50: round1(percentile(50)),
    p75: round1(percentile(75)),
    p90: round1(percentile(90)),
  }
}

/**
 * confidence 随样本量增长（最高 0.95），反映数据积累成熟度。
 * 5 样本 → 0.65；10 样本 → 0.95（封顶）。
 */
function calcConfidence(sampleSize: number): number {
  return Math.min(0.3 + sampleSize * 0.07, 0.95)
}

// ── Main accumulator ──────────────────────────────────────────────────────────

/**
 * 聚合 prescription_outcomes → 写回 industry_benchmarks。
 *
 * @param supabase  supabaseAdmin（service role）
 * @param minSamples  最低样本阈值（默认 MIN_SAMPLE_THRESHOLD）
 */
export async function accumulateBenchmarks(
  supabase: SupabaseClient,
  minSamples: number = MIN_SAMPLE_THRESHOLD,
): Promise<AccumulatorResult> {
  const result: AccumulatorResult = { benchmarksUpdated: 0, groupsSkipped: 0, errors: [] }

  // ── 1. Fetch outcomes with case context ──────────────────────────────────
  const { data: outcomes, error: outcomesError } = await supabase
    .from('prescription_outcomes')
    .select(`
      actual_value,
      kpi_metric,
      dimension,
      prescription_cases!inner(
        industry_category,
        business_size,
        market
      )
    `)
    .not('actual_value', 'is', null)

  if (outcomesError) {
    result.errors.push(`fetch outcomes: ${outcomesError.message}`)
    return result
  }

  if (!outcomes || outcomes.length === 0) {
    return result
  }

  // ── 2. Group by (industry_category, business_size, market, kpi_metric) ──
  const groups = new Map<string, GroupEntry>()

  for (const outcome of outcomes as Array<Record<string, unknown>>) {
    const actualValue = outcome['actual_value'] as number | null
    if (actualValue == null) continue

    const kpiMetric = outcome['kpi_metric'] as string
    const kpiDef = REPRESENTATIVE_KPIS[kpiMetric]
    if (!kpiDef) continue  // 非代表性指标，忽略

    const caseData = outcome['prescription_cases'] as Record<string, unknown> | null
    const industryCategory = caseData?.['industry_category'] as string | null
    if (!industryCategory) continue

    const businessSize = (caseData?.['business_size'] as string | null) ?? 'small'
    const market = (caseData?.['market'] as string | null) ?? 'AU_NZ'

    const key = `${industryCategory}||${businessSize}||${market}||${kpiMetric}`

    if (!groups.has(key)) {
      groups.set(key, {
        industry_category: industryCategory,
        business_size: businessSize,
        market,
        dimension: kpiDef.dimension,
        values: [],
      })
    }

    groups.get(key)!.values.push(actualValue)
  }

  // ── 3. For each group: validate → calc → upsert ──────────────────────────
  for (const [, group] of Array.from(groups.entries())) {
    if (group.values.length < minSamples) {
      result.groupsSkipped++
      continue
    }

    const percentiles = calcPercentiles(group.values)
    if (!percentiles) {
      result.groupsSkipped++
      continue
    }

    const payload = {
      score_p50:  percentiles.p50,
      score_p75:  percentiles.p75,
      score_p90:  percentiles.p90,
      sample_size: group.values.length,
      source:     'outcome_aggregation',
      confidence: calcConfidence(group.values.length),
    }

    // Check existence (no UNIQUE constraint assumed — safe read-then-write)
    const { data: existing, error: checkErr } = await supabase
      .from('industry_benchmarks')
      .select('id, source')
      .eq('industry_category', group.industry_category)
      .eq('business_size', group.business_size)
      .eq('market', group.market)
      .eq('dimension', group.dimension)
      .maybeSingle()

    if (checkErr) {
      result.errors.push(`check benchmark (${group.industry_category}/${group.dimension}): ${checkErr.message}`)
      continue
    }

    if (existing) {
      const { error: updateErr } = await supabase
        .from('industry_benchmarks')
        .update(payload)
        .eq('id', (existing as { id: string }).id)

      if (updateErr) {
        result.errors.push(`update benchmark (${group.industry_category}/${group.dimension}): ${updateErr.message}`)
      } else {
        result.benchmarksUpdated++
      }
    } else {
      const { error: insertErr } = await supabase
        .from('industry_benchmarks')
        .insert({
          industry_category: group.industry_category,
          business_size:     group.business_size,
          market:            group.market,
          dimension:         group.dimension,
          ...payload,
        })

      if (insertErr) {
        result.errors.push(`insert benchmark (${group.industry_category}/${group.dimension}): ${insertErr.message}`)
      } else {
        result.benchmarksUpdated++
      }
    }
  }

  return result
}
