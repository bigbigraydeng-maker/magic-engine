/**
 * Time-series aggregation pure functions — Phase 22.B.2.
 *
 * All functions are pure (no I/O, no DB calls) and timezone-aware.
 * Default timezone is 'Pacific/Auckland' (NZST/NZDT) matching the project's
 * target market (AU/NZ).  Pass an explicit tz for other markets.
 *
 * Usage:
 *   const series = bucketByGranularity(rawPoints, 'day', 'Pacific/Auckland')
 *   const delta  = computeDeltaPct(series, 7)   // 7-day % change
 *   const ma7    = movingAverage(series, 7)
 *   const gap    = detectGap(series, 3)          // ≥ 3 consecutive missing days?
 */

import type { TrendPoint, TrendSeries, TimeGranularity, MetricUnit, MetricDirection } from './types'
import type { FlywheelName } from '../adapters/types'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Raw metric row coming from flywheel_metrics (or any source).
 * We only need value + timestamp.
 */
export interface RawMetricPoint {
  measured_at:  string   // ISO 8601 string
  metric_value: number
}

/**
 * Bucket raw metric points by time granularity and aggregate each bucket.
 *
 * Aggregation strategy per unit/direction:
 *   - rank / lower_is_better →  average  (want smoother trend not worst-day)
 *   - percent* / ratio       →  average
 *   - count / currency       →  sum  for day buckets; average for week/month
 *     (daily sum is meaningful for clicks; weekly average is meaningful for position)
 *
 * Empty buckets within [start, end] are omitted — callers should handle gaps.
 *
 * @param rawPoints   Unsorted raw rows from DB
 * @param granularity 'day' | 'week' | 'month'
 * @param timezone    IANA timezone string (default 'Pacific/Auckland')
 * @param metricKey   Passed through to TrendSeries
 * @param flywheel    Passed through to TrendSeries
 * @param label       Display label
 * @param unit        Metric unit (drives aggregation strategy)
 * @param direction   Higher/lower is better
 */
