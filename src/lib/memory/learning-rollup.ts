/**
 * DAPE W3 — Weekly Agent Learning Rollup
 *
 * Aggregates the **past week** of flywheel outcomes + zhuge workbench feedback
 * into the learned-preferences memory layer so the next agent run can read
 * "what worked last week" without re-deriving everything from scratch.
 *
 * Why a separate weekly job (vs. memory-extractor which runs daily):
 *   - memory-extractor inspects every confirmed/reversed outcome individually
 *     and writes per-action patterns / experiments. It is correct but coarse:
 *     a single bad week never bubbles up as "this client doesn't like X".
 *   - learning-rollup runs once per ISO week and emits **summary preferences**
 *     ("FDE dismissed 8/10 SEO suggestions last week → de-prioritize this
 *     suggestion family") that capture *negative* signal which memory-extractor
 *     misses (extractor only learns from positive confirmed outcomes).
 *   - It also closes the loop on `zhuge_feedback_events` which spec §1.3
 *     flagged as "spent but never read".
 *
 * Design contract:
 *   - **Read-only on existing tables** — only writes to client_learned_preferences.
 *     Never touches zhuge_feedback_events, flywheel_* (狄仁杰: agent learning
 *     must not mutate execution truth).
 *   - **Idempotent** — re-running the same week is a no-op (we check for an
 *     existing rollup preference keyed by ISO-week + client_id).
 *   - **Single-source dedup** — `source='auto_extracted'` + `extracted_from_table
 *     ='learning_rollup_weekly'` + `extracted_from_id=<iso-week-key>::<client_id>`
 *     means a second run for the same week never double-writes.
 *   - **Per-client error isolation** — one client throwing doesn't kill the
 *     rest of the batch. Errors are accumulated and surfaced in the result.
 *   - **No CTS/Oztop data deletion** — we only INSERT into preferences; we
 *     never DELETE or UPDATE existing rows.
 *
 * Output: each client gets at most ONE new preference row per rollup, of the
 * form "本周 outcome 摘要: confirmed=X reversed=Y; FDE 反馈摘要: done=A
 * dismissed=B irrelevant=C; 建议 …". Lightweight, deterministic, no LLM calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { keepOneCasePerAction } from '@/lib/flywheel/attribution/outcome-identity'
import { savePreference } from './service'

// ── Public types ─────────────────────────────────────────────────────────────

export interface RollupResult {
  /** Client UUID being summarised. */
  client_id: string
  /** ISO-week key, e.g. '2026-W23'. Idempotency key root. */
  iso_week: string
  /** Confirmed outcomes in the window. */
  outcomes_confirmed: number
  /** Reversed outcomes in the window. */
  outcomes_reversed: number
  /** Inconclusive outcomes in the window. */
  outcomes_inconclusive: number
  /** Zhuge workbench feedback counts in the window. */
  feedback_done: number
  feedback_dismissed: number
  feedback_irrelevant: number
  /** True if a new preference row was inserted (vs. already existed). */
  preference_inserted: boolean
  /** Empty unless something went wrong while processing this client. */
  error: string | null
}

