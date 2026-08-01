/**
 * GSC Attribution Bridge — P17.A.4
 *
 * Scores SEO work against Google Search Console snapshots.
 *
 * Algorithm (one pass per client):
 *   1. Load every flywheel_action with flywheel='seo'.
 *   2. Classify each one — only REAL WEBSITE CHANGES are scored
 *      (see action-classifier.ts). Recommendation cards, audits, documents,
 *      other channels and Magic Engine dev chores are excluded.
 *   3. Collapse to ONE scored action per calendar day. Everything published on
 *      the same day shares the same before/after snapshots, so scoring each
 *      action separately just repeats one measurement N times.
 *   4. baseline = latest snapshot ending on or before the action date.
 *      after    = first snapshot ending at least `maturationDays` after the
 *                 action date, and no later than `maxWindowDays` after it.
 *   5. Write outcomes for clicks and impressions (scoring), plus avg_position
 *      as a NON-SCORING context row.
 *
 * Why avg_position no longer decides anything
 * -------------------------------------------
 * Site-wide average position mechanically gets worse whenever you publish: new
 * pages enter the average at rank 40+. Oztop's impressions grew 6,928 → 9,112
 * over the same period its average position "fell" 18.3 → 24.4, and the old
 * code recorded that as 29 SEO failures. A metric that punishes publishing
 * cannot be a verdict on publishing. The number is still recorded and shown —
 * it is written with verdict 'inconclusive' and confidence 0 so it can never be
 * counted as a success or a failure, by this job or by anything learning from
 * flywheel_outcomes.
 *
 * Reference: ROADMAP.md P17.A.4
 */

import { supabaseAdmin } from '@/lib/supabase'
import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { computeVerdict } from './job'
import { classifyAction, type ActionCategory } from './action-classifier'
import { getAttributionWindow, addDaysIso, daysBetween } from './windows'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscSnapshotRow {
  period_end:        string
  total_clicks:      number
  total_impressions: number
  avg_position:      number
}

interface SeoActionRow {
  id:          string
  client_id:   string
  action_type: string
  payload:     Record<string, unknown> | null
  executed_at: string
}

export interface GscAttributionResult {
  client_id:        string
  actions_found:    number
  /** Actions that survived classification (real website changes). */
  eligible_actions: number
  /** Excluded action counts keyed by category, e.g. { recommendation: 57 }. */
  excluded:         Partial<Record<ActionCategory, number>>
  /** Action types that matched no rule — surfaced so they can be triaged. */
  unclassified_types: string[]
  /** Eligible actions dropped because another action already covers that day. */
  same_day_collapsed: number
  outcomes_written: number
  /** Days that had an eligible action but no usable snapshot pair yet. */
  skipped:          number
  errors:           string[]
}

/** Metric keys written for context only — never a success/failure signal. */
export const NON_SCORING_METRIC_KEYS: readonly string[] = [
  SEO_METRIC_KEY.GSC_AVG_POSITION,
]

const GSC_METRIC_KEYS = [
  SEO_METRIC_KEY.GSC_CLICKS,
  SEO_METRIC_KEY.GSC_IMPRESSIONS,
  SEO_METRIC_KEY.GSC_AVG_POSITION,
]

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run GSC attribution for all SEO actions for a given client.
 *
 * @param clientId               Target client
 * @param maxWindowDaysOverride  Optional override for how far out a reading is
 *   still accepted. Defaults to the SEO channel window (90 days). The maturation
 *   lag is not overridable — it is a property of the 28-day snapshot format.
 */
