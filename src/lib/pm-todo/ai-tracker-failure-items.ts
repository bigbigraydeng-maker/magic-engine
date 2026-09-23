/**
 * PM-visible todo item for "client AI visibility tracker all probes failed".
 *
 * Real-world incident (2026-09-20): East International had 24/24 probes fail
 * (Google = `[GoogleGenerativeAI Error]`, OpenAI = `429 You have no credits
 * remaining`), but looked identical to a healthy client with no topics. This
 * module ensures 100% failure rates surface in the daily todo email.
 *
 * Design choices:
 *   - Queries `ai_visibility_runs` directly (the run-level table), not
 *     `ai_visibility_snapshots` — because when all probes fail, no snapshot
 *     is created (orchestrator.ts ~line 138), so the snapshot table has no
 *     record of the failure at all.
 *   - Error bucketing follows `snapshot-conclusive.ts` fail-closed pattern:
 *     unknown error codes are treated as failures, not silent successes.
 *   - Reminder cadence uses `shouldRemindToday` / `streakPhrase` from
 *     `remind-cadence.ts` — never 7-day multiples, because pm-daily-todo
 *     skips Fri/Sat (render.yaml `0 19 * * 0-4`).
 *   - Streak detection looks back 28 days (4 weekly cycles) to catch
 *     clients who have been silently broken for weeks.
 *
 * Related but separate:
 *   - task_26fcf406: supplier-level outage ledger (whole-platform, not per-client)
 *   - task_f601353e: mention rate denominator fix (scoring, not detection)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { shouldRemindToday, streakPhrase } from './remind-cadence'

// ─── Error bucketing ────────────────────────────────────────────────────────

/** Bucket raw error_message strings into human-readable categories. */
interface ErrorBucket {
  /** Stable key for the bucket. */
  key: string
  /** Human-readable Chinese label. */
  label: string
  /** Count of runs in this bucket. */
  count: number
}

/**
 * Categorise a single error_message into a bucket key.
 *
 * Fail-closed: anything we don't recognise goes into 'unknown'.
 * Keep in sync with real production error messages observed in
 * ai_visibility_runs.error_message.
 */
function classifyErrorMessage(msg: string | null): string {
  if (!msg) return 'unknown'
  const lower = msg.toLowerCase()

  // Quota / billing
  if (
    lower.includes('credits remaining') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('insufficient_quota') ||
    lower.includes('billing')
  ) {
    return 'quota_exhausted'
  }

  // Authentication / authorization
  if (
    lower.includes('api key') ||
    lower.includes('api_key') ||
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    lower.includes('403') ||
    lower.includes('invalid_api_key') ||
    lower.includes('credential')
  ) {
    return 'auth_failed'
  }

  // Provider-side error (not our fault)
  if (
    lower.includes('generativeai error') ||
    lower.includes('internal server error') ||
    lower.includes('500') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('service unavailable') ||
    lower.includes('server error')
  ) {
    return 'provider_error'
  }

  // DB insert failures (our infra)
  if (lower.includes('db insert failed')) {
    return 'db_error'
  }

  return 'unknown'
}

const BUCKET_LABELS: Record<string, string> = {
  quota_exhausted: '余额/配额用完',
  auth_failed: '授权失效',
  provider_error: '供应商内部出错',
  db_error: '数据库写入失败',
  unknown: '未知原因',
}

/**
 * Bucket an array of error messages into human-readable categories.
 * Sorted by count descending.
 */
export function bucketErrors(messages: (string | null)[]): ErrorBucket[] {
  const counts = new Map<string, number>()
  for (const msg of messages) {
    const key = classifyErrorMessage(msg)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      key,
      label: BUCKET_LABELS[key] ?? key,
      count,
    }))
}

/** One-line summary: "余额/配额用完×12, 供应商内部出错×6" */
export function summariseRunFailures(buckets: ErrorBucket[]): string {
  return buckets.map((b) => `${b.label}×${b.count}`).join(', ')
}

// ─── "How to fix" guide keyed by top error bucket ───────────────────────────

