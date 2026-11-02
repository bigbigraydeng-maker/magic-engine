/**
 * Read-only planning context for next-week social scheduling.
 *
 * Aggregates T+72 post measurements, Tune-equivalent suggestions, and the
 * latest Facebook page rollup — no Meta calls, no plan writes, no LLM.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  evaluateCampaignPosts,
  type CampaignActionRow,
  type CampaignReceiptRow,
  type CampaignTuneSuggestions,
} from '@/lib/flywheel/tune/campaign-tune-suggestions'
import type { TuneDecision } from '@/lib/flywheel/tune/types'
import { SOCIAL_PUBLISH_ACTION_TYPE } from '@/lib/social/post-measurement-store'
import {
  buildPageLevel,
  readingFromReceipt,
  type PageMetricRow,
  type PublishActionRow,
  type Reading,
  type ReceiptRow,
} from '@/lib/social/post-performance'

export const UNREADABLE_DISPLAY = '没读到'
export const T72_WINDOW_HOURS = 72
const DAILY_PLAN_SOURCE = 'daily_plan'
const TUNE_ACTION_LIMIT = 50
const MAX_ACTION_ROWS = 200
const MAX_PAGE_METRIC_ROWS = 500

export interface MetricDisplay {
  display: string
  kind: 'value' | 'unreadable'
  reason?: string
}

export interface T72PostSnapshot {
  action_id: string
  idempotency_key: string | null
  source: string | null
  published_at: string | null
  receipt_status: string | null
  likes: MetricDisplay
  comments: MetricDisplay
  shares: MetricDisplay
}

export interface TuneDecisionCounts {
  REPEAT: number
  ITERATE: number
  STOP: number
  INCONCLUSIVE: number
  pending_t72: number
}

export interface TuneEntry {
  decision: TuneDecision | 'pending_t72'
  rationale: string
  display: string
}

export interface PageRollupMetrics {
  posts_7d: MetricDisplay
  reactions_7d: MetricDisplay
  comments_7d: MetricDisplay
  shares_7d: MetricDisplay
  days_since_last_post: MetricDisplay
  top_post_score: MetricDisplay
}

export interface SocialPlanningContext {
  client_id: string
  campaign_id: string | null
  window: { since: string; until: string }
  generated_at: string
  t72: {
    publish_action_count: number
    with_t72_receipt_count: number
    posts: T72PostSnapshot[]
  }
  tune: {
    available: boolean
    counts: TuneDecisionCounts
    by_idempotency_key: Record<string, TuneEntry>
  }
  page_rollup: {
    measured_at: string | null
    metrics: PageRollupMetrics
  }
}

export interface LoadSocialPlanningContextInput {
  clientId: string
  campaignId?: string | null
  since: Date
  until: Date
  now?: Date
}

const PAGE_ROLLUP_KEY_MAP: Record<keyof PageRollupMetrics, string> = {
  posts_7d: 'social.fb.posts_7d',
  reactions_7d: 'social.fb.reactions_7d',
  comments_7d: 'social.fb.comments_7d',
  shares_7d: 'social.fb.shares_7d',
  days_since_last_post: 'social.fb.days_since_last_post',
  top_post_score: 'social.fb.top_post_score',
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

export function readingToDisplay(reading: Reading): MetricDisplay {
  if (reading.kind === 'value') {
    return { display: String(reading.value), kind: 'value' }
  }
  return { display: UNREADABLE_DISPLAY, kind: 'unreadable', reason: reading.reason }
}

function emptyTuneCounts(): TuneDecisionCounts {
  return { REPEAT: 0, ITERATE: 0, STOP: 0, INCONCLUSIVE: 0, pending_t72: 0 }
}

function receiptAtWindow(receipts: ReceiptRow[], windowHours: number): ReceiptRow | null {
  for (const r of receipts) {
    if (r.window_hours === windowHours) return r
  }
  return null
}

function payloadString(payload: unknown, key: string): string | null {
  const rec = asRecord(payload)
  if (rec === null) return null
  const v = rec[key]
  return typeof v === 'string' ? v : null
}

export function buildT72PostSnapshots(
  actions: PublishActionRow[],
  receiptsByAction: Map<string, ReceiptRow[]>,
): { posts: T72PostSnapshot[]; withT72ReceiptCount: number } {
  const posts: T72PostSnapshot[] = []
  let withT72ReceiptCount = 0

  for (const action of actions) {
    const source = payloadString(action.payload, 'source')
    if (source === 'factory_reel') continue

    const allReceipts = receiptsByAction.get(action.id) ?? []
    const t72 = receiptAtWindow(allReceipts, T72_WINDOW_HOURS)
    if (t72 !== null) withT72ReceiptCount += 1

    posts.push({
      action_id: action.id,
      idempotency_key: payloadString(action.payload, 'idempotency_key'),
      source,
      published_at: payloadString(action.payload, 'published_at') ?? action.executed_at,
      receipt_status: t72?.status ?? null,
      likes: readingToDisplay(readingFromReceipt(t72, 'likes')),
      comments: readingToDisplay(readingFromReceipt(t72, 'comments')),
      shares: readingToDisplay(readingFromReceipt(t72, 'shares')),
    })
  }

  posts.sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : NaN
    const tb = b.published_at ? Date.parse(b.published_at) : NaN
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0
    if (!Number.isFinite(ta)) return 1
    if (!Number.isFinite(tb)) return -1
    return tb - ta
  })

  return { posts, withT72ReceiptCount }
}

export function summarizeTuneSuggestions(suggestions: CampaignTuneSuggestions): {
  counts: TuneDecisionCounts
  by_idempotency_key: Record<string, TuneEntry>
} {
  const counts = emptyTuneCounts()
  const by_idempotency_key: Record<string, TuneEntry> = {}

  for (const [key, rec] of Object.entries(suggestions)) {
    if (rec === null) {
      counts.pending_t72 += 1
      by_idempotency_key[key] = {
        decision: 'pending_t72',
        rationale: 'T+72 回执尚未就绪',
        display: UNREADABLE_DISPLAY,
      }
      continue
    }
    counts[rec.decision] += 1
    by_idempotency_key[key] = {
      decision: rec.decision,
      rationale: rec.rationale,
      display: rec.decision,
    }
  }

  return { counts, by_idempotency_key }
}

export function buildPageRollupSnapshot(pageMetrics: PageMetricRow[]): {
  measured_at: string | null
  metrics: PageRollupMetrics
} {
  const level = buildPageLevel(pageMetrics)
  const byKey = new Map(level.map((row) => [row.metric_key, row.reading]))
  let measured_at: string | null = null
  for (const row of level) {
    if (measured_at === null || Date.parse(row.measured_at) > Date.parse(measured_at)) {
      measured_at = row.measured_at
    }
  }

  const missing: Reading = { kind: 'not_readable', reason: 'no_snapshot' }
  const metrics = {} as PageRollupMetrics
  for (const [field, metricKey] of Object.entries(PAGE_ROLLUP_KEY_MAP) as [
    keyof PageRollupMetrics,
    string,
  ][]) {
    metrics[field] = readingToDisplay(byKey.get(metricKey) ?? missing)
  }

  return { measured_at, metrics }
}

export interface PlanningContextRows {
  clientId: string
  campaignId: string | null
  since: string
  until: string
  generatedAt: string
  windowActions: PublishActionRow[]
  receipts: ReceiptRow[]
  pageMetrics: PageMetricRow[]
  tuneActions: CampaignActionRow[]
  tuneReceipts: CampaignReceiptRow[]
}

export function buildSocialPlanningContextFromRows(input: PlanningContextRows): SocialPlanningContext {
  const receiptsByAction = new Map<string, ReceiptRow[]>()
  for (const r of input.receipts) {
    const list = receiptsByAction.get(r.action_id)
    if (list === undefined) receiptsByAction.set(r.action_id, [r])
    else list.push(r)
  }

  const { posts, withT72ReceiptCount } = buildT72PostSnapshots(input.windowActions, receiptsByAction)

  const tuneAvailable = input.campaignId !== null && input.campaignId.length > 0
  const tuneSuggestions = tuneAvailable
    ? evaluateCampaignPosts({ actions: input.tuneActions, receipts: input.tuneReceipts })
    : {}
  const tuneSummary = summarizeTuneSuggestions(tuneSuggestions)

  const page_rollup = buildPageRollupSnapshot(input.pageMetrics)

  return {
    client_id: input.clientId,
    campaign_id: input.campaignId,
    window: { since: input.since, until: input.until },
    generated_at: input.generatedAt,
    t72: {
      publish_action_count: posts.length,
      with_t72_receipt_count: withT72ReceiptCount,
      posts,
    },
    tune: {
      available: tuneAvailable,
      counts: tuneSummary.counts,
      by_idempotency_key: tuneSummary.by_idempotency_key,
    },
    page_rollup,
  }
}

function toRows<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return []
  return data
}

function assertNoError(table: string, error: { message: string } | null): void {
  if (error) throw new Error(`loadSocialPlanningContext: ${table} — ${error.message}`)
}

export function defaultPlanningWindow(now: Date): { since: Date; until: Date } {
  const until = now
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  return { since, until }
}

export async function loadSocialPlanningContext(
  supabase: SupabaseClient,
  input: LoadSocialPlanningContextInput,
): Promise<SocialPlanningContext> {
  const sinceIso = input.since.toISOString()
  const untilIso = input.until.toISOString()
  const generatedAt = (input.now ?? input.until).toISOString()
  const campaignId = input.campaignId ?? null

  const actionsPromise = supabase
    .from('flywheel_actions')
    .select('id, executed_at, payload')
    .eq('client_id', input.clientId)
    .eq('action_type', SOCIAL_PUBLISH_ACTION_TYPE)
    .gte('executed_at', sinceIso)
    .lte('executed_at', untilIso)
    .order('executed_at', { ascending: false })
    .limit(MAX_ACTION_ROWS)

  const pageMetricsPromise = supabase
    .from('flywheel_metrics')
    .select('metric_key, metric_value, measured_at')
    .eq('client_id', input.clientId)
    .like('metric_key', 'social.fb.%')
    .order('measured_at', { ascending: false })
    .limit(MAX_PAGE_METRIC_ROWS)

  const [actionsResult, pageMetricsResult] = await Promise.all([actionsPromise, pageMetricsPromise])
  assertNoError('flywheel_actions', actionsResult.error)
  assertNoError('flywheel_metrics', pageMetricsResult.error)

  const windowActions = toRows<PublishActionRow>(actionsResult.data)
  const pageMetrics = toRows<PageMetricRow>(pageMetricsResult.data)

  let receipts: ReceiptRow[] = []
  if (windowActions.length > 0) {
    const ids = windowActions.map((a) => a.id)
    const receiptsResult = await supabase
      .from('social_post_measurement_receipts')
      .select('action_id, window_hours, status, measured_at, values, missing, reason')
      .eq('client_id', input.clientId)
      .in('action_id', ids)

    assertNoError('social_post_measurement_receipts', receiptsResult.error)
    receipts = toRows<ReceiptRow>(receiptsResult.data)
  }

  let tuneActions: CampaignActionRow[] = []
  let tuneReceipts: CampaignReceiptRow[] = []

  if (campaignId) {
    const tuneActionsResult = await supabase
      .from('flywheel_actions')
      .select('id, payload')
      .eq('client_id', input.clientId)
      .eq('action_type', SOCIAL_PUBLISH_ACTION_TYPE)
      .eq('payload->>source', DAILY_PLAN_SOURCE)
      .eq('payload->>campaign_id', campaignId)
      .order('executed_at', { ascending: false, nullsFirst: false })
      .limit(TUNE_ACTION_LIMIT)

    assertNoError('flywheel_actions (tune)', tuneActionsResult.error)

    for (const row of toRows<{ id: string; payload: unknown }>(tuneActionsResult.data)) {
      const key = payloadString(row.payload, 'idempotency_key')
      if (key === null || key.length === 0) continue
      tuneActions.push({ id: row.id, idempotencyKey: key })
    }

    if (tuneActions.length > 0) {
      const tuneIds = tuneActions.map((a) => a.id)
      const tuneReceiptsResult = await supabase
        .from('social_post_measurement_receipts')
        .select('action_id, window_hours, status, values, missing')
        .in('action_id', tuneIds)
        .eq('window_hours', T72_WINDOW_HOURS)

      assertNoError('social_post_measurement_receipts (tune)', tuneReceiptsResult.error)

      tuneReceipts = toRows<{
        action_id: string
        window_hours: number
        status: string
        values: unknown
        missing: unknown
      }>(tuneReceiptsResult.data).map((r) => ({
        actionId: r.action_id,
        windowHours: r.window_hours,
        status: r.status,
        values: r.values,
        missing: r.missing,
      }))
    }
  }

  return buildSocialPlanningContextFromRows({
    clientId: input.clientId,
    campaignId,
    since: sinceIso,
    until: untilIso,
    generatedAt,
    windowActions,
    receipts,
    pageMetrics,
    tuneActions,
    tuneReceipts,
  })
}