export function bucketByGranularity(
  rawPoints:   RawMetricPoint[],
  granularity: TimeGranularity,
  timezone:    string,
  metricKey:   string,
  flywheel:    FlywheelName,
  label:       string,
  unit:        MetricUnit,
  direction:   MetricDirection,
): TrendSeries {
  // Sort ascending by measured_at
  const sorted = [...rawPoints].sort(
    (a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime(),
  )

  const bucketMap = new Map<string, number[]>()

  for (const pt of sorted) {
    const key = getBucketKey(pt.measured_at, granularity, timezone)
    const existing = bucketMap.get(key)
    if (existing) {
      existing.push(pt.metric_value)
    } else {
      bucketMap.set(key, [pt.metric_value])
    }
  }

  // Sort bucket keys chronologically
  const sortedKeys = Array.from(bucketMap.keys()).sort()

  const useSum = (unit === 'count' || unit === 'currency') && granularity === 'day'

  const points: TrendPoint[] = sortedKeys.map(key => ({
    ts:    bucketKeyToIso(key, granularity, timezone),
    value: useSum
      ? bucketMap.get(key)!.reduce((a, b) => a + b, 0)
      : average(bucketMap.get(key)!),
  }))

  const deltaPct7d  = computeDeltaPct(points, 7)
  const deltaPct28d = computeDeltaPct(points, 28)
  const hasDataGap  = detectGap(points, 3, granularity)

  return {
    metricKey,
    flywheel,
    label,
    unit,
    direction,
    granularity,
    points,
    deltaPct7d,
    deltaPct28d,
    hasDataGap,
  }
}

/**
 * Compute the signed percentage change between the latest point and the value
 * approximately `windowDays` ago.
 *
 * Returns null when:
 *   - fewer than 2 points
 *   - no point found within the reference window
 *   - referenceValue is 0 (avoid divide-by-zero)
 */
export function computeDeltaPct(
  points:     TrendPoint[],
  windowDays: number,
): number | null {
  if (points.length < 2) return null

  const latest = points[points.length - 1]
  if (!latest) return null

  const latestMs   = new Date(latest.ts).getTime()
  const windowMs   = windowDays * 24 * 60 * 60 * 1000
  const targetMs   = latestMs - windowMs

  // Find the point closest to targetMs (within 1.5 days to handle weekly/monthly gaps)
  const toleranceMs = 1.5 * 24 * 60 * 60 * 1000
  let best: TrendPoint | null = null
  let bestDiff = Infinity

  for (const pt of points) {
    if (pt === latest) continue
    const diff = Math.abs(new Date(pt.ts).getTime() - targetMs)
    if (diff < toleranceMs && diff < bestDiff) {
      best     = pt
      bestDiff = diff
    }
  }

  if (!best || best.value === 0) return null

  return ((latest.value - best.value) / best.value) * 100
}

/**
 * Compute a simple n-period moving average over the series.
 * Returns a new array of the same length; leading elements where n-1 prior
 * points are unavailable are filled with the point's own value.
 */
export function movingAverage(points: TrendPoint[], n: number): TrendPoint[] {
  if (n <= 0 || points.length === 0) return points

  return points.map((pt, i) => {
    const window = points.slice(Math.max(0, i - n + 1), i + 1)
    return { ts: pt.ts, value: average(window.map(p => p.value)) }
  })
}

/**
 * Detect whether the series has a data gap — `minConsecutiveMissing`
 * consecutive day-buckets with no data.
 *
 * For weekly/monthly granularity a "gap" is a missing period that would
 * normally be present.  We check that the gap between adjacent points
 * exceeds (minConsecutiveMissing × granularity_width_days) days.
 */
export function detectGap(
  points:                 TrendPoint[],
  minConsecutiveMissing:  number,
  granularity:            TimeGranularity = 'day',
): boolean {
  if (points.length < 2) return false

  const granularityDays: Record<TimeGranularity, number> = {
    day:   1,
    week:  7,
    month: 30,
  }

  const stepMs        = granularityDays[granularity] * 24 * 60 * 60 * 1000
  const gapThresholdMs = (minConsecutiveMissing + 0.5) * stepMs  // +0.5 tolerance

  for (let i = 1; i < points.length; i++) {
    const gapMs = new Date(points[i].ts).getTime() - new Date(points[i - 1].ts).getTime()
    if (gapMs >= gapThresholdMs) return true
  }
  return false
}

/**
 * Build a fixed-length sparkline array (length = days, newest point last).
 * Gaps filled with null.  Used by MetricSummaryTile.
 */
export function buildSparkline(
  points: TrendPoint[],
  days:   number,
  endDate: Date = new Date(),
): Array<number | null> {
  const result: Array<number | null> = Array(days).fill(null)
  const endMs = startOfDay(endDate).getTime()
  const dayMs = 24 * 60 * 60 * 1000

  for (const pt of points) {
    const ptDayMs = new Date(pt.ts).getTime()
    const daysAgo = Math.round((endMs - ptDayMs) / dayMs)
    const idx     = days - 1 - daysAgo
    if (idx >= 0 && idx < days) {
      result[idx] = pt.value
    }
  }

  return result
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Convert a timestamp to a stable bucket key string.
 * Format: "YYYY-MM-DD" for day, "YYYY-Www" for week, "YYYY-MM" for month.
 */
function getBucketKey(
  isoTimestamp: string,
  granularity:  TimeGranularity,
  timezone:     string,
): string {
  // Use Intl.DateTimeFormat for timezone-aware date parts
  const date = new Date(isoTimestamp)
  const parts = getDateParts(date, timezone)

  if (granularity === 'day') {
    return `${parts.year}-${parts.month}-${parts.day}`
  }

  if (granularity === 'week') {
    // ISO 8601 week: find Monday of the week
    const monday = getMondayOfWeek(date, timezone)
    const mParts = getDateParts(monday, timezone)
    return `${mParts.year}-W${mParts.weekStr}`
  }

  // month
  return `${parts.year}-${parts.month}`
}

/**
 * Convert a bucket key back to an ISO 8601 timestamp (start-of-bucket).
 */
function bucketKeyToIso(
  key:         string,
  granularity: TimeGranularity,
  timezone:    string,
): string {
  if (granularity === 'day' || granularity === 'month') {
    // Key is already YYYY-MM-DD or YYYY-MM; append T00:00:00 for day
    const dateStr = granularity === 'month' ? `${key}-01` : key
    return toLocalMidnightIso(dateStr, timezone)
  }

  // Week: "YYYY-Www" — parse monday date from the ISO week number
  const [yearStr, weekStr] = key.split('-W')
  const year = parseInt(yearStr, 10)
  const week = parseInt(weekStr, 10)
  const monday = isoWeekToDate(year, week)
  return monday.toISOString()
}

// ─── Timezone helpers (no external dependency) ───────────────────────────────

interface DateParts {
  year:    string
  month:   string  // zero-padded "01"–"12"
  day:     string  // zero-padded "01"–"31"
  weekStr: string  // zero-padded week number
}

/** Get year/month/day parts in the given timezone (no week — avoids circular call). */
function getLocalYMD(date: Date, timezone: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  })
  const parts = fmt.formatToParts(date)
  return {
    year:  parseInt(parts.find(p => p.type === 'year')!.value, 10),
    month: parseInt(parts.find(p => p.type === 'month')!.value, 10),
    day:   parseInt(parts.find(p => p.type === 'day')!.value, 10),
  }
}

