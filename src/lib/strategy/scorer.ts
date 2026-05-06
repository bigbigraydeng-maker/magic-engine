/**
 * Strategy Scorer — Phase 8.D.1.3
 *
 * Maps an analyzer Candidate to a numeric priority (0-100) and a
 * categorical priority bucket. The score is the only thing the UI
 * sorts by, so the formula must be stable and explainable.
 *
 * Formula (all components clamped before summing):
 *   mode_weight  ∈ [0, 40]   unified=40, geo_only=25, seo_only=15
 *   volume_score ∈ [0, 25]   log-scaled volume up to 5000
 *   kd_score     ∈ [0, 20]   easier (lower KD) → bigger score
 *   page_bonus   ∈ [0, 15]   upgrade_page with no GEO block / very thin
 *
 * Reference: ROADMAP.md P8.D.1.3
 */

import type { StrategyPriority } from '@/types/magic-engine'
import type { Candidate } from './analyzer'

const MODE_WEIGHT: Record<Candidate['content_mode'], number> = {
  unified: 40,
  geo_only: 25,
  seo_only: 15,
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function volumeScore(volume: number | undefined): number {
  if (volume == null || !isFinite(volume) || volume <= 0) return 8 // mid-low default
  // log scale: 100 vol ≈ 11, 1000 vol ≈ 17, 5000 vol ≈ 22, ∞ capped 25
  const raw = (Math.log10(volume + 1) / Math.log10(5001)) * 25
  return clamp(raw, 0, 25)
}

function kdScore(kd: number | undefined): number {
  if (kd == null) return 10 // mid default
  // KD 0  → 20, KD 50 → 10, KD 100 → 0
  return clamp(20 - kd / 5, 0, 20)
}

function pageBonus(c: Candidate): number {
  if (c.action_type !== 'upgrade_page') return 0
  let bonus = 0
  if (c.existing_has_geo_block === false) bonus += 8
  if ((c.existing_word_count ?? 0) < 500) bonus += 5
  else if ((c.existing_word_count ?? 0) < 800) bonus += 2
  return clamp(bonus, 0, 15)
}

export function scoreCandidate(c: Candidate): number {
  const mode = MODE_WEIGHT[c.content_mode] ?? 15
  const total =
    mode + volumeScore(c.keyword_volume) + kdScore(c.keyword_kd) + pageBonus(c)
  return clamp(Math.round(total), 0, 100)
}

export function derivePriorityBucket(score: number): StrategyPriority {
  if (score >= 80) return 'critical'
  if (score >= 60) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}
