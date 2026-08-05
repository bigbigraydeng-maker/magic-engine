/**
 * GSC Attribution Bridge — P17.A.4
 *
 * Computes flywheel attribution for SEO actions using Google Search Console
 * snapshot data as the signal source (instead of the generic flywheel_metrics).
 *
 * Algorithm per SEO action:
 *   baseline = most recent gsc_performance_snapshots where period_end <= executed_at
 *   after    = most recent gsc_performance_snapshots where period_end >= executed_at + window_days
 *
 * Writes three flywheel_outcomes rows per action:
 *   seo.gsc.clicks      → after.total_clicks - baseline.total_clicks
 *   seo.gsc.impressions → after.total_impressions - baseline.total_impressions
 *   seo.gsc.avg_position → baseline.avg_position - after.avg_position
 *                          (inverted: lower position number = better, so improvement = positive delta)
 *
 * Reference: ROADMAP.md P17.A.4
 */

import { supabaseAdmin } from '@/lib/supabase'
import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { computeVerdict } from './job'
import {
  findGscPage,
  resolveGscAttributionScope,
  type GscPagePerformance,
} from './gsc-page-scope'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscSnapshotRow {
  period_end:        string
  total_clicks:      number
  total_impressions: number
  avg_position:      number
  top_pages:         GscPagePerformance[] | null
}

interface SeoActionRow {
  id:              string
  client_id:       string
  executed_at:     string
  action_type:     string
  expected_metric: string | null
  payload:         Record<string, unknown> | null
}

export interface GscAttributionResult {
  client_id:        string
  actions_found:    number
  outcomes_written: number
  skipped:          number
  errors:           string[]
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run GSC attribution for all SEO actions for a given client.
 *
 * @param clientId   Target client
 * @param windowDays Days after action to look for the "after" snapshot (default 28)
 */
export async function runGscAttributionForClient(
  clientId: string,
  windowDays: number = 28,
): Promise<GscAttributionResult> {
  const result: GscAttributionResult = {
    client_id:        clientId,
    actions_found:    0,
    outcomes_written: 0,
    skipped:          0,
    errors:           [],
  }

  // Load all SEO flywheel actions for this client
  const { data: actions, error: actionsErr } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, executed_at, action_type, expected_metric, payload')
    .eq('client_id', clientId)
    .eq('flywheel', 'seo')
    .not('expected_metric', 'is', null)
    .order('executed_at', { ascending: false })

  if (actionsErr) {
    result.errors.push(`Failed to load SEO actions: ${actionsErr.message}`)
    return result
  }

  if (!actions?.length) return result

  result.actions_found = actions.length

  for (const action of actions as SeoActionRow[]) {
    try {
      const written = await attributeAction(action, windowDays)
      if (written > 0) result.outcomes_written += written
      else result.skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`action ${action.id}: ${msg}`)
      result.skipped++
    }
  }

