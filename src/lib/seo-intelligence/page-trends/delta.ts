/**
 * Page-level delta computation for SEO Intelligence page-health table.
 *
 * Strategy (B-1 decision, 2026-06-04):
 *   - Snapshots are rolling 28-day windows, NOT discrete weekly buckets.
 *   - We compare the latest snapshot against the snapshot whose synced_at is
 *     closest to (latest.synced_at - 7 days).
 *   - If no snapshot is older than 7 days, fall back to the closest available
 *     snapshot and label the window as "since YYYY-MM-DD".
 *
 * Degradation:
 *   - 0 snapshots  → status = 'no_data', no deltas
 *   - 1 snapshot   → status = 'insufficient', no deltas (need ≥2 to diff)
 *   - 2+ snapshots → status = 'ok', deltas computed
 */

export interface PageDelta {
  /** Numeric delta vs the previous snapshot row for this page. */
  delta: number | null
  /** % change. null if previous value is 0 (avoid divide-by-zero). */
  deltaPct: number | null
  /** Whether the page existed in the previous snapshot. */
  existedInPrevious: boolean
  /** The page only appeared in the previous, not the latest. */
  droppedOff: boolean
}

export type DeltaStatus = 'ok' | 'insufficient' | 'no_data'

interface CompareTargets<T> {
  latest: { synced_at: string; pages: T[] } | null
  previous: { synced_at: string; pages: T[] } | null
}

/**
 * Pick the two snapshots to diff: newest, and the one closest to
 * (newest.synced_at - targetGapDays). Snapshots assumed sorted DESC by synced_at.
 */
export function pickComparison<T>(
  snapshots: Array<{ synced_at: string; pages: T[] }>,
  targetGapDays: number,
): CompareTargets<T> {
  if (snapshots.length === 0) return { latest: null, previous: null }
  const latest = snapshots[0]
  if (snapshots.length === 1) return { latest, previous: null }

  const latestMs = new Date(latest.synced_at).getTime()
  const targetMs = latestMs - targetGapDays * 24 * 60 * 60 * 1000

  // Skip latest (idx 0); choose closest to targetMs among the rest.
  let best = snapshots[1]
  let bestDistance = Math.abs(new Date(best.synced_at).getTime() - targetMs)
  for (let i = 2; i < snapshots.length; i++) {
    const candDist = Math.abs(new Date(snapshots[i].synced_at).getTime() - targetMs)
    if (candDist < bestDistance) {
      best = snapshots[i]
      bestDistance = candDist
    }
  }

  return { latest, previous: best }
}

/**
 * Compute deltas for a numeric metric extracted by `pickMetric`. Result is
 * keyed by normalised path.
 *
 * Single-metric helper. For multi-metric, call once per metric and compose.
 */
export function computeMetricDeltas<T>(
  latestPages: T[],
  previousPages: T[],
  getPagePath: (row: T) => string,
  pickMetric: (row: T) => number | null,
  normalisePath: (path: string) => string,
): { byPath: Map<string, PageDelta>; droppedOffPaths: Set<string> } {
  const previousByPath = new Map<string, number>()
  for (const row of previousPages) {
    const path = normalisePath(getPagePath(row))
    if (!path) continue
    const v = pickMetric(row)
    if (v !== null) previousByPath.set(path, v)
  }

  const byPath = new Map<string, PageDelta>()
  const seenInLatest = new Set<string>()

  for (const row of latestPages) {
    const path = normalisePath(getPagePath(row))
    if (!path) continue
    seenInLatest.add(path)
    const current = pickMetric(row)
    if (current === null) continue

    const prev = previousByPath.get(path)
    const existed = prev !== undefined
    const delta = existed ? current - prev! : null
    const deltaPct = existed && prev !== 0
      ? Number((((current - prev!) / Math.abs(prev!)) * 100).toFixed(1))
      : null

    byPath.set(path, {
      delta,
      deltaPct,
      existedInPrevious: existed,
      droppedOff: false,
    })
  }

  const droppedOffPaths = new Set<string>()
  for (const path of Array.from(previousByPath.keys())) {
    if (!seenInLatest.has(path)) droppedOffPaths.add(path)
  }

  return { byPath, droppedOffPaths }
}

/**
 * Diff days between two ISO timestamps, rounded.
 */
function diffDays(laterIso: string, earlierIso: string): number {
  const ms = new Date(laterIso).getTime() - new Date(earlierIso).getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}

/**
 * Build a UI label for the comparison window.
 * - When gap is within ±1 day of targetGapDays → "{N}d"
 * - Otherwise → "since {previous_date}"
 */
export function buildWindowLabel(
  latestSyncedAt: string,
  previousSyncedAt: string,
  targetGapDays: number,
): { label: string; days: number } {
  const gap = diffDays(latestSyncedAt, previousSyncedAt)
  if (Math.abs(gap - targetGapDays) <= 1) {
    return { label: `${targetGapDays}d`, days: gap }
  }
  return { label: `since ${previousSyncedAt.slice(0, 10)}`, days: gap }
}
