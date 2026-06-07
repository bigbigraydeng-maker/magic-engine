/**
 * Legacy diagnostic-run score sanitiser
 *
 * Pre-PR-251 CompetitorCollector defaulted to `score: 100` when fewer than 3
 * competitor domains were found, instead of returning `null`. Those runs sit
 * in `diagnostic_runs.dimension_scores` with `competitor: 100`, no entry in
 * `dimensions_skipped`, and zero competitor findings — and they render as
 * green "100 健康" on the diagnostic page until the FDE re-runs.
 *
 * The fix lives in collector code (already shipped), but historical runs are
 * a UX time-bomb: the PM literally said "竞品 100 健康是什么鬼???" on the
 * live page. Rather than mutate the DB (FEIMAOTUI rule: no SQL writes from
 * UI flows), we sanitise at read time before rendering.
 *
 * This module is intentionally tiny and pure so the rule is easy to test in
 * isolation and easy to delete once the legacy data ages out.
 */

import type { DiagnosticDimension } from '@/types/diagnostic'

export interface LegacySanitiserInput {
  rawScores: Partial<Record<DiagnosticDimension, number | null>>
  dimensionsSkipped: ReadonlySet<DiagnosticDimension>
  findingCountByDim: Partial<Record<DiagnosticDimension, number>>
}

export interface LegacySanitiserResult {
  scores: Partial<Record<DiagnosticDimension, number | null>>
  effectiveSkippedSet: ReadonlySet<DiagnosticDimension>
  wasLegacyDefault: boolean
}

/**
 * Returns sanitised scores + an updated skipped set.
 *
 * Triggers ONLY on the exact legacy bug fingerprint:
 *   competitor === 100  AND  not in dimensions_skipped  AND  zero competitor findings
 *
 * A legitimate fresh run where the client genuinely matches competitor traffic
 * average (score 100 + at least one informational finding OR explicit non-skip)
 * is left untouched.
 */
export function sanitiseLegacyScores(input: LegacySanitiserInput): LegacySanitiserResult {
  const { rawScores, dimensionsSkipped, findingCountByDim } = input

  const competitorScore = rawScores['competitor']
  const competitorFindings = findingCountByDim['competitor'] ?? 0
  const isLegacyCompetitorDefault =
    competitorScore === 100 &&
    !dimensionsSkipped.has('competitor') &&
    competitorFindings === 0

  if (!isLegacyCompetitorDefault) {
    return {
      scores: rawScores,
      effectiveSkippedSet: dimensionsSkipped,
      wasLegacyDefault: false,
    }
  }

  return {
    scores: { ...rawScores, competitor: null },
    effectiveSkippedSet: new Set<DiagnosticDimension>(
      Array.from(dimensionsSkipped).concat('competitor'),
    ),
    wasLegacyDefault: true,
  }
}
