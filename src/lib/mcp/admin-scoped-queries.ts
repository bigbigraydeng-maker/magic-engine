/**
 * MCP ADMIN cross-client queries (Phase 34 / P34-P3.5).
 *
 * ⛔ HARD RULE (子牙 "最大风险=复用诱惑" + 魏征 Y3, enforced by
 * __tests__/import-isolation.test.ts):
 *   This module MUST NOT import anything from `@/lib/mcp/scoped-queries`
 *   — not even types. scoped-queries is the client-only innermost isolation
 *   layer (client_id closure-bound). Admin is a SEPARATE physical path that
 *   takes client_id as an EXPLICIT argument (it is cross-client by design).
 *   SQL below is intentionally COPIED from scoped-queries, not imported.
 *   If you change a query here, check whether scoped-queries needs the same
 *   change too (SYNC WITH scoped-queries.ts) — but never link them in code.
 *
 * Read-only. Column subsets are explicit (never select('*')).
 */
import { supabaseAdmin } from '@/lib/supabase'

const SEO_DEFAULT_LIMIT = 6
const SEO_MAX_LIMIT = 24

// ── types (DUPLICATED from scoped-queries on purpose — SYNC WITH it) ────────
export interface ClientSummary {
  id: string
  name: string
  domain: string | null
  market: string | null
  created_at: string
}

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

export type SeoResult =
  | { status: 'pending_sync'; message: string }
  | { status: 'ok'; snapshots: SeoSnapshot[] }

export type ExecutionByDimension = Record<
  string,
  Array<{ id: string; title: string; status: string; due_date: string | null }>
>

export interface AdminQueries {
  listAllClients(): Promise<ClientSummary[]>
  getOverview(clientId: string): Promise<OverviewResult>
  listGoals(clientId: string, status?: string): Promise<GoalSummary[]>
  getSeoPerformance(clientId: string, limit?: number): Promise<SeoResult>
  listExecutionItems(clientId: string): Promise<ExecutionByDimension>
}

/**
 * Admin queries factory. UNLIKE createScopedQueries, there is NO closed-over
 * client_id — every per-client method takes clientId as an explicit argument,
 * because admin is cross-client by design.
 */
export function createAdminQueries(): AdminQueries {
  // Each query self-guards client_id at the innermost layer (狄仁杰: don't rely
  // only on the factory / tool-layer zod). requireClientId throws on empty.
  return {
    listAllClients,
    getOverview,
    listGoals,
    getSeoPerformance,
    listExecutionItems,
  }
}

function requireClientId(clientId: string): string {
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new Error('admin query requires a non-empty clientId argument')
  }
  return clientId
}

async function listAllClients(): Promise<ClientSummary[]> {
  // Minimal field set (魏征 Q6 — no portal emails / sensitive cols in the list).
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain, semrush_db, created_at')
    .order('name', { ascending: true })
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    domain: (r.domain as string | null) ?? null,
    market: (r.semrush_db as string | null) ?? null,
    created_at: r.created_at as string,
  }))
}

// SYNC WITH scoped-queries.ts getOverview
async function getOverview(clientId: string): Promise<OverviewResult> {
  requireClientId(clientId)
  const [diag, blog, social] = await Promise.all([
    supabaseAdmin
      .from('diagnostic_runs')
      .select('overall_score, dimension_scores, findings_count, critical_count, high_count, completed_at')
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
    content: { blog_published: blog.count ?? 0, social_delivered: social.count ?? 0 },
  }
}

// SYNC WITH scoped-queries.ts listGoals
async function listGoals(clientId: string, status?: string): Promise<GoalSummary[]> {
  requireClientId(clientId)
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

// SYNC WITH scoped-queries.ts getSeoPerformance
async function getSeoPerformance(clientId: string, limit?: number): Promise<SeoResult> {
  requireClientId(clientId)
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

// SYNC WITH scoped-queries.ts listExecutionItems
async function listExecutionItems(clientId: string): Promise<ExecutionByDimension> {
  requireClientId(clientId)
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
