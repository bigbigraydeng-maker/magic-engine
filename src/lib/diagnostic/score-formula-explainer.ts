/**
 * Score Formula Explainer — deterministic per-dimension breakdown
 *
 * Returns the public-facing "为什么是 X 分?" content for each diagnostic
 * dimension card. No LLM, no DB — just the formulas the collectors actually
 * use, surfaced as readable Chinese. Updates here are the single source of
 * truth the UI cites when FDE asks "where does this number come from?".
 *
 * Tied to:
 *   - src/lib/diagnostic/collectors/seo-collector.ts (KW 50 + Authority 25 + Technical 25)
 *   - src/lib/diagnostic/collectors/reputation-collector.ts (rating 0.70 + count 0.30)
 *   - src/lib/diagnostic/collectors/ads-collector.ts (platform 0.40 + volume 0.35 + creative 0.25)
 *   - src/lib/diagnostic/collectors/social-collector.ts (freq + engagement / 2)
 *   - src/lib/diagnostic/collectors/competitor-collector.ts (client/comp traffic ratio)
 *   - src/lib/diagnostic/collectors/ai-visibility-collector.ts (citation rate)
 *   - src/lib/diagnostic/constants.ts DIMENSION_WEIGHTS + SCORE_THRESHOLDS
 */

import type { DiagnosticDimension } from '@/types/diagnostic'
import { DIMENSION_WEIGHTS, SCORE_THRESHOLDS } from './constants'

export type ScoreTier = 'green' | 'amber' | 'red' | 'unknown'

export interface DimensionFormulaCard {
  /** Compact one-liner: weighted ingredients. */
  formula: string
  /** Where the inputs come from (e.g. "DataForSEO + GSC"). */
  dataSource: string
  /** Plain-language interpretation of the current score's tier. */
  tierHint: string
  /** Weight this dimension carries inside the overall score (0–1). */
  weightInOverall: number
}

const TIER_BAND_HINT = `综合分阈值：≥${SCORE_THRESHOLDS.green} 健康 / ${SCORE_THRESHOLDS.amber}–${SCORE_THRESHOLDS.green - 1} 待改善 / <${SCORE_THRESHOLDS.amber} 危险`

const FORMULAS: Record<DiagnosticDimension, Omit<DimensionFormulaCard, 'weightInOverall'>> = {
  seo: {
    formula: 'SEO = 50 × 关键词覆盖率 + 25 × 域名权威(0–100) + 25 × 技术健康(0–100)',
    dataSource: 'DataForSEO Labs + Backlink API + Jina 首页审计；目标关键词来自 Settings (or GSC 回退)',
    tierHint: `${SCORE_THRESHOLDS.green}+ 健康 · ${SCORE_THRESHOLDS.amber}–${SCORE_THRESHOLDS.green - 1} 待改善 · <${SCORE_THRESHOLDS.amber} 危险`,
  },
  ai_visibility: {
    formula: 'AI 可见度 = 100 × 被 AI 引用问句数 / 总追踪问句数',
    dataSource: 'AI Tracker 真实问答快照（张骞模块）+ 实时探针兜底',
    tierHint: `${SCORE_THRESHOLDS.green}+ 被多数问句引用 · 低分代表 AI 主流回答里不出现该品牌`,
  },
  ads: {
    formula: '广告 = 40 × 平台多样性 + 35 × 广告体量 + 25 × 创意多样性',
    dataSource: 'Apify Meta Ad Library + DataForSEO Google Ads Transparency',
    tierHint: `多平台同时投 + 体量充足 + 多种创意格式 → 高分；单平台 / 少量广告 → 低分`,
  },
  social: {
    formula: '社媒 = 平均(每平台 0.40×发文频率分 + 0.40×互动率分) + min(20, (平台数-1)×10) 多平台奖励',
    dataSource: 'Apify 社媒 scraper（IG/FB/TikTok 公共贴文）+ Settings 已绑定的 handle',
    tierHint: `每平台每月 ≥6 帖 + 互动率 ≥3% → 健康；账号未绑 / 长期断更 → 无数据`,
  },
  reputation: {
    formula: '口碑 = 70 × (评分 / 5) + 30 × min(评论数, 30) / 30',
    dataSource: 'Google Business Profile + 行业平台（TripAdvisor / ProductReview / Booking / Hipages）',
    tierHint: `高评分 + ≥30 条评论 → 健康；评分 <3.5 或缺评论 → 低分`,
  },
  competitor: {
    formula: '竞品 = 100 × 客户自然流量 / 竞品自然流量均值（封顶 100）',
    dataSource: 'DataForSEO 同行业前 5 域名的 organic_traffic',
    tierHint: `客户流量 ≥ 竞品均值 → 满分；<10% → 严重落后；< 3 个竞品 → 无数据`,
  },
}

export function getDimensionFormula(dim: DiagnosticDimension): DimensionFormulaCard {
  return {
    ...FORMULAS[dim],
    weightInOverall: DIMENSION_WEIGHTS[dim],
  }
}

export function classifyTier(score: number | null | undefined): ScoreTier {
  if (score === null || score === undefined) return 'unknown'
  if (score >= SCORE_THRESHOLDS.green) return 'green'
  if (score >= SCORE_THRESHOLDS.amber) return 'amber'
  return 'red'
}

export const OVERALL_WEIGHTING_NOTE =
  `综合得分 = Σ (维度分 × 维度权重) / Σ 已采集维度权重` +
  `（无数据维度排除后重新归一化）。当前权重：` +
  Object.entries(DIMENSION_WEIGHTS)
    .map(([d, w]) => `${d} ${Math.round(w * 100)}%`)
    .join(' · ') +
  `。${TIER_BAND_HINT}`
