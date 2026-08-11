/**
 * Benchmark Accumulator — ME 自有客户实测结果 → 行业增长基准
 *
 * 沉淀的是「增长率」，不是「水平分」。原因（务必先读懂再改）：
 *
 *   industry_benchmarks 里其实并存两类事实：
 *     LEVEL   score_p50/p75/p90 — 0–100 的维度健康分（DB CHECK 0..100）。
 *             来源：外部研究报告 + baseline_domains SEO cron。
 *     GROWTH  realistic_3mo_growth_pct / realistic_6mo_growth_pct — 指标在
 *             N 天里实际能动多少 %。目前 40 行全是 NULL。
 *
 *   flywheel_outcomes 记录的是 baseline → after_value 的位移，after_value 是
 *   原始量级（gsc impressions 几千、avg_position 10–40），**不是 0–100 分**。
 *   把它写进 score_p50 要么被 CHECK 拒绝，要么污染华佗的处方锚点。
 *   真正对得上的字段是 delta_pct → GROWTH。
 *
 * 数据流：
 *   flywheel_outcomes (delta_pct, metric_key, window_days)
 *     ↓ JOIN clients (industry → mapIndustryToCategory)
 *     ↓ 只取 REPRESENTATIVE_METRICS（每维度一个业务级指标）
 *     ↓ 按 direction 归一化符号（avg_position 越低越好）
 *   GROUP BY (industry_category, dimension)
 *     ↓ sample_size >= MIN_SAMPLE_THRESHOLD
 *   UPDATE industry_benchmarks 的 GROWTH 字段（绝不碰 LEVEL 字段）
 *
 * 与外部基准共存策略：字段级隔离。本模块只写 realistic_3mo_growth_pct 与
 * growth_* provenance 列，从不写 score_p50/p75/p90 / source / confidence /
 * sample_size —— 那些属于外部研究数据。因此外部来源的 40 行不可能被无声覆盖。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { mapIndustryToCategory } from '@/lib/huatuo/industry-mapper'
import type { BenchmarkDimension } from '@/lib/huatuo/types'
import { fetchAll } from '@/lib/supabase-paginate'
import { keepOneMeasurementPerAction } from '@/lib/flywheel/attribution/outcome-identity'

// ── Constants ─────────────────────────────────────────────────────────────────

/** 最少样本数，低于此阈值不写入基准（冷启动保护）。 */
export const MIN_SAMPLE_THRESHOLD = 3

/** 样本数低于此值的基准视为「小样本」，UI / prompt 必须标注。 */
export const LOW_SAMPLE_CEILING = 5

/** 只聚合最近 N 天内计算出的 outcome，避免陈年数据永久沉淀。 */
export const LOOKBACK_DAYS = 180

/**
 * 写入目标行的固定坐标。
 * 华佗 fetchBenchmarks 默认按 business_size='small' + market='AU_NZ' 查，
 * 现有 40 行也全部落在这个桶里；写别的桶等于写进黑洞。
 * 地域细分（AU / NZ 拆开）留给后续 PR。
 */
export const TARGET_BUSINESS_SIZE = 'small'
export const TARGET_MARKET = 'AU_NZ'

export type MetricDirection = 'higher_is_better' | 'lower_is_better'

/**
 * 每个 benchmark 维度选**一个**有业务含义的代表指标。
 *
 * 刻意不收的：
 *   - seo.gsc.impressions  → 曝光是虚荣指标，不代表生意结果
 *   - seo.gsc.avg_position → 中间过程指标，且与 clicks 高度相关会重复计权
 *   - social.posts.published_count → 是「我们发了几条」的动作量，不是效果
 *
 * 未列入的 metric_key 一律跳过（fail closed），绝不靠前缀猜方向。
 */
export const REPRESENTATIVE_METRICS: Record<
  string,
  { dimension: BenchmarkDimension; direction: MetricDirection }