export interface RollupBatchResult {
  iso_week: string
  window_start: string
  window_end: string
  clients_processed: number
  preferences_inserted: number
  errors: number
  results: RollupResult[]
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the weekly rollup for every client that had **either** a flywheel
 * outcome or a zhuge feedback event in the window. Clients with no signal
 * are skipped — empty rollups are noise.
 */
export async function runWeeklyLearningRollup(
  supabase: SupabaseClient,
  options: { now?: Date } = {},
): Promise<RollupBatchResult> {
  const now = options.now ?? new Date()
  const { weekStart, weekEnd, isoWeek } = computeWeekWindow(now)

  // 1. Discover the set of clients with signal in the window. Two source
  //    tables; union the IDs so we cover both positive (outcomes) and
  //    negative (feedback dismissals) signal.
  const [outcomeClientsRes, feedbackClientsRes] = await Promise.all([
    supabase
      .from('flywheel_outcomes')
      // 跟下面 rollupOneClient 的取数用**同一个时间列**（见那里的长注释）。
      // 两处不一致不会写出错数（没信号的客户本来就不插记录），但会按「重算时间」
      // 把一批这一周其实没动过的客户捞进来各跑一次空查询 —— 白花钱，也让
      // `clients_processed` 这个数字不再代表「这一周真有活动的客户数」。
      .select('client_id, flywheel_actions!inner(executed_at)')
      .gte('flywheel_actions.executed_at', weekStart.toISOString())
      .lt('flywheel_actions.executed_at', weekEnd.toISOString()),
    supabase
      .from('zhuge_feedback_events')
      .select('client_id')
      .gte('created_at', weekStart.toISOString())
      .lt('created_at', weekEnd.toISOString()),
  ])

  const clientIds = new Set<string>()
  for (const row of outcomeClientsRes.data ?? []) {
    if (typeof row.client_id === 'string') clientIds.add(row.client_id)
  }
  for (const row of feedbackClientsRes.data ?? []) {
    if (typeof row.client_id === 'string') clientIds.add(row.client_id)
  }

  const results: RollupResult[] = []
  let preferencesInserted = 0
  let errors = 0

  for (const clientId of Array.from(clientIds)) {
    try {
      const r = await rollupOneClient(supabase, clientId, weekStart, weekEnd, isoWeek)
      results.push(r)
      if (r.preference_inserted) preferencesInserted++
      if (r.error) errors++
    } catch (err) {
      errors++
      results.push({
        client_id: clientId,
        iso_week: isoWeek,
        outcomes_confirmed: 0,
        outcomes_reversed: 0,
        outcomes_inconclusive: 0,
        feedback_done: 0,
        feedback_dismissed: 0,
        feedback_irrelevant: 0,
        preference_inserted: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    iso_week: isoWeek,
    window_start: weekStart.toISOString(),
    window_end: weekEnd.toISOString(),
    clients_processed: results.length,
    preferences_inserted: preferencesInserted,
    errors,
    results,
  }
}

// ── Per-client rollup ────────────────────────────────────────────────────────

/** flywheel_outcomes 一行 + 它所属动作承诺的指标（左连接，可能缺）。 */
interface RollupOutcomeRow {
  verdict?: unknown
  action_id?: unknown
  metric_key?: unknown
  window_days?: unknown
  flywheel_actions?: { expected_metric?: string | null } | Array<{ expected_metric?: string | null }> | null
}

/**
 * 把窗口内的 outcome 行折成「一个动作一个案例」，再去数 confirmed / reversed。
 *
 * 这段摘要会原样写进 client_learned_preferences.content，下一轮 agent 直接读。
 * 按行数数的话，一个 GSC 动作一次快照就出 clicks / impressions / avg_position
 * 三行，ATTRIBUTION_DUAL_WINDOW_ENABLED 打开后再翻倍 —— 于是「本周 confirmed=6」
 * 实际上可能只有一个动作跑赢。跟 aggregate / case-library / execution board 用
 * 同一把尺（`keepOneCasePerAction`），四处不会各说一套。
 *
 * 缺 action_id 的行（理论上不该有）按自己算一个案例，不因为折叠而被丢掉。
 */
function collapseOutcomesToActions(
  rows: RollupOutcomeRow[],
): Array<{ verdict: string }> {
  const collapsible: Array<{ action_id: string; metric_key: string; window_days: number | null; expected_metric: string | null; verdict: string }> = []
  const orphans: Array<{ verdict: string }> = []

  for (const r of rows) {
    const verdict = typeof r.verdict === 'string' ? r.verdict : ''
    if (typeof r.action_id !== 'string' || !r.action_id) {
      orphans.push({ verdict })
      continue
    }
    const joined = Array.isArray(r.flywheel_actions) ? r.flywheel_actions[0] : r.flywheel_actions
    collapsible.push({
      action_id: r.action_id,
      metric_key: typeof r.metric_key === 'string' ? r.metric_key : '',
      window_days: typeof r.window_days === 'number' ? r.window_days : null,
      expected_metric: joined?.expected_metric ?? null,
      verdict,
    })
  }

  return [
    ...keepOneCasePerAction(collapsible).map(r => ({ verdict: r.verdict })),
    ...orphans,
  ]
}

async function rollupOneClient(
  supabase: SupabaseClient,
  clientId: string,
  windowStart: Date,
  windowEnd: Date,
  isoWeek: string,
): Promise<RollupResult> {
  const startIso = windowStart.toISOString()
  const endIso = windowEnd.toISOString()
  const dedupKey = `${isoWeek}::${clientId}`

  // ── 1. Idempotency check — if we already wrote a rollup for this week,
  //      bail out with a no-op (still report the counts so callers see the
  //      window covered something).
  const { data: existing } = await supabase
    .from('client_learned_preferences')
    .select('id')
    .eq('client_id', clientId)
    .eq('source', 'auto_extracted')
    .eq('extracted_from_table', 'learning_rollup_weekly')
    .eq('extracted_from_id', dedupKey)
    .limit(1)

  const alreadyDone = (existing?.length ?? 0) > 0

  // ── 2. Aggregate outcomes in window.
  const [outcomesRes, feedbackRes] = await Promise.all([
    supabase
      .from('flywheel_outcomes')
      // action_id / metric_key / window_days 是折叠用的自然键，expected_metric
      // 决定折叠时挑哪一行当代表。
      //
      // 🔴 周窗口切在**动作执行时间**上，不是 outcome 的 `computed_at`。
      //    `computed_at` 是「最后一次被重算的时间」，attribution 每 6 小时把所有现役行
      //    刷成「现在」—— 生产实测（2026-09-06）：全表 336 行的 `computed_at` 只有 3 个
      //    取值，285 行全挤在最近那一轮。按它切周窗口，结果只有两种：**全部**或**零**。
      //    2026-08-31 那次周报的窗口（08-24~08-31）里一行都没有，整轮空转。
      //    `flywheel_actions.executed_at` 才是事件真正发生的时间（生产上分布在 18 个周）。
      //
      //    改成 `!inner` 的代价：动作记录不在了的孤儿 outcome 不再进这个查询。
      //    这不是行为退化 —— 没有 executed_at 的行本来就归不进任何一周，
      //    以前它能进来只是因为窗口切错了列。`collapseOutcomesToActions` 的孤儿分支
      //    保留作防御，但从这个查询已经不会再收到孤儿。
      .select('verdict, action_id, metric_key, window_days, flywheel_actions!inner(expected_metric, executed_at)')
      .eq('client_id', clientId)
      .gte('flywheel_actions.executed_at', startIso)
      .lt('flywheel_actions.executed_at', endIso),
    supabase
      .from('zhuge_feedback_events')
      .select('feedback_state')
      .eq('client_id', clientId)
      .gte('created_at', startIso)
      .lt('created_at', endIso),
  ])

  let confirmed = 0
  let reversed = 0
  let inconclusive = 0
  for (const o of collapseOutcomesToActions(outcomesRes.data ?? [])) {
    if (o.verdict === 'confirmed') confirmed++
    else if (o.verdict === 'reversed') reversed++
    else if (o.verdict === 'inconclusive') inconclusive++
  }

  let done = 0
  let dismissed = 0
  let irrelevant = 0
  for (const f of feedbackRes.data ?? []) {
    if (f.feedback_state === 'done') done++
    else if (f.feedback_state === 'dismissed') dismissed++
    else if (f.feedback_state === 'irrelevant') irrelevant++
  }

  const totalOutcomes = confirmed + reversed + inconclusive
  const totalFeedback = done + dismissed + irrelevant

  // ── 3. No-signal short-circuit. Don't emit a "0/0/0" preference: that
  //      poisons the prompt with noise.
  if (totalOutcomes === 0 && totalFeedback === 0) {
    return {
      client_id: clientId,
      iso_week: isoWeek,
      outcomes_confirmed: confirmed,
      outcomes_reversed: reversed,
      outcomes_inconclusive: inconclusive,
      feedback_done: done,
      feedback_dismissed: dismissed,
      feedback_irrelevant: irrelevant,
      preference_inserted: false,
      error: null,
    }
  }

  if (alreadyDone) {
    return {
      client_id: clientId,
      iso_week: isoWeek,
      outcomes_confirmed: confirmed,
      outcomes_reversed: reversed,
      outcomes_inconclusive: inconclusive,
      feedback_done: done,
      feedback_dismissed: dismissed,
      feedback_irrelevant: irrelevant,
      preference_inserted: false,
      error: null,
    }
  }

  // ── 4. Compose a short Chinese summary that will land in
  //      client_learned_preferences.content. The next agent run reads this via
  //      loadMemoryForClient → formatMemoryForPrompt and treats it as context.
  const content = composeSummaryLine({
    isoWeek,
    confirmed,
    reversed,
    inconclusive,
    done,
    dismissed,
    irrelevant,
  })

  // Confidence: higher when we saw more signal, capped at 0.85 so a single
  // noisy week never trumps long-running fde_annotation preferences (which
  // default to confidence_score=1.0).
  const signal = totalOutcomes + totalFeedback
  const confidence = Math.min(0.85, 0.5 + Math.log10(1 + signal) * 0.15)

  const saved = await savePreference(supabase, {
    client_id: clientId,
    preference_type: 'other',
    content,
    source: 'auto_extracted',
    confidence_score: Number(confidence.toFixed(2)),
    extracted_from_table: 'learning_rollup_weekly',
    extracted_from_id: dedupKey,
  })

  return {
    client_id: clientId,
    iso_week: isoWeek,
    outcomes_confirmed: confirmed,
    outcomes_reversed: reversed,
    outcomes_inconclusive: inconclusive,
    feedback_done: done,
    feedback_dismissed: dismissed,
    feedback_irrelevant: irrelevant,
    preference_inserted: saved != null,
    error: saved == null ? 'savePreference returned null' : null,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compose the one-line summary stored in client_learned_preferences.content.
 *
 * Format example:
 *   "[2026-W23] outcome 摘要: confirmed=3 reversed=1 inconclusive=2;
 *    工作台反馈: done=5 dismissed=2 irrelevant=1;
 *    建议: 优先保留已验证模式 (3 个 confirmed), FDE 标记 2 条无效建议待回访。"
 */
function composeSummaryLine(input: {
  isoWeek: string
  confirmed: number
  reversed: number
  inconclusive: number
  done: number
  dismissed: number
  irrelevant: number
}): string {
  const outcomePart = `outcome 摘要: confirmed=${input.confirmed} reversed=${input.reversed} inconclusive=${input.inconclusive}`
  const feedbackPart = `工作台反馈: done=${input.done} dismissed=${input.dismissed} irrelevant=${input.irrelevant}`

  const hints: string[] = []
  if (input.confirmed > 0) {
    hints.push(`优先保留已验证模式 (${input.confirmed} 个 confirmed)`)
  }
  if (input.reversed >= 2) {
    hints.push(`回查 ${input.reversed} 个反向 outcome 是否方向错误`)
  }
  if (input.dismissed + input.irrelevant >= 3) {
    hints.push(`FDE 标记 ${input.dismissed + input.irrelevant} 条无效建议, 下次降权`)
  }
  if (input.done >= 3) {
    hints.push(`FDE 完成 ${input.done} 条建议, 可加权同类推荐`)
  }
  const hintPart = hints.length > 0 ? `建议: ${hints.join(', ')}` : '建议: 信号不足, 继续观察'

  return `[${input.isoWeek}] ${outcomePart}; ${feedbackPart}; ${hintPart}`
}

/**
 * Compute the ISO-week window for `now`. Window covers the previous Monday
 * 00:00 UTC through this Monday 00:00 UTC (exclusive). This matches the
 * `agent-learning-rollup` cron schedule (`0 7 * * 1` = Monday 07:00 UTC), so
 * the cron always summarises the **just-completed** ISO week.
 *
 * isoWeek is the year-week string the previous Monday belongs to, e.g.
 * '2026-W23'.
 *
 * Exported for unit tests so they can pin a deterministic week.
 */
export function computeWeekWindow(now: Date): {
  weekStart: Date
  weekEnd: Date
  isoWeek: string
} {
  // Find the most recent Monday 00:00 UTC at-or-before `now`.
  const dayUtc = now.getUTCDay() // 0=Sun .. 6=Sat
  // Convert so Monday=0, Sun=6:
  const offsetToMonday = (dayUtc + 6) % 7
  const thisMonday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - offsetToMonday,
    0, 0, 0, 0,
  ))
  // The window covers the PREVIOUS week (Mon-prev → Mon-this).
  const weekStart = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000)
  const weekEnd = thisMonday

  const isoWeek = formatIsoWeek(weekStart)
  return { weekStart, weekEnd, isoWeek }
}

/**
 * Format a UTC date as ISO-week string `YYYY-Www`.
 * Follows ISO 8601: week 1 is the week containing the first Thursday.
 */
export function formatIsoWeek(d: Date): string {
  // Algorithm per https://en.wikipedia.org/wiki/ISO_week_date
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = target.getUTCDay() || 7 // Mon=1..Sun=7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum) // shift to Thursday of week
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
