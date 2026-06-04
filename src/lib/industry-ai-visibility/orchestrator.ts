/**
 * Industry AI Visibility — orchestrator.
 *
 * Public function: runCollection() — runs a batch of (active) questions
 * against the requested platforms, persists snapshots, and writes a
 * `industry_ai_visibility_runs` row.
 *
 * Cost discipline:
 *   - ChatGPT call: 1 OpenAI request per question.
 *   - Google AI Overview + Google SERP: SHARED 1 DataForSEO request per
 *     question (returns both surfaces) — never re-issued.
 *   - Failure of one (question, platform) does NOT abort the whole batch.
 *   - Each snapshot row carries collection_run_id for tracing.
 *   - First successful collection locks question_text (sets locked_at).
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  collectChatGPT,
  collectQuestionGooglePair,
} from './collector'
import type {
  CollectionResult,
  Platform,
  Question,
  RunSummary,
} from './types'

// ─── Time helpers ────────────────────────────────────────────────────────────
function isoWeekStart(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dow = d.getUTCDay() || 7  // Sunday = 7
  if (dow !== 1) d.setUTCDate(d.getUTCDate() - (dow - 1))
  return d.toISOString().slice(0, 10)
}

/** UTC date string (YYYY-MM-DD). Used as the primary collected_date axis. */
function utcDate(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RunCollectionOptions {
  industries?: string[]
  platforms?: Platform[]
  /** Limit to N questions (for testing). */
  limit?: number
  triggeredBy: 'cron' | 'admin_manual'
  triggeredByUser?: string
  /**
   * Hotfix (魏征 P0): when provided, runCollection() uses this existing run_id
   * instead of inserting a new run row. The API route uses this to create the
   * row up-front, return the run_id to the client, then fire-and-forget the
   * collection — guaranteeing only one row per logical run.
   */
  existingRunId?: string
}

/**
 * Hotfix helper — create a fresh run row and return its id. Use this from
 * API routes that want to return 202 + run_id immediately, then call
 * runCollection({ ..., existingRunId }) in the background.
 *
 * 魏征 Hotfix-7: when the partial unique index `iav_runs_single_in_flight`
 * rejects the INSERT (because a stale 'running' row still occupies it),
 * we sweep stale rows in-place and retry once. This makes the API resilient
 * to serverless workers being killed mid-collection without forcing the
 * caller to wait for the 5-min sweeper threshold.
 */
const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000 // 5 min — 魏征 Hotfix-7 (was 10 min)
const UNIQUE_VIOLATION_CODE = '23505'

async function sweepStaleRunningRows(): Promise<number> {
  const cutoffIso = new Date(Date.now() - STALE_RUN_THRESHOLD_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('industry_ai_visibility_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: `Stuck in running > 5 min — auto-cleared by createRunRow retry path`,
    })
    .eq('status', 'running')
    .lt('started_at', cutoffIso)
    .select('id')
  if (error) {
    console.error('[orchestrator/createRunRow.sweep] failed:', error)
    return 0
  }
  return (data ?? []).length
}

async function insertRunRow(opts: {
  industries?: string[]
  platforms?: Platform[]
  triggeredBy: 'cron' | 'admin_manual'
  triggeredByUser?: string
}): Promise<{ data: { id: string } | null; error: { code?: string; message: string } | null }> {
  const platforms: Platform[] = opts.platforms ?? ['chatgpt', 'google_ai_overview', 'google_serp']
  const weekOf = isoWeekStart()
  const { data, error } = await supabaseAdmin
    .from('industry_ai_visibility_runs')
    .insert({
      week_of: weekOf,
      status: 'running',
      industries_scope: opts.industries ?? null,
      platforms_scope:  platforms,
      triggered_by:     opts.triggeredBy,
      triggered_by_user: opts.triggeredByUser ?? null,
    })
    .select('id')
    .single()
  return { data: data as { id: string } | null, error: error as { code?: string; message: string } | null }
}

export async function createRunRow(opts: {
  industries?: string[]
  platforms?: Platform[]
  triggeredBy: 'cron' | 'admin_manual'
  triggeredByUser?: string
}): Promise<string> {
  // 1st attempt
  const first = await insertRunRow(opts)
  if (first.data) return first.data.id

  // 魏征 Hotfix-7: if the partial unique index rejected us (code 23505),
  // sweep stale rows and retry exactly once. This handles the race where
  // a serverless worker died mid-collection but the 5-min sweeper window
  // hasn't elapsed yet.
  if (first.error?.code === UNIQUE_VIOLATION_CODE) {
    const swept = await sweepStaleRunningRows()
    console.warn(`[orchestrator/createRunRow] unique violation, swept ${swept} stale row(s), retrying`)
    const retry = await insertRunRow(opts)
    if (retry.data) return retry.data.id
    throw new Error(
      `Failed to create run row after stale-row sweep: ${retry.error?.message ?? 'unknown'}. ` +
      `Another collection is still genuinely in-flight; wait a few seconds and try again.`,
    )
  }

  throw new Error(`Failed to create run row: ${first.error?.message ?? 'unknown'}`)
}

export async function runCollection(opts: RunCollectionOptions): Promise<RunSummary> {
  const startedAt = Date.now()
  const platforms: Platform[] = opts.platforms ?? ['chatgpt', 'google_ai_overview', 'google_serp']
  // weekOf: kept for backward-compat rollups (legacy column).
  // collectedDate: the real primary key dimension since migration
  //   20260622000003_ai_visibility_daily_collection.sql (PM decision 2026-06-04).
  const weekOf        = isoWeekStart()
  const collectedDate = utcDate()

  // 1. Use existing run_id if caller pre-created one (魏征 P0 fix), else create
  let runId: string
  if (opts.existingRunId) {
    runId = opts.existingRunId
  } else {
    const { data: runRow, error: runErr } = await supabaseAdmin
      .from('industry_ai_visibility_runs')
      .insert({
        week_of: weekOf,
        status: 'running',
        industries_scope: opts.industries ?? null,
        platforms_scope:  platforms,
        triggered_by:     opts.triggeredBy,
        triggered_by_user: opts.triggeredByUser ?? null,
      })
      .select('id')
      .single()
    if (runErr || !runRow) {
      throw new Error(`Failed to create run row: ${runErr?.message}`)
    }
    runId = runRow.id as string
  }

  // 2. Load questions
  let qQuery = supabaseAdmin
    .from('industry_ai_visibility_questions')
    .select('*')
    .eq('is_active', true)
  if (opts.industries && opts.industries.length > 0) {
    qQuery = qQuery.in('industry_code', opts.industries)
  }
  if (opts.limit) qQuery = qQuery.limit(opts.limit)
  const { data: questions, error: qErr } = await qQuery

  if (qErr) {
    await markRunFailed(runId, qErr.message, startedAt)
    throw qErr
  }

  const qs = (questions ?? []) as Question[]

  // 3. Process each question
  let attempted = 0
  let ok = 0
  let failed = 0
  let partial = 0
  let snapshotsWritten = 0
  let totalCost = 0

  const wantsChatGPT       = platforms.includes('chatgpt')
  const wantsGoogleAI      = platforms.includes('google_ai_overview')
  const wantsGoogleSerp    = platforms.includes('google_serp')
  const wantsAnyDataForSeo = wantsGoogleAI || wantsGoogleSerp

  // H2 fix: wrap the main loop + finalize in try/catch so an uncaught error
  // mid-loop doesn't leave the run row stuck at status='running' forever.
  try {
  for (const q of qs) {
    attempted++

    // Per-question results, keyed by platform
    const results: Partial<Record<Platform, CollectionResult>> = {}

    // Fan out concurrently: ChatGPT + (single) DataForSEO pair
    const chatPromise = wantsChatGPT && q.platforms.includes('chatgpt')
      ? collectChatGPT(q)
      : null
    const pairPromise = wantsAnyDataForSeo && (q.platforms.includes('google_ai_overview') || q.platforms.includes('google_serp'))
      ? collectQuestionGooglePair(q)
      : null

    const [chatSettled, pairSettled] = await Promise.allSettled([
      chatPromise ?? Promise.resolve(null),
      pairPromise ?? Promise.resolve(null),
    ])

    if (chatPromise) {
      if (chatSettled.status === 'fulfilled' && chatSettled.value) {
        results.chatgpt = chatSettled.value
      } else if (chatSettled.status === 'rejected') {
        results.chatgpt = failureResult('chatgpt', String(chatSettled.reason))
      }
    }
    if (pairPromise) {
      if (pairSettled.status === 'fulfilled' && pairSettled.value) {
        if (wantsGoogleAI   && q.platforms.includes('google_ai_overview')) results.google_ai_overview = pairSettled.value.google_ai_overview
        if (wantsGoogleSerp && q.platforms.includes('google_serp'))        results.google_serp        = pairSettled.value.google_serp
      } else if (pairSettled.status === 'rejected') {
        const msg = String(pairSettled.reason)
        if (wantsGoogleAI)   results.google_ai_overview = failureResult('google_ai_overview', msg)
        if (wantsGoogleSerp) results.google_serp        = failureResult('google_serp', msg)
      }
    }

    // Persist snapshots
    const rowsToInsert: Array<Record<string, unknown>> = []
    let questionHadAnyOk = false
    let questionHadAnyFail = false

    for (const [platform, r] of Object.entries(results) as [Platform, CollectionResult][]) {
      rowsToInsert.push(snapshotRow(q.id, platform, weekOf, collectedDate, runId, r))
      if (r.ok) questionHadAnyOk = true
      else      questionHadAnyFail = true
      totalCost += r.cost_usd
    }

    if (rowsToInsert.length > 0) {
      // Upsert on (question_id, platform, collected_date) — see migration
      //   20260622000003_ai_visibility_daily_collection.sql
      // Re-runs within the same UTC day refresh the row; first run on a new
      // day appends a new row. This is what makes daily granularity work.
      const { error: upsertErr } = await supabaseAdmin
        .from('industry_ai_visibility_snapshots')
        .upsert(rowsToInsert, { onConflict: 'question_id,platform,collected_date' })
      if (upsertErr) {
        console.error(`Snapshot upsert failed for question ${q.id}:`, upsertErr)
        questionHadAnyFail = true
      } else {
        snapshotsWritten += rowsToInsert.length
      }
    }

    // Lock question on first ever successful collection
    if (questionHadAnyOk && !q.locked_at) {
      await supabaseAdmin
        .from('industry_ai_visibility_questions')
        .update({ locked_at: new Date().toISOString() })
        .eq('id', q.id)
    }

    // Track question outcome: all-ok, all-failed, or partial.
    if (questionHadAnyOk && !questionHadAnyFail) ok++
    else if (questionHadAnyFail && !questionHadAnyOk) failed++
    else if (questionHadAnyOk && questionHadAnyFail) partial++
  }

  } catch (loopErr) {
    // H2 fix: any unexpected error in the main loop → mark run as failed
    // (preserves whatever questions we already processed in the counters)
    const msg = loopErr instanceof Error ? loopErr.message : String(loopErr)
    await markRunFailed(runId, `Main loop error: ${msg}`, startedAt)
    throw loopErr
  }

  // 4. Finalize run row
  const durationSec = Math.round((Date.now() - startedAt) / 1000)
  // Status semantics:
  //   completed = every attempted question had ALL platforms succeed
  //   partial   = at least one question fully ok, OR some partial mixed-success questions
  //   failed    = no question had any successful platform
  const status: RunSummary['status'] =
    (failed === 0 && partial === 0 && ok > 0) ? 'completed' :
    (ok > 0 || partial > 0)                   ? 'partial'    : 'failed'

  // For DB columns we collapse partial into questions_ok (any platform OK)
  // to preserve the existing column semantics. The detailed completed/partial
  // split is reflected in the `status` column.
  const dbOk = ok + partial

  await supabaseAdmin
    .from('industry_ai_visibility_runs')
    .update({
      completed_at: new Date().toISOString(),
      status,
      questions_attempted: attempted,
      questions_ok: dbOk,
      questions_failed: failed,
      snapshots_written: snapshotsWritten,
      total_cost_usd: totalCost,
      duration_seconds: durationSec,
    })
    .eq('id', runId)

  return {
    run_id: runId,
    week_of: weekOf,
    questions_attempted: attempted,
    questions_ok: dbOk,
    questions_failed: failed,
    snapshots_written: snapshotsWritten,
    total_cost_usd: totalCost,
    duration_seconds: durationSec,
    status,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function snapshotRow(
  questionId: string,
  platform: Platform,
  weekOf: string,
  collectedDate: string,
  runId: string,
  r: CollectionResult,
): Record<string, unknown> {
  return {
    question_id: questionId,
    platform,
    week_of: weekOf,
    collected_date: collectedDate,
    collection_run_id: runId,
    raw_response: r.raw_response,
    brands_mentioned: r.brands_mentioned,
    top3_brands: r.top3_brands,
    ai_answer_text: r.ai_answer_text,
    ai_citation_sources: r.ai_citation_sources,
    serp_organic_top10: r.serp_organic_top10,
    serp_local_pack: r.serp_local_pack,
    serp_paid_domains: r.serp_paid_domains,
    serp_people_also_ask: r.serp_people_also_ask,
    model_version: r.model_version,
    tokens_used: r.tokens_used,
    cost_usd: r.cost_usd,
    parse_confidence: r.parse_confidence,
    error_code: r.error_code,
    error_message: r.error_message,
  }
}

function failureResult(platform: Platform, msg: string): CollectionResult {
  return {
    ok: false,
    raw_response: null,
    brands_mentioned: [],
    top3_brands: [],
    ai_answer_text: null,
    ai_citation_sources: null,
    serp_organic_top10: null,
    serp_local_pack: null,
    serp_paid_domains: null,
    serp_people_also_ask: null,
    model_version: platform === 'chatgpt' ? 'gpt-4o-mini' : 'dataforseo-serp-advanced',
    tokens_used: null,
    cost_usd: 0,
    parse_confidence: null,
    error_code: `${platform}_error`,
    error_message: msg,
  }
}

async function markRunFailed(runId: string, errMsg: string, startedAt: number) {
  await supabaseAdmin
    .from('industry_ai_visibility_runs')
    .update({
      completed_at: new Date().toISOString(),
      status: 'failed',
      error_message: errMsg,
      duration_seconds: Math.round((Date.now() - startedAt) / 1000),
    })
    .eq('id', runId)
}