const FIX_GUIDE: Record<string, { how: string; href: string }> = {
  quota_exhausted: {
    how: '打开链接 → 充值（这把钥匙全站 AI 在用，包括写内容、做体检、读通话记录）。充完回我一句，我把被跳过的 AI 可见度体检重跑',
    href: 'https://platform.openai.com/settings/organization/billing/overview',
  },
  auth_failed: {
    how: '打开链接 → 看 API Key 是不是被禁用或者过期了。如果需要换钥匙，**别贴聊天里**，直接去 Render 后台换 OPENAI_API_KEY。换完回我一句',
    href: 'https://platform.openai.com/api-keys',
  },
  provider_error: {
    how: '这条不用你动手 —— 是 AI 供应商自己出了问题（服务器报错）。等它恢复后我会自动重跑。如果连着好几天都这样，回我一句「查一下 AI 供应商」',
    href: '',
  },
  db_error: {
    how: '这条不用你动手 —— 是我们数据库那边写入出了问题。回我一句「修一下 AI 体检写入」我就去修',
    href: '',
  },
}

const DEFAULT_FIX = {
  how: '回我一句「查一下 AI 可见度为什么全挂了」，我去看是哪里出了问题',
  href: '',
}

// ─── Core query and item builder ────────────────────────────────────────────

/** Shape of a single run row from the query. */
interface RunRow {
  client_id: string
  error_message: string | null
  ran_at: string
}

/**
 * Shape returned by the reader function — allows injecting a test double
 * without importing SupabaseClient.
 */
export interface AiTrackerRunQuery {
  rows: RunRow[]
  error: string | null
}

/** Maps client_id -> client name for display. */
export type ClientNameMap = Map<string, string>

/**
 * Read recent AI tracker runs from the database.
 *
 * Looks back 28 days (4 weekly cycles) to detect long-running failures.
 * The weekly tracker runs once per week, so we need multiple weeks of data
 * to compute a streak.
 */