  return result
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function attributeAction(
  action: SeoActionRow,
  windowDays: number,
): Promise<number> {
  const scope = resolveGscAttributionScope(action)
  if (scope.kind === 'skip') return 0

  const executedAt  = action.executed_at
  const windowEnd   = addDays(executedAt, windowDays)

  const [baseline, after] = await Promise.all([
    fetchGscSnapshot(action.client_id, 'before', executedAt),
    fetchGscSnapshot(action.client_id, 'after',  windowEnd),
  ])

  // Need both snapshots to compute attribution
  if (!baseline || !after) return 0

  const domainMetricKeys = [
    SEO_METRIC_KEY.GSC_CLICKS,
    SEO_METRIC_KEY.GSC_IMPRESSIONS,
    SEO_METRIC_KEY.GSC_AVG_POSITION,
  ]
  const pageMetricKeys = [
    SEO_METRIC_KEY.GSC_PAGE_CLICKS,
    SEO_METRIC_KEY.GSC_PAGE_IMPRESSIONS,
    SEO_METRIC_KEY.GSC_PAGE_AVG_POSITION,
  ]
  // Include legacy domain keys when a page action becomes live. This cleans up
  // any outcome written by the old ungated bridge while its PR was still open.
  const metricKeys =
    scope.kind === 'page' ? [...domainMetricKeys, ...pageMetricKeys] : domainMetricKeys

  // Delete any existing GSC outcomes for this action (idempotent)
  await supabaseAdmin
    .from('flywheel_outcomes')
    .delete()
    .eq('action_id', action.id)
    .in('metric_key', metricKeys)

  const rows =
    scope.kind === 'page'
      ? buildPageOutcomeRows(action, baseline, after, scope.pageUrl, windowDays)
      : buildOutcomeRows(action, baseline, after, windowDays)

  if (rows.length === 0) return 0

  const { error } = await supabaseAdmin.from('flywheel_outcomes').insert(rows)
  if (error) throw new Error(`insert outcomes: ${error.message}`)

  return rows.length
}

async function fetchGscSnapshot(
  clientId: string,
  direction: 'before' | 'after',
  dateStr: string,
): Promise<GscSnapshotRow | null> {
  let query = supabaseAdmin
    .from('gsc_performance_snapshots')
    .select('period_end, total_clicks, total_impressions, avg_position, top_pages')
    .eq('client_id', clientId)

  if (direction === 'before') {
    // Most recent snapshot whose period_end is before or on the action date
    query = query.lte('period_end', dateStr).order('period_end', { ascending: false })
  } else {
    // Most recent snapshot whose period_end is at least window_days after the action
    query = query.gte('period_end', dateStr).order('period_end', { ascending: true })
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.warn(`[gsc-bridge] fetchGscSnapshot(${direction}) error:`, error.message)
    return null
  }

  return data as GscSnapshotRow | null
}

function buildOutcomeRows(
  action: SeoActionRow,
  baseline: GscSnapshotRow,
  after: GscSnapshotRow,
  windowDays: number,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString()

  const dimensions: Array<{
    metricKey: string
    baselineVal: number
    afterVal: number
    expectedDelta: number | null
  }> = [
    {
      metricKey:     SEO_METRIC_KEY.GSC_CLICKS,
      baselineVal:   baseline.total_clicks,
      afterVal:      after.total_clicks,
      expectedDelta: 1, // expect clicks to increase
    },
    {
      metricKey:     SEO_METRIC_KEY.GSC_IMPRESSIONS,
      baselineVal:   baseline.total_impressions,
      afterVal:      after.total_impressions,
      expectedDelta: 1, // expect impressions to increase
    },
    {
      // avg_position: lower number = better rank.
      // We flip the delta so positive delta = improvement:
      //   baseline_position=10, after_position=8 → delta = 10-8 = +2 (improvement)
      metricKey:     SEO_METRIC_KEY.GSC_AVG_POSITION,
      baselineVal:   baseline.avg_position,
      afterVal:      after.avg_position,
      expectedDelta: 1, // expect position to improve (numeric delta will be positive when it does)
    },
  ]

  return dimensions.map(dim => {
    // For position: delta = baseline - after (positive = rank improved)
    // For clicks/impressions: delta = after - baseline (positive = growth)
    const delta =
      dim.metricKey === SEO_METRIC_KEY.GSC_AVG_POSITION
        ? round2(dim.baselineVal - dim.afterVal)
        : round2(dim.afterVal - dim.baselineVal)

    const deltaPct =
      dim.baselineVal !== 0 ? round2((delta / Math.abs(dim.baselineVal)) * 100) : null

    const { verdict, confidence } = computeVerdict(delta, deltaPct, dim.expectedDelta)

    return {
      action_id:   action.id,
      client_id:   action.client_id,
      metric_key:  dim.metricKey,
      baseline:    dim.metricKey === SEO_METRIC_KEY.GSC_AVG_POSITION
                     ? dim.baselineVal
                     : dim.baselineVal,
      after_value: dim.afterVal,
      delta,
      delta_pct:   deltaPct,
      confidence,
      verdict,
      window_days: windowDays,
      computed_at: now,
    }
  })
}

function buildPageOutcomeRows(
  action: SeoActionRow,
  baseline: GscSnapshotRow,
  after: GscSnapshotRow,
  pageUrl: string,
  windowDays: number,
): Array<Record<string, unknown>> {
  const baselinePage = findGscPage(baseline.top_pages, pageUrl)
  const afterPage = findGscPage(after.top_pages, pageUrl)
  if (!baselinePage || !afterPage) return []

  const now = new Date().toISOString()
  const dimensions = [
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_CLICKS,
      baselineVal: baselinePage.clicks,
      afterVal: afterPage.clicks,
      invertDelta: false,
    },
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_IMPRESSIONS,
      baselineVal: baselinePage.impressions,
      afterVal: afterPage.impressions,
      invertDelta: false,
    },
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_AVG_POSITION,
      baselineVal: baselinePage.position,
      afterVal: afterPage.position,
      invertDelta: true,
    },
  ]

  return dimensions.map((dim) => {
    const delta = round2(
      dim.invertDelta
        ? dim.baselineVal - dim.afterVal
        : dim.afterVal - dim.baselineVal,
    )
    const deltaPct =
      dim.baselineVal !== 0 ? round2((delta / Math.abs(dim.baselineVal)) * 100) : null
    const { verdict, confidence } = computeVerdict(delta, deltaPct, 1)

    return {
      action_id: action.id,
      client_id: action.client_id,
      metric_key: dim.metricKey,
      baseline: dim.baselineVal,
      after_value: dim.afterVal,
      delta,
      delta_pct: deltaPct,
      confidence,
      verdict,
      window_days: windowDays,
      computed_at: now,
    }
  })
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
