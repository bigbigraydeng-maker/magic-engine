/**
 * Pure scoring functions for Phase 8.1 content strategy opportunities.
 * No external dependencies — all logic is deterministic given a ScoringContext.
 */

import type {
  ScoringContext,
  ScoringResult,
  ContentMode,
  ActionType,
  StrategyPriority,
} from './types'

// ---------------------------------------------------------------------------
// Content mode determination
// ---------------------------------------------------------------------------

function determineContentMode(ctx: ScoringContext): ContentMode {
  const hasKeywordValue =
    ctx.keyword_volume !== null &&
    ctx.keyword_volume > 50 &&
    ctx.keyword_kd !== null &&
    ctx.keyword_kd < 50

  if (ctx.ai_weak && hasKeywordValue) return 'unified'
  if (ctx.ai_weak) return 'geo_only'
  if (hasKeywordValue) return 'seo_only'

  // Default when no strong signal
  return 'geo_only'
}

// ---------------------------------------------------------------------------
// Action type determination
// ---------------------------------------------------------------------------

function determineActionType(ctx: ScoringContext, mode: ContentMode): ActionType {
  if (ctx.has_existing_page) return 'upgrade_page'

  if (
    mode === 'geo_only' &&
    ctx.ai_weak &&
    ctx.ai_weak_model_count >= 3
  ) {
    return 'social_content'
  }

  return 'new_blog'
}

// ---------------------------------------------------------------------------
// Priority score calculation
// ---------------------------------------------------------------------------

function scoreUnified(ctx: ScoringContext): number {
  let score = 72
  if ((ctx.keyword_volume ?? 0) >= 500) score += 8
  if ((ctx.keyword_kd ?? 100) <= 30) score += 8
  if (!ctx.has_existing_page) score += 8
  return score
}

function scoreGeoOnly(ctx: ScoringContext): number {
  let score = 52
  if (ctx.ai_weak_model_count >= 3) score += 8
  if (!ctx.has_existing_page) score += 8
  return score
}

function scoreSeoOnly(ctx: ScoringContext): number {
  let score = 42
  if ((ctx.keyword_volume ?? 0) >= 1000) score += 10
  if ((ctx.keyword_kd ?? 100) <= 20) score += 10
  return score
}

function scoreUpgradePage(ctx: ScoringContext): number {
  const wc = ctx.word_count ?? 0
  const isLowWordCount = wc < 500

  let base: number
  if (!ctx.has_geo_block && isLowWordCount) {
    base = 45
  } else if (!ctx.has_geo_block && !isLowWordCount) {
    base = 38
  } else {
    // has_geo_block = true (both wc cases collapse to one rule per spec)
    base = 28
  }

  let score = base
  if (ctx.page_type === 'product' || ctx.page_type === 'service') score += 10
  if (ctx.ai_weak) score += 8
  return score
}

function calculateScore(ctx: ScoringContext, mode: ContentMode, action: ActionType): number {
  let score: number

  if (action === 'upgrade_page') {
    score = scoreUpgradePage(ctx)
  } else if (mode === 'unified') {
    score = scoreUnified(ctx)
  } else if (mode === 'geo_only') {
    score = scoreGeoOnly(ctx)
  } else {
    score = scoreSeoOnly(ctx)
  }

  return Math.max(0, Math.min(100, score))
}

// ---------------------------------------------------------------------------
// Priority label
// ---------------------------------------------------------------------------

function toPriority(score: number): StrategyPriority {
  if (score >= 80) return 'critical'
  if (score >= 60) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

// ---------------------------------------------------------------------------
// P14.C.5: Flywheel feedback — apply mode-level boost based on prior outcomes
// ---------------------------------------------------------------------------

/** A 0–10 boost per content_mode, sourced from per-client SEO blog confidence. */
export type ModeBoostMap = Partial<Record<ContentMode, number>>

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function scoreOpportunity(
  ctx: ScoringContext,
  modeBoosts?: ModeBoostMap,
): ScoringResult {
  const content_mode = determineContentMode(ctx)
  const action_type = determineActionType(ctx, content_mode)
  const baseScore = calculateScore(ctx, content_mode, action_type)

  // P14.C.5: flywheel feedback — proven-mode boost (clamped at 100 by Math.min).
  const boost = modeBoosts?.[content_mode] ?? 0
  const priority_score = Math.max(0, Math.min(100, baseScore + boost))

  const priority = toPriority(priority_score)

  return { priority_score, priority, action_type, content_mode }
}
