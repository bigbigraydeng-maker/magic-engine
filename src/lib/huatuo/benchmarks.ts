/**
 * Benchmarks Lookup — 华佗 Agent 行业基准数据访问层
 *
 * 优先级（P30 S5 动态化）：
 *   1. 实时从 baseline_domains 表算 P50/P75/P90（动态、反映竞品最新状态）
 *      → 至少 3 个域名有 seo_score 才认为可信
 *   2. 回退到 industry_benchmarks 缓存表（兼容旧数据 / 多维度 / 已录入的种子）
 *   3. 全部空 → 返回 null（华佗 Agent 标注"无基准锚定"）
 *
 * 子细分匹配（如 real_estate_auckland）：
 *   - 调用方传 industryCategory='real_estate' + city='auckland' → 拼出 'real_estate_auckland'
 *   - 调用方直接传 industryCategory='real_estate_auckland' 也可
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  HuatuoLookupContext,
  IndustryBenchmarkRow,
  BenchmarkDimension,
  BusinessSize,
  BenchmarkMarket,
} from './types'

export interface BenchmarkLookupParams {
  industryCategory: string | null
  /** 城市级细分（如 'auckland'）；与 industryCategory 拼接为 sub_industry */
  city?: string | null
  businessSize?: BusinessSize     // 默认 'small'，仅用于 industry_benchmarks 回退查询
  market?: BenchmarkMarket        // 默认 'AU_NZ'，仅用于 industry_benchmarks 回退查询
}

const ALL_DIMENSIONS: BenchmarkDimension[] = ['seo', 'social', 'reputation', 'ai_visibility']

const MIN_LIVE_SAMPLE = 3   // baseline_domains 实时算法所需的最小样本

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo))
}

/**
 * 拼接 sub_industry：industry + city → 'real_estate_auckland'
 * 没 city → 直接用 industry（如 'inbound_tour_operator'）
 */
function resolveSubIndustry(industryCategory: string, city?: string | null): string {
  if (!city) return industryCategory
  // 如果 industryCategory 已经包含 city 就直接用
  if (industryCategory.endsWith(`_${city.toLowerCase()}`)) return industryCategory
  return `${industryCategory}_${city.toLowerCase()}`
}

/**
 * 实时从 baseline_domains 算 SEO 基准。
 * 只在样本 >= MIN_LIVE_SAMPLE 时返回，否则返回 null（让回退逻辑接管）。
 */
async function computeLiveSeoBenchmark(
  supabase: SupabaseClient,
  subIndustry: string,
): Promise<IndustryBenchmarkRow | null> {
  const { data, error } = await supabase
    .from('baseline_domains')
    .select('seo_score, last_collected_at')
    .eq('sub_industry', subIndustry)
    .not('seo_score', 'is', null)

  if (error || !data || data.length < MIN_LIVE_SAMPLE) return null

  const scores = (data as Array<{ seo_score: number; last_collected_at: string | null }>)
    .map(r => r.seo_score)
    .sort((a, b) => a - b)

  const latestCollectedAt = (data as Array<{ last_collected_at: string | null }>)
    .map(r => r.last_collected_at)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop() ?? null

  return {
    id: `live:${subIndustry}:seo`,   // 合成 ID，标记为实时计算
    industry_category: subIndustry,
    business_size: 'medium',
    market: 'NZ',
    dimension: 'seo',
    score_p50: percentile(scores, 50),
    score_p75: percentile(scores, 75),
    score_p90: percentile(scores, 90),
    realistic_3mo_growth_pct: null,
    realistic_6mo_growth_pct: null,
    typical_monthly_budget_aud: null,
    source: `Live baseline_domains (n=${scores.length}${latestCollectedAt ? `, last ${latestCollectedAt.slice(0, 10)}` : ''})`,
    source_url: null,
    confidence: Math.min(1, parseFloat((scores.length / 10).toFixed(2))),
    sample_size: scores.length,
    notes: `Live computed from baseline_domains. Scores: ${scores.join(', ')}`,
  }
}

