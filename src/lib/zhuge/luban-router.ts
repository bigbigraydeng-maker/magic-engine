/**
 * 鲁班路由 — maps a Luban tool name to a Magic Engine page URL.
 *
 * Pure function; no side effects. Called by ZhugeDrawer to resolve
 * the "触发鲁班" CTA destination for each priority action.
 *
 * Reference: ROADMAP.md Phase 12.G (P12.G.5)
 *
 * DAPE W2 — Additionally exposes `recommendActionsForDimension()`, a
 * memory-aware helper that pulls Layer 2 industry_benchmarks to suggest
 * dimension-specific actions whose targets are anchored to peer benchmarks.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadIndustryBenchmarkSummary } from './memory-loader'
import type {
  ZhugePromptMode,
  IndustryBenchmarkSummary,
} from './types'

export type LubanRoute =
  | { kind: 'navigate'; href: string; label: string }
  | { kind: 'none'; reason: string }

/**
 * Returns the destination route for a Luban tool, given a client ID.
 * Returns `{ kind: 'none' }` when the tool is null or not yet routed.
 */
export function getLubanRoute(tool: string | null, clientId: string): LubanRoute {
  if (!tool) {
    return { kind: 'none', reason: 'FDE 或外部完成，无法自动触发' }
  }

  switch (tool) {
    case 'luban.generate_blog_post':
      return {
        kind: 'navigate',
        href: `/dashboard/clients/${clientId}/blog`,
        label: '前往博客管理 →',
      }
    case 'luban.generate_geo_directive':
    case 'luban.publish_geo_snippet':
      return {
        kind: 'navigate',
        href: `/dashboard/geo-composer/${clientId}`,
        label: '前往 GEO Composer →',
      }
    case 'luban.generate_social_campaign':
    case 'luban.generate_social_post':
      return {
        kind: 'navigate',
        href: `/dashboard/clients/${clientId}`,
        label: '前往社媒矩阵 →',
      }
    default:
      return {
        kind: 'none',
        reason: `工具 ${tool} 暂未接入自动触发路由`,
      }
  }
}

// ── DAPE W2 — memory-aware action recommender ────────────────────────────────

export type LubanRecommendedDimension =
  | 'seo'
  | 'social'
  | 'reputation'
  | 'ai_visibility'

export interface LubanRecommendedAction {
  dimension: LubanRecommendedDimension
  /** Suggested tool name (matches getLubanRoute keys when auto-executable). */
  tool: string | null
  /** Short Chinese label for FDE/self-serve UI. */
  title: string
  /** Chinese rationale citing industry P50/P75/P90 anchors. */
  rationale: string
  /**
   * Target benchmark percentile used to size the recommendation.
   * Used by downstream UI to render "target = industry P75" badges.
   */
  target_percentile: 'p50' | 'p75' | 'p90' | null
  /**
   * Numeric peer benchmark (the percentile score). null when industry memory
   * was unavailable — caller should treat the recommendation as generic.
   */
  target_value: number | null
  /**
   * Industry typical budget anchor, when known. Helps downstream prescription
   * resource matching avoid over/under sizing.
   */
  typical_monthly_budget_aud: number | null
}

export interface RecommendActionsOptions {
  /** DAPE W2 prompt mode. Long returns up to 4 actions; short caps at 2. */
  mode?: ZhugePromptMode
  /**
   * Optional pre-computed industry summary. When omitted, the function loads
   * it from the DB. Useful for tests + callers that already have it cached.
   */
  industryBenchmarkSummary?: IndustryBenchmarkSummary
}

/**
 * DAPE W2 — Per-dimension default tool catalog.
 * Mirrors the routing table in getLubanRoute so the recommendations point
 * at tools we can actually auto-execute. `null` = FDE / external task.
 */
const DEFAULT_TOOL_BY_DIMENSION: Record<LubanRecommendedDimension, string | null> = {
  seo: 'luban.generate_blog_post',
  ai_visibility: 'luban.generate_geo_directive',
  social: 'luban.generate_social_post',
  reputation: null, // FDE-only, no auto tool
}

const TITLE_BY_DIMENSION: Record<LubanRecommendedDimension, string> = {
  seo: '发一篇 SEO 博客',
  ai_visibility: '发布一条 GEO 指令',
  social: '发一条社媒贴文',
  reputation: '请求一条新评价',
}

/**
 * DAPE W2 — Recommend the next actions for a client across the dimensions
 * present in the industry_benchmarks memory layer. The output is *not* the
 * conductor's prioritised work order — it is a routing helper used by:
 *
 *   - Self-serve Kanban "AI 推荐 3 件" widget (spec §2.4.6)
 *   - Prescription page "建议 action" preview
 *
 * Reads industry_benchmarks via memory-loader (non-blocking; degrades to
 * empty list when no benchmarks exist for the sub-industry).
 */
export async function recommendActionsForDimension(
  supabase: SupabaseClient,
  clientId: string,
  options: RecommendActionsOptions = {},
): Promise<LubanRecommendedAction[]> {
  const mode: ZhugePromptMode = options.mode ?? 'long'

  const summary =
    options.industryBenchmarkSummary ??
    (await loadIndustryBenchmarkSummary(supabase, clientId))

  // DAPE W2 — observable memory hit logging.
  console.info('[zhuge/luban-router] memory hits', JSON.stringify({
    client_id: clientId,
    mode,
    industry_memory: summary.has_content,
    sub_industry: summary.sub_industry,
    dimensions: summary.dimensions.length,
  }))

  if (!summary.has_content || summary.dimensions.length === 0) {
    return []
  }

  // Order dimensions by target percentile aggressiveness. Self-serve caps at p75
  // so suggestions stay realistic; FDE long mode goes for p90 stretch targets.
  const targetPercentile: 'p75' | 'p90' = mode === 'short' ? 'p75' : 'p90'

  const recs: LubanRecommendedAction[] = []
  for (const dim of summary.dimensions) {
    const targetValue =
      targetPercentile === 'p90' ? (dim.score_p90 ?? dim.score_p75 ?? dim.score_p50)
      : (dim.score_p75 ?? dim.score_p50)

    if (targetValue == null) continue

    // Skip reputation (FDE-only, no auto tool) when in short mode — self-serve
    // clients can't do reputation actions through the dashboard anyway.
    if (mode === 'short' && dim.dimension === 'reputation') continue

    const dimension: LubanRecommendedDimension = dim.dimension

    recs.push({
      dimension,
      tool: DEFAULT_TOOL_BY_DIMENSION[dimension] ?? null,
      title: TITLE_BY_DIMENSION[dimension],
      rationale: `行业 ${summary.sub_industry ?? '同类企业'} ${dimension} 维度 ${targetPercentile.toUpperCase()}=${targetValue}，建议把本月目标对齐到这个水平。`,
      target_percentile: targetPercentile,
      target_value: targetValue,
      typical_monthly_budget_aud: dim.typical_monthly_budget_aud,
    })
  }

  // Short mode = max 2 recs (keep self-serve simple).
  // Long mode = max 4 recs (covers all 4 in-house dimensions).
  const limit = mode === 'short' ? 2 : 4
  return recs.slice(0, limit)
}