> = {
  'seo.gsc.clicks':         { dimension: 'seo',           direction: 'higher_is_better' },
  'geo.query.mention_rate': { dimension: 'ai_visibility', direction: 'higher_is_better' },
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccumulatorResult {
  benchmarksUpdated: number
  groupsSkipped: number
  /** 出现在 outcomes 里但 clients.industry 映射不到 benchmark 行业代码的客户数 */
  clientsUnmapped: number
  errors: string[]
}

interface GroupEntry {
  industry_category: string
  dimension: BenchmarkDimension
  /** 已按 direction 归一化过的 delta_pct（正 = 变好） */
  deltas: number[]
  windowDays: number[]
  clientIds: Set<string>
}

interface OutcomeRow {
  action_id: string
  client_id: string
  metric_key: string
  delta_pct: number | null
  window_days: number | null
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
 * 把原始 delta_pct 转成「正数 = 变好」。
 * avg_position 这类 lower-is-better 指标必须翻符号，否则排名从 40 升到 30
 * 会被记成 -25%「负增长」。
 *
 * ⚠️ 不要改用 flywheel_outcomes.verdict 来判方向：computeVerdict() 只比对
 * expected_delta 的符号，对指标本身的好坏方向一无所知（Oztop avg_position
 * 实际改善 26% 却被标成 'reversed' 就是这个原因）。
 */
export function normaliseDeltaPct(deltaPct: number, direction: MetricDirection): number {
  return direction === 'lower_is_better' ? -deltaPct : deltaPct
}

/**
 * GROWTH 数据的置信度。
 *
 * 关键点：样本多 ≠ 可信。29 条 outcome 如果全来自同一个客户，那不是行业基准，
 * 只是这个客户自己的历史。所以客户数是一个**乘性惩罚**，不是加分项。
 */
export function calcGrowthConfidence(sampleSize: number, clientCount: number): number {
  const base = Math.min(0.3 + sampleSize * 0.05, 0.9)
  const clientFactor = clientCount >= 3 ? 1 : clientCount === 2 ? 0.7 : 0.4
  return Math.round(base * clientFactor * 100) / 100
}

/** 样本或客户数不足 → 这条基准只能当方向性参考。 */
export function isLowConfidenceSample(sampleSize: number, clientCount: number): boolean {
  return sampleSize < LOW_SAMPLE_CEILING || clientCount < 3
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** 生成 notes 里那句人话，说清这个数字有多硬。 */
export function buildGrowthNotes(
  sampleSize: number,
  clientCount: number,
  windowDays: number,
  medianPct: number,
): string {
  const head =
    `ME observed: median ${medianPct.toFixed(1)}% over ~${windowDays}d ` +
    `(n=${sampleSize} outcomes, ${clientCount} client${clientCount === 1 ? '' : 's'}).`

  if (clientCount < 3) {
    return `${head} LOW CONFIDENCE — fewer than 3 clients, this is client history rather than an industry benchmark. Directional only.`
  }
  if (sampleSize < LOW_SAMPLE_CEILING) {
    return `${head} LOW CONFIDENCE — small sample. Directional only.`
  }
  return head
}

/** PostgREST 在列不存在时回 PGRST204；把它翻译成给 PM 看的人话。 */
function isMissingColumnError(message: string): boolean {
  return /PGRST204/i.test(message) || /column .* does not exist/i.test(message)
}

// ── Main accumulator ──────────────────────────────────────────────────────────

/**
 * 分页读全指定时间之后的 outcomes。
 *
 * PostgREST 单次最多 1000 行且不报错。截断在这里比少几行更糟 —— 按动作折叠是在
 * 读到的行里挑代表，如果恰好把带 expected_metric 的那行截掉了，折叠会挑另一行当
 * 这个动作的结论，于是不是「少算」而是「算错」。一个动作本来就出三行，双窗口
 * 再翻倍，上限来得比行数看上去快得多。（Codex P2, round 28 on PR #862）
 */
async function loadOutcomesSince(
  supabase: SupabaseClient,
  since: string,
): Promise<OutcomeRow[]> {
  return fetchAll<OutcomeRow>((from, to) =>
    supabase
      .from('flywheel_outcomes')
      .select('id, action_id, client_id, metric_key, delta_pct, window_days')
      .in('metric_key', Object.keys(REPRESENTATIVE_METRICS))
      .not('delta_pct', 'is', null)
      .gte('computed_at', since)
      .order('id', { ascending: true })
      .range(from, to),
  )
}

/**
 * 聚合 flywheel_outcomes → 写回 industry_benchmarks 的 GROWTH 字段。
 *
 * @param supabase    supabaseAdmin（service role）
 * @param minSamples  最低样本阈值（默认 MIN_SAMPLE_THRESHOLD）
 */
export async function accumulateBenchmarks(
  supabase: SupabaseClient,
  minSamples: number = MIN_SAMPLE_THRESHOLD,
): Promise<AccumulatorResult> {
  const result: AccumulatorResult = {
    benchmarksUpdated: 0,
    groupsSkipped: 0,
    clientsUnmapped: 0,
    errors: [],
  }

  // ── 1. clients.industry → benchmark 行业代码 ──────────────────────────────
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, industry')

  if (clientsError) {
    result.errors.push(`fetch clients: ${clientsError.message}`)
    return result
  }

  const industryByClient = new Map<string, string>()
  const unmapped = new Set<string>()

  for (const row of (clients ?? []) as Array<{ id: string; industry: string | null }>) {
    if (!row.industry) continue
    const category = mapIndustryToCategory([row.industry])
    if (category) industryByClient.set(row.id, category)
    else unmapped.add(row.id)
  }

  // ── 2. 拉最近 LOOKBACK_DAYS 的 outcomes ───────────────────────────────────
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()

  let outcomes: OutcomeRow[]
  try {
    outcomes = await loadOutcomesSince(supabase, since)
  } catch (e) {
    result.errors.push(`fetch outcomes: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  if (!outcomes || outcomes.length === 0) return result

  // ── 3. 分组 ───────────────────────────────────────────────────────────────
  // 先把同一个 (动作, 指标) 的多窗口结果收成一条：被转交的动作会同时按
  // bridge 自己的 28 天节奏和 pass 1 的窗口各算一次，两条都是合法事实，
  // 但它们是同一次动作的两个观察角度，不是两份证据。按行数当样本会让
  // 两个动作凑够 MIN_SAMPLE_THRESHOLD，还会把不同窗口的增长率混进同一个
  // 百分位 —— 而这个数字是要写进 industry_benchmarks 给客户看的。
  const measurements = keepOneMeasurementPerAction(outcomes as OutcomeRow[])

  const groups = new Map<string, GroupEntry>()
  const seenUnmapped = new Set<string>()

  for (const outcome of measurements) {
    const deltaPct = outcome.delta_pct
    if (deltaPct == null) continue

    const metricDef = REPRESENTATIVE_METRICS[outcome.metric_key]
    if (!metricDef) continue

    const industryCategory = industryByClient.get(outcome.client_id)
    if (!industryCategory) {
      if (unmapped.has(outcome.client_id)) seenUnmapped.add(outcome.client_id)
      continue
    }

    const key = `${industryCategory}||${metricDef.dimension}`

    if (!groups.has(key)) {
      groups.set(key, {
        industry_category: industryCategory,
        dimension: metricDef.dimension,
        deltas: [],
        windowDays: [],
        clientIds: new Set<string>(),
      })
    }

    const group = groups.get(key)!
    group.deltas.push(normaliseDeltaPct(Number(deltaPct), metricDef.direction))
    if (outcome.window_days != null) group.windowDays.push(Number(outcome.window_days))
    group.clientIds.add(outcome.client_id)
  }

  result.clientsUnmapped = seenUnmapped.size

  // ── 4. 逐组校验 → 计算 → 写入 GROWTH 字段 ─────────────────────────────────
  for (const [, group] of Array.from(groups.entries())) {
    const sampleSize = group.deltas.length

    if (sampleSize < minSamples) {
      result.groupsSkipped++
      continue
    }

    const percentiles = calcPercentiles(group.deltas)
    if (!percentiles) {
      result.groupsSkipped++
      continue
    }

    const clientCount = group.clientIds.size
    const windowDays = group.windowDays.length > 0 ? Math.round(median(group.windowDays)) : 0

    // realistic_3mo_growth_pct 存的是**实测窗口内**（约 2–4 周）的中位增幅，
    // 刻意不外推到 90 天。外推 = 编数字；而低估对处方是安全方向（华佗拿它
    // 约束 KPI target 的现实性，宁可保守）。真实窗口写在 growth_window_days。
    const growthPct = Math.round(percentiles.p50)

    const growthPayload = {
      realistic_3mo_growth_pct: growthPct,
      growth_source:       'ME client outcomes',
      growth_sample_size:  sampleSize,
      growth_client_count: clientCount,
      growth_confidence:   calcGrowthConfidence(sampleSize, clientCount),
      growth_window_days:  windowDays,
      growth_updated_at:   new Date().toISOString(),
      notes: buildGrowthNotes(sampleSize, clientCount, windowDays, percentiles.p50),
    }

    const { data: existing, error: checkErr } = await supabase
      .from('industry_benchmarks')
      .select('id')
      .eq('industry_category', group.industry_category)
      .eq('business_size', TARGET_BUSINESS_SIZE)
      .eq('market', TARGET_MARKET)
      .eq('dimension', group.dimension)
      .maybeSingle()

    if (checkErr) {
      result.errors.push(
        `check benchmark (${group.industry_category}/${group.dimension}): ${checkErr.message}`,
      )
      continue
    }

    // ⚠️ UPDATE 分支只带 growthPayload。绝不能把 score_p50/p75/p90 / source /
    // confidence / sample_size 加进来 —— 那是外部研究数据的地盘。
    const { error: writeErr } = existing
      ? await supabase
          .from('industry_benchmarks')
          .update(growthPayload)
          .eq('id', (existing as { id: string }).id)
      : await supabase
          .from('industry_benchmarks')
          .insert({
            industry_category: group.industry_category,
            business_size:     TARGET_BUSINESS_SIZE,
            market:            TARGET_MARKET,
            dimension:         group.dimension,
            ...growthPayload,
          })

    if (writeErr) {
      const hint = isMissingColumnError(writeErr.message)
        ? ' — growth_* columns missing; PM must apply migration 20260728000001_industry_benchmarks_growth_provenance.sql'
        : ''
      result.errors.push(
        `write benchmark (${group.industry_category}/${group.dimension}): ${writeErr.message}${hint}`,
      )
    } else {
      result.benchmarksUpdated++
    }
  }

  return result
}