/**
 * 拉取 4 个维度的基准（如果某维度没有，对应字段为 null）。
 *
 * SEO 维度优先实时算（动态反映竞品变化），其他维度仍读 industry_benchmarks 缓存。
 */
export async function fetchBenchmarks(
  supabase: SupabaseClient,
  params: BenchmarkLookupParams,
): Promise<HuatuoLookupContext['benchmarks']> {
  const { industryCategory, city } = params
  const businessSize = params.businessSize ?? 'small'
  const market = params.market ?? 'AU_NZ'

  if (!industryCategory) {
    return { seo: null, social: null, reputation: null, ai_visibility: null }
  }

  const subIndustry = resolveSubIndustry(industryCategory, city)

  // ── SEO: 优先实时算，否则回退到缓存 ──────────────────────────────────────
  const liveSeo = await computeLiveSeoBenchmark(supabase, subIndustry)

  // ── 其他维度（social/reputation/ai_visibility）: 仍读 industry_benchmarks 缓存 ─
  const cacheDimensions: BenchmarkDimension[] = liveSeo
    ? ['social', 'reputation', 'ai_visibility']
    : ALL_DIMENSIONS

  // 同时查 sub_industry 和 industryCategory 两个 key，sub_industry 优先
  const lookupKeys = subIndustry !== industryCategory
    ? [subIndustry, industryCategory]
    : [subIndustry]

  const { data, error } = await supabase
    .from('industry_benchmarks')
    .select('*')
    .in('industry_category', lookupKeys)
    .eq('business_size', businessSize)
    .eq('market', market)
    .in('dimension', cacheDimensions)

  if (error) console.error('[huatuo/benchmarks] cache lookup error', error)

  const rows = (data ?? []) as IndustryBenchmarkRow[]
  const result: HuatuoLookupContext['benchmarks'] = {
    seo: liveSeo,
    social: null,
    reputation: null,
    ai_visibility: null,
  }

  // sub_industry 优先：先填 sub_industry 的，再填 industryCategory 的（不覆盖）
  for (const key of lookupKeys) {
    for (const row of rows.filter(r => r.industry_category === key)) {
      if (result[row.dimension] == null) result[row.dimension] = row
    }
  }

  return result
}

/**
 * 把基准数据格式化成 Claude prompt 里嵌入的中文表格。
 */
export function formatBenchmarksForPrompt(
  benchmarks: HuatuoLookupContext['benchmarks'],
  industryName: string,
  customerBudgetAud?: number,
): string {
  const lines: string[] = [
    `## 行业基准数据（${industryName}，AU/NZ 小型企业）`,
    '',
    '| 维度 | P50 | P75 | P90 | 3月可实现增长 | 6月可实现增长 | 典型月预算(AUD) | 数据置信度 | 来源 |',
    '|------|-----|-----|-----|--------------|--------------|----------------|----------|------|',
  ]

  const labelMap: Record<BenchmarkDimension, string> = {
    seo: 'SEO',
    social: '社媒',
    reputation: '口碑',
    ai_visibility: 'AI可见度',
  }

  let hasLowSampleGrowth = false

  for (const dim of ALL_DIMENSIONS) {
    const b = benchmarks[dim]
    if (!b) {
      lines.push(`| ${labelMap[dim]} | — | — | — | — | — | — | 无数据 | — |`)
    } else {
      const growth3mo = formatGrowthCell(b)
      if (growth3mo.lowSample) hasLowSampleGrowth = true
      lines.push(
        `| ${labelMap[dim]} | ${b.score_p50 ?? '—'} | ${b.score_p75 ?? '—'} | ${b.score_p90 ?? '—'} | ` +
        `${growth3mo.text} | ${b.realistic_6mo_growth_pct != null ? `${b.realistic_6mo_growth_pct}%` : '—'} | ` +
        `${b.typical_monthly_budget_aud ?? '—'} | ${b.confidence.toFixed(2)} | ${b.source ?? '估算'} |`
      )
    }
  }

  lines.push('')
  lines.push('**重要**：KPI target_value 必须落在该行业 P50–P90 区间内，超出者标记 realism_confidence ≤ 0.5。')

  if (hasLowSampleGrowth) {
    lines.push('')
    lines.push(
      '**⚠️ 小样本增长数据**：带 ⚠️ 的「可实现增长」来自 ME 自有客户实测，但样本或客户数不足' +
      '（少于 3 个客户 = 单客户历史，不是行业基准）。只能当方向性参考，不要拿它当承诺给客户的增长目标。'
    )
  }

  if (customerBudgetAud != null) {
    lines.push('')
    lines.push(formatBudgetComparison(benchmarks, customerBudgetAud))
  }

  return lines.join('\n')
}

