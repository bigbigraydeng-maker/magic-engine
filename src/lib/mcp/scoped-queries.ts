/**
 * MCP scoped queries — the innermost client_id isolation layer (Phase 34 /
 * P34.4). 子牙 B5 + 魏征: tool callbacks MUST go through createScopedQueries
 * and NEVER call supabaseAdmin directly with an ad-hoc clientId. Every method
 * here closes over the bound clientId and forces .eq('client_id', clientId),
 * so "forgetting to scope" is impossible by construction — this is the single
 * chokepoint that satisfies CLAUDE.md "校验放最里层、无 API 绕过".
 *
 * Read-only. Returns column subsets deliberately (never select('*')) so
 * internal fields (cost_usd, model_used, internal flags) never reach clients.
 * Vendor-name scrubbing of the final payload is layered on in P34.5.
 */
import { supabaseAdmin } from '@/lib/supabase'

const SEO_DEFAULT_LIMIT = 6
const SEO_MAX_LIMIT = 24
const TRAFFIC_DEFAULT_LIMIT = 6
const TRAFFIC_MAX_LIMIT = 24

export interface SeoSnapshot {
  site_url: string
  period_start: string
  period_end: string
  total_clicks: number
  total_impressions: number
  avg_ctr: number
  avg_position: number
  top_queries: unknown
  top_pages: unknown
}

export interface OverviewResult {
  diagnostic: {
    overall_score: number | null
    dimension_scores: unknown
    findings_count: number | null
    critical_count: number | null
    high_count: number | null
    completed_at: string | null
  } | null
  content: { blog_published: number; social_delivered: number }
}

export interface GoalSummary {
  id: string
  title: string
  status: string
  primary_metric_label: string | null
  baseline_value: number | null
  current_value: number | null
  target_value: number | null
  target_direction: string | null
  verdict: string | null
  period_start: string | null
  period_end: string | null
}

export interface GoalDetail extends GoalSummary {
  intent: string | null
  primary_metric_unit: string | null
  supporting_metrics: unknown
  current_value_source: string | null
  current_value_fetched_at: string | null
  verdict_summary: string | null
}

export type SeoResult =
  | { status: 'pending_sync'; message: string }
  | { status: 'ok'; snapshots: SeoSnapshot[] }

export interface TrafficSnapshot {
  property_id: string | null
  period_start: string
  period_end: string
  total_sessions: number
  total_users: number
  total_new_users: number
  total_pageviews: number
  avg_session_duration: number
  bounce_rate: number
  top_pages: unknown
  top_sources: unknown
}

export type TrafficResult =
  | { status: 'pending_sync'; message: string }
  | { status: 'ok'; snapshots: TrafficSnapshot[] }

export type ExecutionByDimension = Record<
  string,
  Array<{ id: string; title: string; status: string; due_date: string | null }>
>

export interface ScopedQueries {
  getOverview(): Promise<OverviewResult>
  listGoals(status?: string): Promise<GoalSummary[]>
  getGoalDetail(goalId: string): Promise<GoalDetail | null>
  getSeoPerformance(limit?: number): Promise<SeoResult>
  getTraffic(limit?: number): Promise<TrafficResult>
  listExecutionItems(): Promise<ExecutionByDimension>
}

export function createScopedQueries(clientId: string): ScopedQueries {
  // Defence in depth: the route already derives clientId from the API key via
  // requireMeClientId (which throws on missing). Re-check here so this module
  // is safe in isolation and unit tests catch any future misuse.
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new Error('createScopedQueries requires a non-empty clientId')
  }
  return {
    getOverview: () => getOverview(clientId),
    listGoals: (status?: string) => listGoals(clientId, status),
    getGoalDetail: (goalId: string) => getGoalDetail(clientId, goalId),
    getSeoPerformance: (limit?: number) => getSeoPerformance(clientId, limit),
    getTraffic: (limit?: number) => getTraffic(clientId, limit),
    listExecutionItems: () => listExecutionItems(clientId),
  }
}

