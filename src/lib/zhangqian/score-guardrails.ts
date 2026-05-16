/**
 * 张骞评分护栏 — 确定性兜底，纠正 LLM 抽风的评分。
 *
 * 即使 prompts.ts 里写明了硬性约束，LLM 在长上下文 + 多轮 tool call 后仍可能
 * 出现"5 星 + 2 条评价 = 45 分"这种折中错误（被星级拉高，没充分惩罚评价稀少）。
 *
 * 这里实现一个纯函数 clamp：根据 raw data 计算理论上限，把 LLM 给出的过高分数
 * 压回上限，保证落库数据符合产品定义。
 *
 * 上限规则与 prompts.ts:86-101 的硬性约束严格对齐 —— 改动这里也要同步改 prompt。
 */

import type { DiscoveryReport, DiscoveredReviewPlatform } from './types'

// ─── 常量（与 prompts.ts 硬性约束对齐）────────────────────────────────────────

const REVIEW_THRESHOLD_TINY  = 5    // 全平台总评价 < 5 → cap 15
const REVIEW_THRESHOLD_FEW   = 20   // 全平台总评价 < 20 → cap 30
const REVIEW_THRESHOLD_OK    = 50   // 全平台总评价 < 50 → cap 50

const CAP_TINY = 15
const CAP_FEW  = 30
const CAP_OK   = 50

const SINGLE_PLATFORM_PENALTY = 10  // 只有 1 个平台覆盖时再 -10

const SCORE_DIMENSIONS = ['seo', 'social', 'reputation', 'ai_visibility'] as const

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 总评价数 = 所有平台 review_count 之和（null 当 0）。GBP 已在 review_platforms 里就不重复加。 */
function sumReviews(platforms: DiscoveredReviewPlatform[]): number {
  return platforms.reduce((acc, p) => acc + (p.review_count ?? 0), 0)
}

/** 有效平台数 = 拥有 ≥1 条评价的平台去重数。 */
function countActivePlatforms(platforms: DiscoveredReviewPlatform[]): number {
  const active = platforms.filter(p => (p.review_count ?? 0) > 0).map(p => p.platform)
  return new Set(active).size
}

/**
 * 根据 raw 评价数据计算 reputation 分数的理论上限。
 * 与 prompts.ts:96-101 的硬性约束严格对齐。
 */
export function computeReputationCap(platforms: DiscoveredReviewPlatform[]): number {
  const total      = sumReviews(platforms)
  const platCount  = countActivePlatforms(platforms)

  let cap = 100
  if (total < REVIEW_THRESHOLD_TINY)      cap = CAP_TINY
  else if (total < REVIEW_THRESHOLD_FEW)  cap = CAP_FEW
  else if (total < REVIEW_THRESHOLD_OK)   cap = CAP_OK

  if (platCount <= 1) cap = Math.max(0, cap - SINGLE_PLATFORM_PENALTY)

  return cap
}

/** 重算 overall 为 4 个维度的算术平均（向下取整），与 prompt 输出格式一致。 */
function recomputeOverall(scores: { seo: number; social: number; reputation: number; ai_visibility: number }): number {
  const sum = SCORE_DIMENSIONS.reduce((acc, k) => acc + scores[k], 0)
  return Math.floor(sum / SCORE_DIMENSIONS.length)
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export interface ClampResult {
  applied: boolean
  oldReputation: number
  newReputation: number
  cap: number
  oldOverall: number
  newOverall: number
}

/**
 * 落库前的护栏。如果 LLM 给出的 reputation 高于 raw data 允许的上限，把它压回上限并重算 overall。
 * 返回 [clamped report, clamp result]。永远不抛错 —— 缺字段时直接返回原 report。
 */
export function applyReputationGuardrail(
  report: DiscoveryReport,
): { report: DiscoveryReport; result: ClampResult | null } {
  const diagnosis = report.diagnosis
  if (!diagnosis || !diagnosis.scores) {
    return { report, result: null }
  }

  const platforms = report.review_platforms ?? []
  const cap = computeReputationCap(platforms)

  const oldReputation = diagnosis.scores.reputation
  if (oldReputation <= cap) {
    return { report, result: null }  // LLM 评分已经合规
  }

  const newScores = { ...diagnosis.scores, reputation: cap }
  const oldOverall = diagnosis.scores.overall
  const newOverall = recomputeOverall(newScores)

  const clampedReport: DiscoveryReport = {
    ...report,
    diagnosis: {
      ...diagnosis,
      scores: { ...newScores, overall: newOverall },
    },
  }

  return {
    report: clampedReport,
    result: {
      applied: true,
      oldReputation,
      newReputation: cap,
      cap,
      oldOverall,
      newOverall,
    },
  }
}