function getDateParts(date: Date, timezone: string): DateParts {
  const { year, month, day } = getLocalYMD(date, timezone)

  // Compute ISO week number without recursion
  const weekNumber = getIsoWeekNumber(date, timezone)
  const weekStr    = String(weekNumber).padStart(2, '0')

  return {
    year:  String(year),
    month: String(month).padStart(2, '0'),
    day:   String(day).padStart(2, '0'),
    weekStr,
  }
}

/**
 * Get the Monday of the ISO week containing `date` in the given timezone.
 * Uses getLocalYMD (not getDateParts) to avoid circular dependency.
 */
function getMondayOfWeek(date: Date, timezone: string): Date {
  const { year, month, day } = getLocalYMD(date, timezone)
  // Treat as UTC midnight of local date to compute day-of-week
  const localMidnight = new Date(Date.UTC(year, month - 1, day))
  const dow     = localMidnight.getUTCDay()   // 0=Sun, 1=Mon, …, 6=Sat
  const diffDays = (dow === 0) ? -6 : 1 - dow // ISO week: Monday = 1
  return new Date(localMidnight.getTime() + diffDays * 24 * 60 * 60 * 1000)
}

function getIsoWeekNumber(date: Date, timezone: string): number {
  const monday    = getMondayOfWeek(date, timezone)
  const yearStart = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1))
  const diffDays  = Math.floor((monday.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000))
  return Math.ceil((diffDays + yearStart.getUTCDay() + 1) / 7)
}

/**
 * Convert "YYYY-MM-DD" to midnight in the given timezone as UTC ISO string.
 * Uses UTC midnight as a stable representation; callers display in local time.
 */
function toLocalMidnightIso(dateStr: string, _timezone: string): string {
  // Return UTC midnight; downstream rendering uses the client's locale
  return `${dateStr}T00:00:00.000Z`
}

/**
 * ISO week date → Monday of that week (as UTC Date).
 * Week 1 = the week containing the first Thursday of the year.
 */
function isoWeekToDate(year: number, week: number): Date {
  // Jan 4 is always in week 1 of its year
  const jan4     = new Date(Date.UTC(year, 0, 4))
  const jan4Dow  = jan4.getUTCDay()
  const mon1     = new Date(jan4.getTime() - (jan4Dow === 0 ? 6 : jan4Dow - 1) * 24 * 60 * 60 * 1000)
  return new Date(mon1.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000)
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