export async function runGscAttributionForClient(
  clientId: string,
  maxWindowDaysOverride?: number,
): Promise<GscAttributionResult> {
  const result: GscAttributionResult = {
    client_id:          clientId,
    actions_found:      0,
    eligible_actions:   0,
    excluded:           {},
    unclassified_types: [],
    same_day_collapsed: 0,
    outcomes_written:   0,
    skipped:            0,
    errors:             [],
  }

  const seoWindow  = getAttributionWindow('seo')
  const maturation = seoWindow.maturationDays
  const maxWindow  = maxWindowDaysOverride ?? seoWindow.maxWindowDays

  const { data: actions, error: actionsErr } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, action_type, payload, executed_at')
    .eq('client_id', clientId)
    .eq('flywheel', 'seo')
    .order('executed_at', { ascending: true })

  if (actionsErr) {
    result.errors.push(`Failed to load SEO actions: ${actionsErr.message}`)
    return result
  }

  if (!actions?.length) return result
  result.actions_found = actions.length

  // ── Step 1: keep only real website changes ─────────────────────────────────
  const eligible: SeoActionRow[] = []
  const unclassified = new Set<string>()

  for (const raw of actions as SeoActionRow[]) {
    const verdict = classifyAction({ action_type: raw.action_type, payload: raw.payload })
    if (verdict.eligible) {
      eligible.push(raw)
      continue
    }
    result.excluded[verdict.category] = (result.excluded[verdict.category] ?? 0) + 1
    if (verdict.category === 'unclassified') unclassified.add(raw.action_type)
  }

  result.eligible_actions   = eligible.length
  result.unclassified_types = [...unclassified].sort()

  // ── Step 2: one scored action per calendar day ─────────────────────────────
  const representatives = pickDailyRepresentatives(eligible)
  result.same_day_collapsed = eligible.length - representatives.length

  // ── Step 3: build every outcome row before touching the table ──────────────
  const rows: Array<Record<string, unknown>> = []

  for (const action of representatives) {
    try {
      const built = await buildRowsForAction(action, maturation, maxWindow)
      if (built.length) rows.push(...built)
      else result.skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`action ${action.id}: ${msg}`)
      result.skipped++
    }
  }

  // ── Step 4: replace this client's GSC outcomes ─────────────────────────────
  // A full replace (rather than per-action upsert) is what removes rows that are
  // now stale: excluded action types, same-day duplicates, and outcomes whose
  // action no longer qualifies. Rows are computed first so a read failure never
  // leaves the scoreboard empty.
  //
  // Guard: wiping everything is only safe when we either have replacement rows
  // or a clean run that legitimately produced none (all actions still too early).
  // "Nothing to write AND something errored" means the reads failed — keep the
  // existing scoreboard rather than blanking the client's results.
  if (rows.length === 0 && result.errors.length > 0) return result

  const { error: deleteErr } = await supabaseAdmin
    .from('flywheel_outcomes')
    .delete()
    .eq('client_id', clientId)
    .in('metric_key', GSC_METRIC_KEYS)

  if (deleteErr) {
    result.errors.push(`clear stale outcomes: ${deleteErr.message}`)
    return result
  }

  if (rows.length) {
    const { error: insertErr } = await supabaseAdmin.from('flywheel_outcomes').insert(rows)
    if (insertErr) {
      result.errors.push(`insert outcomes: ${insertErr.message}`)
      return result
    }
    result.outcomes_written = rows.length
  }

  return result
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Collapse actions to one per calendar day (UTC).
 *
 * The representative is the EARLIEST action of that day, tie-broken by id, so
 * the choice is deterministic and stable across reruns.
 *
 * Exported for testing.
 */
export function pickDailyRepresentatives<T extends { id: string; executed_at: string }>(
  actions: T[],
): T[] {
  const byDay = new Map<string, T>()

  for (const action of actions) {
    const day = action.executed_at.slice(0, 10)
    const current = byDay.get(day)
    if (!current) {
      byDay.set(day, action)
      continue
    }
    const isEarlier =
      action.executed_at < current.executed_at ||
      (action.executed_at === current.executed_at && action.id < current.id)
    if (isEarlier) byDay.set(day, action)
  }

  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, action]) => action)
}

