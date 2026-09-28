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
 *   - Conclusiveness (succeeded vs failed) reuses `isRunConclusive` from
 *     `run-conclusive.ts` — the same predicate `monthly-aggregator.ts` and
 *     the orchestrator's own snapshot gate use. A row can fail two different
 *     ways: the provider call itself errored (`error_message`), or the
 *     provider answered but our parser couldn't extract a ranking
 *     (`parse_error_message`, `error_message` stays null). Codex review
 *     2026-09-28 caught that the first cut only checked `error_message`,
 *     so a client whose every probe hit a parse failure would be counted
 *     as 100% "succeeded" — the exact blind spot this module exists to close.
 *   - Reminder cadence uses `shouldRemindToday` / `streakPhrase` from
 *     `remind-cadence.ts` — never 7-day multiples, because pm-daily-todo
 *     skips Fri/Sat (render.yaml `0 19 * * 0-4`).
 *   - Streak detection looks back 28 days (4 weekly cycles) to catch
 *     clients who have been silently broken for weeks.
 *   - Fix guidance is picked per AI engine (openai/google/anthropic/
 *     perplexity), not hardcoded to OpenAI — Codex review 2026-09-28: a
 *     Google-only failure used to send the PM to fix an unrelated OpenAI
 *     key. `ai_engine` is read off the row and carried through bucketing.
 *   - A bare "429"/"rate limit" no longer routes to the "go pay" guide —
 *     only account-level evidence (credits/insufficient_quota/billing)
 *     does. Matches `provider-failure.ts`'s rule: a transient rate limit
 *     retries itself; treating it as quota-exhausted sends the PM on a
 *     wasted errand (Codex review 2026-09-28).
 *   - Only alerts for clients in the active roster passed in by the caller
 *     — matches the boundary every other per-client todo in this file uses
 *     (Codex review 2026-09-28: a churned client's old failures shouldn't
 *     keep generating todos).
 *
 * Known gap (not fixed here, tracked in the ledger card for this PR):
 *   when the DB insert itself fails for every probe in a week (see
 *   `orchestrator.ts` processOne's `insertErr` branch), no row lands in
 *   `ai_visibility_runs` at all — this module has nothing to read and
 *   stays silent. Detecting that needs a second data source (a
 *   per-client batch/cron receipt), which is a bigger change than this
 *   PR's scope.
 *
 * Related but separate:
 *   - task_26fcf406: supplier-level outage ledger (whole-platform, not per-client)
 *   - task_f601353e: mention rate denominator fix (scoring, not detection)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import type { ClientRow } from './client-roster'
import { shouldRemindToday, streakPhrase } from './remind-cadence'
import { fetchAll } from '@/lib/supabase-paginate'
import { isRunConclusive } from '@/lib/ai-tracker/run-conclusive'

// ─── Error bucketing ────────────────────────────────────────────────────────

/** One failed run's error, carrying which engine produced it. */
interface ErrorEntry {
  engine: string
  message: string | null
  /** True when the provider call succeeded but our own parser threw. */
  isParseError: boolean
}

/** Bucket failed runs into human-readable categories, tracking the dominant engine per bucket. */
interface ErrorBucket {
  /** Stable key for the bucket. */
  key: string
  /** Human-readable Chinese label. */
  label: string
  /** Count of runs in this bucket. */
  count: number
  /** Engine that appears most often within this bucket — used to route fix guidance. */
  topEngine: string
}

/**
 * Categorise a single failed run into a bucket key.
 *
 * Fail-closed: anything we don't recognise goes into 'unknown'.
 * Keep in sync with real production error messages observed in
 * ai_visibility_runs.error_message.
 */
function classifyError(entry: ErrorEntry): string {
  if (entry.isParseError) return 'parse_error'
  const msg = entry.message
  if (!msg) return 'unknown'
  const lower = msg.toLowerCase()

  // Account-level exhaustion — only clear evidence, never a bare 429/"rate limit"
  // (that's `rate_limited` below: transient, the SDK retries it on its own).
  // Mirrors provider-failure.ts's ACCOUNT_LEVEL_CODES allowlist rule.
  if (
    lower.includes('credits remaining') ||
    lower.includes('insufficient_quota') ||
    lower.includes('billing_hard_limit') ||
    lower.includes('billing_not_active') ||
    lower.includes('account_deactivated') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('no credits')
  ) {
    return 'quota_exhausted'
  }

  // Transient rate limiting — SDK retries, don't send the PM to pay.
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'rate_limited'
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
  rate_limited: '暂时被限流',
  auth_failed: '授权失效',
  provider_error: '供应商内部出错',
  parse_error: 'AI 回了但解析不出排名',
  db_error: '数据库写入失败',
  unknown: '未知原因',
}

/**
 * Bucket an array of failed-run errors into human-readable categories.
 * Sorted by count descending. Each bucket records its most common engine
 * so the caller can route fix guidance to the right provider.
 */
export function bucketErrors(entries: ErrorEntry[]): ErrorBucket[] {
  const counts = new Map<string, number>()
  const engineCounts = new Map<string, Map<string, number>>()
  for (const entry of entries) {
    const key = classifyError(entry)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    let perEngine = engineCounts.get(key)
    if (!perEngine) {
      perEngine = new Map()
      engineCounts.set(key, perEngine)
    }
    perEngine.set(entry.engine, (perEngine.get(entry.engine) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => {
      const perEngine = engineCounts.get(key)!
      const topEngine = [...perEngine.entries()].sort((a, b) => b[1] - a[1])[0]![0]
      return { key, label: BUCKET_LABELS[key] ?? key, count, topEngine }
    })
}

/** One-line summary: "余额/配额用完×12, 供应商内部出错×6" */
export function summariseRunFailures(buckets: ErrorBucket[]): string {
  return buckets.map((b) => `${b.label}×${b.count}`).join(', ')
}

// ─── "How to fix" guide keyed by top error bucket (+ engine where it matters) ──

/** Account-exhaustion / key-invalid guidance genuinely differs per provider. */
const ENGINE_FIX: Record<string, Record<string, { how: string; href: string }>> = {
  quota_exhausted: {
    openai: {
      how: '打开链接 → 给 OpenAI 充值（这把钥匙全站 AI 在用，包括写内容、做体检、读通话记录）。充完回我一句，我把被跳过的 AI 可见度体检重跑',
      href: 'https://platform.openai.com/settings/organization/billing/overview',
    },
    google: {
      how: '打开链接 → 查 Gemini 这把钥匙的用量/配额是不是到顶了。充完/调完额度回我一句，我把被跳过的 AI 可见度体检重跑',
      href: 'https://aistudio.google.com/apikey',
    },
    anthropic: {
      how: '打开链接 → 给 Claude 这把钥匙充值。充完回我一句，我把被跳过的 AI 可见度体检重跑',
      href: 'https://console.anthropic.com/settings/billing',
    },
    perplexity: {
      how: '打开链接 → 给 Perplexity 这把钥匙充值。充完回我一句，我把被跳过的 AI 可见度体检重跑',
      href: 'https://www.perplexity.ai/settings/api',
    },
  },
  auth_failed: {
    openai: {
      how: '打开链接 → 看 OpenAI 的 API Key 是不是被禁用或者过期了。如果需要换钥匙，**别贴聊天里**，直接去 Render 后台换 OPENAI_API_KEY。换完回我一句',
      href: 'https://platform.openai.com/api-keys',
    },
    google: {
      how: '打开链接 → 看 Gemini 的 API Key 是不是被禁用或者过期了。如果需要换钥匙，**别贴聊天里**，直接去 Render 后台换 GEMINI_API_KEY。换完回我一句',
      href: 'https://aistudio.google.com/apikey',
    },
    anthropic: {
      how: '打开链接 → 看 Claude 的 API Key 是不是被禁用或者过期了。如果需要换钥匙，**别贴聊天里**，直接去 Render 后台换 ANTHROPIC_API_KEY。换完回我一句',
      href: 'https://console.anthropic.com/settings/keys',
    },
    perplexity: {
      how: '打开链接 → 看 Perplexity 的 API Key 是不是被禁用或者过期了。如果需要换钥匙，**别贴聊天里**，直接去 Render 后台换 PERPLEXITY_API_KEY。换完回我一句',
      href: 'https://www.perplexity.ai/settings/api',
    },
  },
}

/** Categories where the fix doesn't depend on which provider failed — usually not the PM's job. */
const GENERIC_FIX: Record<string, { how: string; href: string }> = {
  rate_limited: {
    how: '这条不用你动手 —— 目前看起来只是暂时被限流，程序会自动重试。如果连着好几天都这样，回我一句「查一下 AI 限流」',
    href: '',
  },
  provider_error: {
    how: '这条不用你动手 —— 是 AI 供应商自己出了问题（服务器报错）。等它恢复后我会自动重跑。如果连着好几天都这样，回我一句「查一下 AI 供应商」',
    href: '',
  },
  parse_error: {
    how: '这条不用你动手 —— AI 回复了，但我们的程序解析不出排名结果，可能是它换了回复格式。回我一句「查一下 AI 解析失败」我就去修',
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

function fixGuideFor(bucket: ErrorBucket): { how: string; href: string } {
  const perEngine = ENGINE_FIX[bucket.key]
  if (perEngine) {
    return perEngine[bucket.topEngine] ?? DEFAULT_FIX
  }
  return GENERIC_FIX[bucket.key] ?? DEFAULT_FIX
}

// ─── Core query and item builder ────────────────────────────────────────────

/** Shape of a single run row from the query. */
interface RunRow {
  client_id: string
  ai_engine: string
  error_message: string | null
  parse_error_message: string | null
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
 *
 * 🔴 Uses `fetchAll` to paginate past PostgREST's 1000-row hard cap.
 *    Without it, 7+ active clients × 24 runs/week × 4 weeks = 672+ rows,
 *    and adding a third engine or more queries pushes past 1000, silently
 *    dropping the oldest weeks — exactly the data the streak calculation needs.
 *    子牙 + 魏征 both flagged this in review (2026-09-23).
 */
export async function readRecentAiTrackerRuns(
  supabase: SupabaseClient,
  now: Date,
): Promise<AiTrackerRunQuery> {
  const since = new Date(now.getTime() - 28 * 86_400_000).toISOString()
  try {
    const rows = await fetchAll<RunRow>((from, to) =>
      supabase
        .from('ai_visibility_runs')
        .select('client_id, ai_engine, error_message, parse_error_message, ran_at')
        .gte('ran_at', since)
        .order('ran_at', { ascending: false })
        .range(from, to),
    )
    return { rows, error: null }
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Group runs by client and ISO week, returning per-week success/failure counts.
 *
 * Conclusiveness reuses `isRunConclusive` (shared with the orchestrator's own
 * snapshot gate and monthly-aggregator.ts) — a run only counts as "succeeded"
 * when the provider call worked AND our parser could read a ranking out of it.
 */
interface ClientWeekStats {
  weekKey: string // 'YYYY-MM-DD' (Monday of the week)
  total: number
  succeeded: number
  failed: number
  errors: ErrorEntry[]
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
      stats = { weekKey, total: 0, succeeded: 0, failed: 0, errors: [], latestRanAt: row.ran_at }
      clientMap.set(weekKey, stats)
    }
    stats.total++
    if (row.ran_at > stats.latestRanAt) stats.latestRanAt = row.ran_at
    if (isRunConclusive(row)) {
      stats.succeeded++
    } else {
      stats.failed++
      stats.errors.push({
        engine: row.ai_engine,
        message: row.error_message,
        isParseError: !row.error_message && !!row.parse_error_message,
      })
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
 *
 * `activeClientIds` scopes alerts to the current active roster, matching the
 * boundary every other per-client todo in this file uses — a client whose
 * service was stopped shouldn't keep generating todos off old failed runs.
 * Pass `null` to skip the filter (used by the infra-read-error path, and by
 * tests that don't care about roster scoping).
 */
export function buildAiTrackerFailureItems(
  query: AiTrackerRunQuery,
  clientNames: ClientNameMap,
  now: Date,
  activeClientIds: Set<string> | null = null,
): ManualItem[] {
  const items: ManualItem[] = []

  // If we can't even read the data, make that visible too. Uses the dev-owned
  // `ai_alerting_broken` kind (not `ai_tracker_all_failed`) — the text says
  // "this isn't your job", so it must land in the dev lane, not the PM's
  // action-required count (Codex review 2026-09-28).
  if (query.error) {
    items.push({
      kind: 'ai_alerting_broken',
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
    if (activeClientIds && !activeClientIds.has(clientId)) continue
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
    // 🔴 weeks-as-days: works because daily thresholds (≤1, ≤3) map to weekly
    //    semantics. If remind-cadence.ts thresholds change, recheck this mapping.
    if (!shouldRemindToday(streak, weeksSinceLatest, now)) continue

    const clientName = clientNames.get(clientId) ?? clientId.slice(0, 8)
    const buckets = bucketErrors(latestWeek.errors)
    const errorSummary = summariseRunFailures(buckets)
    const topBucket = buckets[0]
    const guide = topBucket ? fixGuideFor(topBucket) : DEFAULT_FIX
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
 *
 * `clients` is the same active-roster Map every other per-client pusher in
 * `infraPushers`/`clientPushers` receives — reused here (not re-queried) both
 * for client names and to scope alerts to clients still in service.
 */
export async function pushAiTrackerFailureItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  clients: Map<string, ClientRow>,
): Promise<void> {
  const query = await readRecentAiTrackerRuns(supabase, now)
  const clientNames: ClientNameMap = new Map(
    [...clients.entries()].map(([id, row]) => [id, row.name]),
  )
  items.push(...buildAiTrackerFailureItems(query, clientNames, now, new Set(clients.keys())))
}
