/**
 * 诸葛亮 Daily Recommendation — DAPE W5 (spec §2.4.5 + §2.4.6)
 *
 * "AI 推荐今天做 3 件" — selects up to 3 execution_items to surface at the top
 * of the Kanban so FDE / 自助客户 doesn't have to scan 87 cards to decide
 * what to do today.
 *
 * Two modes (spec §2.4.6):
 *   - short (自助 / kanban top widget): pure rule-based ranker, no LLM call,
 *     fast + deterministic + zero MTC. This module implements the short mode.
 *   - long (FDE detailed planner): LLM synthesises Goal verdict proximity +
 *     client_learned_preferences + prior outcome — handled in the conduct
 *     route, NOT here.
 *
 * Ranker scoring (short mode):
 *   - Status weight        : pending = 3, in_progress = 2, others = 0
 *   - Due-date proximity   : due today/overdue = +5, this week = +3, future = +1, no due = +0
 *   - Sort-order priority  : lower sort_order = higher (sort_order * -0.1)
 *   - Dimension balance    : penalise picking 2+ of same dimension
 *                            (Kanban already 6 dimensions, we want diversity)
 *
 * Determinism: ties broken by (created_at ASC, id ASC) — same input always
 * yields same output (testable, no clock dependency beyond now()).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ────────────────────────────────────────────────────────────────────

export type DailyRecommendationStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export interface DailyRecommendationCandidate {
  id: string
  client_id: string
  title: string
  description: string
  dimension: string | null
  status: DailyRecommendationStatus
  due_date: string | null
  sort_order: number
  created_at: string
  prescription_id: string | null
  initiative_id: string | null
  source: string
}

export interface DailyRecommendation extends DailyRecommendationCandidate {
  /** Final ranker score (0..100, higher = recommend first). */
  score: number
  /** Human-readable reason this item ranked. */
  reason: string
}

// ── Tunables ──────────────────────────────────────────────────────────────────

/** Maximum cards to recommend per call (DAPE spec: 3). */
export const DAILY_RECOMMENDATION_MAX = 3

/** Status weight multipliers. */
const STATUS_WEIGHT: Record<DailyRecommendationStatus, number> = {
  pending:     3,
  in_progress: 2,
  completed:   0,
  skipped:     0,
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch up to 3 daily recommendations for a client.
 *
 * Reads execution_items directly (no LLM). Filters to pending + in_progress.
 * Skips items already due-completed (completed_at) or skipped.
 */
export async function fetchDailyRecommendations(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<DailyRecommendation[]> {
  const { data, error } = await supabase
    .from('execution_items')
    .select(
      'id, client_id, title, description, dimension, status, due_date, sort_order, created_at, prescription_id, initiative_id, source',
    )
    .eq('client_id', clientId)
    .in('status', ['pending', 'in_progress'])
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) {
    throw new Error(`fetchDailyRecommendations DB error: ${error.message}`)
  }

  const candidates = (data ?? []) as DailyRecommendationCandidate[]
  return rankDailyRecommendations(candidates, now)
}

/**
 * Pure ranker — exported for tests so we can drive deterministic scenarios
 * without hitting the DB.
 *
 * Algorithm:
 *   1. Score each candidate independently.
 *   2. Sort by score DESC (higher = recommend first).
 *   3. Walk the sorted list, but penalise picking 2+ of same dimension —
 *      if the next candidate's dimension already appears in the picked set,
 *      we deduct dimensionPenalty from its score before deciding.
 *   4. Stop after DAILY_RECOMMENDATION_MAX picks.
 */
export function rankDailyRecommendations(
  candidates: DailyRecommendationCandidate[],
  now: Date = new Date(),
): DailyRecommendation[] {
  const scored = candidates.map((c) => scoreCandidate(c, now))

  // Sort by base score DESC; tiebreak by (created_at ASC, id ASC) for determinism
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ta = Date.parse(a.created_at)
    const tb = Date.parse(b.created_at)
    if (ta !== tb) return ta - tb
    return a.id.localeCompare(b.id)
  })

  // Diversity pass: prefer picking different dimensions
  const picked: DailyRecommendation[] = []
  const seenDimensions = new Set<string>()
  const remaining = [...scored]

  while (picked.length < DAILY_RECOMMENDATION_MAX && remaining.length > 0) {
    // Apply dimension penalty to remaining candidates (in-loop to keep priority order fresh)
    let bestIdx = 0
    let bestEffective = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]
      const dim = c.dimension ?? '__none__'
      // Penalise duplicate dimension by -20 (still possible to pick if it's the only option left)
      const effective = seenDimensions.has(dim) ? c.score - 20 : c.score
      if (effective > bestEffective) {
        bestEffective = effective
        bestIdx = i
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0]
    seenDimensions.add(chosen.dimension ?? '__none__')
    picked.push(chosen)
  }

  return picked
}

// ── Scoring helpers (exported for tests) ─────────────────────────────────────

export function scoreCandidate(
  c: DailyRecommendationCandidate,
  now: Date,
): DailyRecommendation {
  const statusWeight = STATUS_WEIGHT[c.status] ?? 0
  const dueScore = scoreDueProximity(c.due_date, now)
  const sortScore = -((c.sort_order ?? 0) * 0.1)

  // Base score: status (max 3) × 10 + due (max 5) × 5 + sortNudge
  // Range: roughly 0..55, picked-with-penalty -20 still > 0
  const raw = statusWeight * 10 + dueScore * 5 + sortScore
  const score = Math.max(0, Math.min(100, raw))

  return {
    ...c,
    score,
    reason: explainScore(c, statusWeight, dueScore),
  }
}

export function scoreDueProximity(dueDate: string | null, now: Date): number {
  if (!dueDate) return 0
  const due = Date.parse(dueDate)
  if (Number.isNaN(due)) return 0
  const today = Date.parse(now.toISOString().slice(0, 10))
  const daysUntilDue = Math.floor((due - today) / (1000 * 60 * 60 * 24))
  if (daysUntilDue <= 0) return 5   // overdue or due today
  if (daysUntilDue <= 7) return 3   // due this week
  if (daysUntilDue <= 30) return 1  // due this month
  return 0
}

function explainScore(
  c: DailyRecommendationCandidate,
  statusWeight: number,
  dueScore: number,
): string {
  const parts: string[] = []
  if (statusWeight === 3) parts.push('待处理')
  else if (statusWeight === 2) parts.push('进行中')

  if (dueScore === 5) parts.push('已到期 / 今天截止')
  else if (dueScore === 3) parts.push('本周内截止')
  else if (dueScore === 1) parts.push('本月内截止')

  if (c.dimension) {
    const dimLabels: Record<string, string> = {
      seo:           'SEO',
      ai_visibility: 'GEO',
      ads:           '广告',
      social:        '社媒',
      reputation:    '口碑',
      competitor:    '竞品',
    }
    parts.push(dimLabels[c.dimension] ?? c.dimension)
  }

  return parts.length > 0 ? parts.join(' · ') : '排序靠前'
}