async function buildRowsForAction(
  action: SeoActionRow,
  maturationDays: number,
  maxWindowDays: number,
): Promise<Array<Record<string, unknown>>> {
  const executedAt    = action.executed_at
  const earliestAfter = addDaysIso(executedAt, maturationDays)
  const latestAfter   = addDaysIso(executedAt, maxWindowDays)

  const [baseline, after] = await Promise.all([
    fetchBaselineSnapshot(action.client_id, executedAt),
    fetchAfterSnapshot(action.client_id, earliestAfter, latestAfter),
  ])

  if (!baseline || !after) return []

  // Truthful window: how many days actually elapsed, not a config constant.
  const actualWindowDays = daysBetween(executedAt, after.period_end)

  return buildOutcomeRows(action, baseline, after, actualWindowDays)
}

/** Latest snapshot whose window closed on or before the action date. */
async function fetchBaselineSnapshot(
  clientId: string,
  dateStr: string,
): Promise<GscSnapshotRow | null> {
  const { data, error } = await supabaseAdmin
    .from('gsc_performance_snapshots')
    .select('period_end, total_clicks, total_impressions, avg_position')
    .eq('client_id', clientId)
    .lte('period_end', dateStr.slice(0, 10))
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[gsc-bridge] baseline snapshot error:', error.message)
    return null
  }
  return data as GscSnapshotRow | null
}

/**
 * First snapshot inside the measurement window.
 *
 * Bounded on BOTH sides: `earliest` enforces the maturation lag (never score a
 * page Google has not settled on yet) and `latest` stops us reaching for a
 * reading so far out it measures something else entirely. Taking the first
 * qualifying snapshot rather than the newest keeps the measurement horizon
 * comparable across actions.
 */
async function fetchAfterSnapshot(
  clientId: string,
  earliest: string,
  latest: string,
): Promise<GscSnapshotRow | null> {
  const { data, error } = await supabaseAdmin
    .from('gsc_performance_snapshots')
    .select('period_end, total_clicks, total_impressions, avg_position')
    .eq('client_id', clientId)
    .gte('period_end', earliest)
    .lte('period_end', latest)
    .order('period_end', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[gsc-bridge] after snapshot error:', error.message)
    return null
  }
  return data as GscSnapshotRow | null
}

export function buildOutcomeRows(
  action: { id: string; client_id: string },
  baseline: GscSnapshotRow,
  after: GscSnapshotRow,
  windowDays: number,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString()

  const scoring = [
    {
      metricKey:   SEO_METRIC_KEY.GSC_CLICKS,
      baselineVal: baseline.total_clicks,
      afterVal:    after.total_clicks,
    },
    {
      metricKey:   SEO_METRIC_KEY.GSC_IMPRESSIONS,
      baselineVal: baseline.total_impressions,
      afterVal:    after.total_impressions,
    },
  ].map(dim => {
    const delta    = round2(dim.afterVal - dim.baselineVal)
    const deltaPct = dim.baselineVal !== 0 ? round2((delta / Math.abs(dim.baselineVal)) * 100) : null
    const { verdict, confidence } = computeVerdict(delta, deltaPct, 1)

    return {
      action_id:   action.id,
      client_id:   action.client_id,
      metric_key:  dim.metricKey,
      baseline:    dim.baselineVal,
      after_value: dim.afterVal,
      delta,
      delta_pct:   deltaPct,
      confidence,
      verdict,
      window_days: windowDays,
      computed_at: now,
    }
  })

  // Context row: recorded and displayable, but never a verdict.
  // Delta stays flipped so "positive = rank improved" still reads correctly.
  const positionDelta = round2(baseline.avg_position - after.avg_position)
  const positionPct =
    baseline.avg_position !== 0
      ? round2((positionDelta / Math.abs(baseline.avg_position)) * 100)
      : null

  const contextRow = {
    action_id:   action.id,
    client_id:   action.client_id,
    metric_key:  SEO_METRIC_KEY.GSC_AVG_POSITION,
    baseline:    baseline.avg_position,
    after_value: after.avg_position,
    delta:       positionDelta,
    delta_pct:   positionPct,
    confidence:  0,
    verdict:     'inconclusive' as const,
    window_days: windowDays,
    computed_at: now,
  }

  return [...scoring, contextRow]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