export async function readRecentAiTrackerRuns(
  supabase: SupabaseClient,
  now: Date,
): Promise<AiTrackerRunQuery> {
  const since = new Date(now.getTime() - 28 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('ai_visibility_runs')
    .select('client_id, error_message, ran_at')
    .gte('ran_at', since)
    .order('ran_at', { ascending: false })

  if (error) {
    return { rows: [], error: error.message }
  }
  return { rows: (data ?? []) as RunRow[], error: null }
}

/**
 * Group runs by client and ISO week, returning per-week success/failure counts.
 *
 * A run is "successful" when `error_message IS NULL` — matching the
 * orchestrator's convention (processOne sets error_message only on failure).
 */
interface ClientWeekStats {
  weekKey: string // 'YYYY-MM-DD' (Monday of the week)
  total: number
  succeeded: number
  failed: number
  errorMessages: (string | null)[]
  /** Most recent ran_at timestamp in this week's runs — used for freshness. */
  latestRanAt: string
}

/** Monday of the ISO week containing `date`. */
function mondayOf(date: Date): string {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = day === 0 ? 6 : day - 1 // Monday = 0 offset
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

function groupByClientWeek(
  rows: RunRow[],
): Map<string, ClientWeekStats[]> {
  // client_id -> weekKey -> stats
  const byClient = new Map<string, Map<string, ClientWeekStats>>()

  for (const row of rows) {
    const weekKey = mondayOf(new Date(row.ran_at))
    let clientMap = byClient.get(row.client_id)
    if (!clientMap) {
      clientMap = new Map()
      byClient.set(row.client_id, clientMap)
    }
    let stats = clientMap.get(weekKey)
    if (!stats) {
      stats = { weekKey, total: 0, succeeded: 0, failed: 0, errorMessages: [], latestRanAt: row.ran_at }
      clientMap.set(weekKey, stats)
    }
    stats.total++
    if (row.ran_at > stats.latestRanAt) stats.latestRanAt = row.ran_at
    if (row.error_message) {
      stats.failed++
      stats.errorMessages.push(row.error_message)
    } else {
      stats.succeeded++
    }
  }

  // Convert inner maps to sorted arrays (most recent week first)
  const result = new Map<string, ClientWeekStats[]>()
  for (const [clientId, weekMap] of byClient) {
    const weeks = [...weekMap.values()].sort((a, b) => b.weekKey.localeCompare(a.weekKey))
    result.set(clientId, weeks)
  }
  return result
}

/**
 * Build ManualItems for clients whose most recent AI tracker week had 0 successes.
 *
 * Pure function — fully unit-testable with injected data.
 */
export function buildAiTrackerFailureItems(
  query: AiTrackerRunQuery,
  clientNames: ClientNameMap,
  now: Date,
): ManualItem[] {
  const items: ManualItem[] = []

  // If we can't even read the data, make that visible too
  if (query.error) {
    items.push({
      kind: 'ai_tracker_all_failed',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `AI 可见度探测记录读不出来了（${query.error.slice(0, 160)}）—— 不报警不等于没事`,
      how: '这条不用你动手 —— 是我们这边的查询挂了。回我一句「修一下 AI 体检告警」我就去修',
      href: '',
    })
    return items
  }

  if (query.rows.length === 0) return items

  const byClientWeek = groupByClientWeek(query.rows)

  for (const [clientId, weeks] of byClientWeek) {
    if (weeks.length === 0) continue

    const latestWeek = weeks[0]!
    // Only alert when the most recent week has ZERO successes and at least one attempt
    if (latestWeek.succeeded > 0 || latestWeek.total === 0) continue

    // Streak: how many consecutive weeks (from most recent backwards) had 0 successes?
    let streak = 0
    for (const w of weeks) {
      if (w.succeeded === 0 && w.total > 0) streak++
      else break
    }

    // shouldRemindToday was designed for daily events. For weekly events, convert
    // both streak and daysSinceLatest to WEEKS so the thresholds map correctly:
    //   streak ≤ 3 weeks → remind every day todo runs (covers first detection window)
    //   streak > 3 weeks → remind only on anchor day (Sunday) to avoid stale noise
    //   weeksSinceLatest ≤ 1 → "fresh" (still within the current/next cycle)
    //   weeksSinceLatest 2-3 → "fresh" on anchor day only (GAP_CATCHUP_DAYS=3)
    //   weeksSinceLatest > 3 → stale, stop reminding
    const currentMonday = mondayOf(now)
    const latestMonday = latestWeek.weekKey
    const weeksSinceLatest =
      currentMonday === latestMonday
        ? 0
        : Math.floor(
            (new Date(currentMonday).getTime() - new Date(latestMonday).getTime()) /
              (7 * 86_400_000),
          )
    if (!shouldRemindToday(streak, weeksSinceLatest, now)) continue

    const clientName = clientNames.get(clientId) ?? clientId.slice(0, 8)
    const buckets = bucketErrors(latestWeek.errorMessages)
    const errorSummary = summariseRunFailures(buckets)
    const topBucket = buckets[0]?.key ?? 'unknown'
    const guide = FIX_GUIDE[topBucket] ?? DEFAULT_FIX
    const duration =
      streak <= 1
        ? '这周'
        : `已经连续 ${streak} 周`

    items.push({
      kind: 'ai_tracker_all_failed',
      client_id: clientId,
      client_name: clientName,
      what: `${duration}的 AI 可见度体检全挂了（${latestWeek.total} 条探测全部失败：${errorSummary}）—— 这个客户这周的 AI 可见度数据完全空白，看上去跟「没什么 AI 提到我们」一模一样，但其实是根本没测成`,
      how: guide.how,
      href: guide.href,
    })
  }

  return items
}

/**
 * Query + build in one call. Used by loadManualItems.
 *
 * Follows the same `.catch()` → `items.push()` pattern as other push*Items
 * functions in manual-items.ts.
 */
export async function pushAiTrackerFailureItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const query = await readRecentAiTrackerRuns(supabase, now)

  // Build a name map from clients table for any client_ids found in the runs.
  // This is a lightweight query — only fetches id+name, not the full roster.
  const clientIds = [...new Set(query.rows.map((r) => r.client_id))]
  const clientNames: ClientNameMap = new Map()
  if (clientIds.length > 0) {
    const { data } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', clientIds)
    for (const row of data ?? []) {
      clientNames.set((row as { id: string }).id, (row as { name: string }).name)
    }
  }

  items.push(...buildAiTrackerFailureItems(query, clientNames, now))
}