/**
 * 渲染「3月可实现增长」单元格。
 *
 * 该数字若来自 benchmark-accumulator（ME 自有客户实测），要把小样本风险显式
 * 标出来：少于 3 个客户的聚合本质上是单客户历史，当行业基准用会误导处方。
 */
export function formatGrowthCell(
  b: Pick<
    IndustryBenchmarkRow,
    'realistic_3mo_growth_pct' | 'growth_source' | 'growth_sample_size' | 'growth_client_count'
  >,
): { text: string; lowSample: boolean } {
  if (b.realistic_3mo_growth_pct == null) return { text: '—', lowSample: false }

  const pct = `${b.realistic_3mo_growth_pct}%`
  if (!b.growth_source) return { text: pct, lowSample: false }

  const samples = b.growth_sample_size ?? 0
  const clients = b.growth_client_count ?? 0
  const lowSample = clients < 3 || samples < 5

  return {
    text: lowSample ? `${pct} ⚠️(n=${samples}/客户${clients})` : `${pct} (n=${samples}/客户${clients})`,
    lowSample,
  }
}

/**
 * 把"客户月预算 vs 行业典型月预算"折叠成一段中文指导。
 * 给华佗一个明确的预算定位锚点，避免开出与预算严重不匹配的处方。
 */
function formatBudgetComparison(
  benchmarks: HuatuoLookupContext['benchmarks'],
  customerBudgetAud: number,
): string {
  const typicalBudgets = ALL_DIMENSIONS
    .map(d => benchmarks[d]?.typical_monthly_budget_aud)
    .filter((v): v is number => v != null && v > 0)

  if (typicalBudgets.length === 0) {
    return `## 预算定位\n\n客户月预算 AUD ${customerBudgetAud}。行业无典型预算基准，请按预算规模保守估算 action 覆盖范围。`
  }

  const typicalMin = Math.min(...typicalBudgets)
  const typicalMax = Math.max(...typicalBudgets)
  const typicalMid = Math.round((typicalMin + typicalMax) / 2)
  const ratio = customerBudgetAud / typicalMid

  const guidance =
    ratio < 0.5  ? '预算显著低于行业典型水平 — 处方应聚焦 1–2 个高杠杆维度，严格控制 action 数量，不要铺开多维度。' :
    ratio < 1    ? '预算略低于行业典型水平 — 需精选优先维度，单维度 action 数量从紧。' :
    ratio <= 1.5 ? '预算与行业典型水平匹配 — 可覆盖客户指定的全部优先维度。' :
                   '预算高于行业典型水平 — 可在优先维度加大投入，或并行推进多个维度。'

  return [
    '## 预算定位',
    '',
    `- 客户月预算：AUD ${customerBudgetAud}`,
    `- 行业典型月预算区间：AUD ${typicalMin} – ${typicalMax}（中位约 ${typicalMid}）`,
    `- 预算比值：${ratio.toFixed(2)}×`,
    '',
    `**指导**：${guidance}`,
  ].join('\n')
}

/**
 * 提取本次使用的所有 benchmark ID（用于审计/溯源）
 */
export function extractBenchmarkIds(benchmarks: HuatuoLookupContext['benchmarks']): string[] {
  return ALL_DIMENSIONS
    .map(d => benchmarks[d]?.id)
    .filter((id): id is string => Boolean(id))
}