async function getOverview(clientId: string): Promise<OverviewResult> {
  const [diag, blog, social] = await Promise.all([
    supabaseAdmin
      .from('diagnostic_runs')
      .select(
        'overall_score, dimension_scores, findings_count, critical_count, high_count, completed_at',
      )
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'published'),
    supabaseAdmin
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('status', ['approved', 'published', 'scheduled']),
  ])

  return {
    diagnostic: diag.data ?? null,
    content: {
      blog_published: blog.count ?? 0,
      social_delivered: social.count ?? 0,
    },
  }
}

async function listGoals(clientId: string, status?: string): Promise<GoalSummary[]> {
  let query = supabaseAdmin
    .from('goals')
    .select(
      'id, title, status, primary_metric_label, baseline_value, current_value, ' +
        'target_value, target_direction, verdict, period_start, period_end',
    )
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data } = await query
  return (data ?? []) as GoalSummary[]
}

async function getGoalDetail(clientId: string, goalId: string): Promise<GoalDetail | null> {
  const { data } = await supabaseAdmin
    .from('goals')
    .select(
      'id, title, status, intent, primary_metric_label, primary_metric_unit, ' +
        'baseline_value, current_value, target_value, target_direction, verdict, ' +
        'verdict_summary, supporting_metrics, current_value_source, ' +
        'current_value_fetched_at, period_start, period_end',
    )
    .eq('client_id', clientId)
    .eq('id', goalId)
    .maybeSingle()

  return (data as GoalDetail | null) ?? null
}

async function getSeoPerformance(clientId: string, limit?: number): Promise<SeoResult> {
  const capped = Math.min(Math.max(1, limit ?? SEO_DEFAULT_LIMIT), SEO_MAX_LIMIT)
  const { data } = await supabaseAdmin
    .from('gsc_performance_snapshots')
    .select(
      'site_url, period_start, period_end, total_clicks, total_impressions, ' +
        'avg_ctr, avg_position, top_queries, top_pages',
    )
    .eq('client_id', clientId)
    .order('period_end', { ascending: false })
    .limit(capped)

  if (!data || data.length === 0) {
    return {
      status: 'pending_sync',
      message:
        'Search performance data is not available yet. Google Search Console ' +
        'data syncs daily; the first snapshot appears after the next sync.',
    }
  }
  return { status: 'ok', snapshots: data as SeoSnapshot[] }
}

// NOTE: the admin cross-client path keeps a byte-for-byte copy of this query
// (it cannot import this module — reverse isolation lock). Keep them in sync.
async function getTraffic(clientId: string, limit?: number): Promise<TrafficResult> {
  const capped = Math.min(Math.max(1, limit ?? TRAFFIC_DEFAULT_LIMIT), TRAFFIC_MAX_LIMIT)
  const { data } = await supabaseAdmin
    .from('ga4_traffic_snapshots')
    .select(
      'property_id, period_start, period_end, total_sessions, total_users, ' +
        'total_new_users, total_pageviews, avg_session_duration, bounce_rate, ' +
        'top_pages, top_sources',
    )
    .eq('client_id', clientId)
    .order('period_end', { ascending: false })
    .limit(capped)

  if (!data || data.length === 0) {
    return {
      status: 'pending_sync',
      message:
        'Website traffic data is not available yet. Google Analytics 4 data ' +
        'syncs daily; the first snapshot appears after the next sync.',
    }
  }
  return { status: 'ok', snapshots: data as TrafficSnapshot[] }
}

async function listExecutionItems(clientId: string): Promise<ExecutionByDimension> {
  const { data } = await supabaseAdmin
    .from('execution_items')
    .select('id, title, status, dimension, due_date')
    .eq('client_id', clientId)
    .neq('status', 'skipped')
    .order('sort_order', { ascending: true })

  const grouped: ExecutionByDimension = {}
  for (const row of data ?? []) {
    const dim = (row.dimension as string) ?? 'other'
    if (!grouped[dim]) grouped[dim] = []
    grouped[dim].push({
      id: row.id as string,
      title: row.title as string,
      status: row.status as string,
      due_date: (row.due_date as string | null) ?? null,
    })
  }
  return grouped
}
