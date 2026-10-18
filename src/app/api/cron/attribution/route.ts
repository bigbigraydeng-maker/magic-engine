import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  runAttributionJob,
  DEFAULT_WINDOW_DAYS,
  type AttributionJobResult,
} from '@/lib/flywheel/attribution/job'
import {
  runGscAttributionForClient,
  type GscAttributionResult,
} from '@/lib/flywheel/attribution/gsc-bridge'
import {
  dualWindowEnabled,
  resolveEffectiveWindow,
  type EffectiveWindow,
} from '@/lib/flywheel/attribution/dual-window-gate'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * POST /api/cron/attribution
 *
 * Runs the flywheel attribution job in two passes:
 *
 *   Pass 1 (original) — flywheel_metrics-based attribution:
 *     For every flywheel_action with an expected_metric, computes baseline /
 *     after / verdict and upserts into flywheel_outcomes.
 *
 *   Pass 2 (P17.A.4) — GSC-based attribution:
 *     For every client with a connected GSC connector, runs GSC attribution
 *     for all SEO flywheel actions (clicks / impressions / avg_position).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Schedule: every 6 hours (Render Cron)
 *
 * Query params (optional):
 *   window_days — override the default 14-day attribution window (pass 1)
 *   client_id   — restrict both passes to a single client
 *
 * Reference: ROADMAP.md P12.A.9 (pass 1), P17.A.4 (pass 2)
 */

// Attribution job may process many clients; allow up to 5 min.
export const maxDuration = 300

export interface AttributionCronResponse {
  timestamp: string
  processed: number
  written: number
  skipped: number
  /** Actions pass 1 handed to another evaluator because it does not own the metric. */
  deferred?: number
  /** Clients pass 2 must visit because pass 1 did not fully handle them. */
  pass2ClientIds?: string[]
  /** Pass-1 actions whose attribution threw (distinct from having no data yet). */
  failed?: number
  /** Actions no evaluator can attribute (metric owner cannot load their flywheel). */
  unattributable?: number
  /** A bounded sample of those action ids, for diagnosis. */
  unattributableSamples?: string[]
  /** Pass-1 reconciliation failures (claim / retire). Counted into cron `failed`. */
  reconcileErrors?: number
  /** A bounded sample of those messages, for diagnosis. */
  reconcileErrorSamples?: string[]
  /** The window pass 1 actually ran at. */
  window_days?: number
  /** Present when a caller-supplied window was declined by the dual-window gate. */
  window_override_refused?: { requested: number; used: number; reason: string }
  gsc?: {
    clients_processed: number
    actions_found: number
    outcomes_written: number
    skipped: number
    cleanup_errors: number
    /** Pre-write reconciliation failures — see GscAttributionResult. */
    reconcile_errors: number
    errors: string[]
  }
}

export interface ApiErrorResponse {
  error: string
}

interface GscPassResult {
  clients_processed: number
  actions_found: number
  outcomes_written: number
  skipped: number
  cleanup_errors: number
  reconcile_errors: number
  errors: string[]
}

/**
 * Pass 2 — GSC snapshot-based attribution (P17.A.4).
 *
 * Visits every client pass 1 deferred for, plus every client with a connected
 * GSC connector. A deferral is a promise: pass 1 declined those actions because
 * their answer is the GSC evaluator's to produce, so pass 2 must visit that
 * client even if their connector is currently disconnected — the bridge reads
 * historical `gsc_performance_snapshots`, not the connector, and with no usable
 * snapshot it skips harmlessly. The connector list is an optimisation for who
 * ELSE to visit, and its transient failure must neither hide the deferred
 * clients nor pass silently. (Codex P2, round 2 on PR #862.)
 *
 * Pass 1's effective window rides along: the deferred actions' answer at THAT
 * window is now the bridge's to produce. The bridge keeps its own 28-day
 * cadence (first arg left to its default) and computes the deferred window on
 * top, deduplicating when the two coincide. That handoff is GATED OFF in
 * production — the memory-side consumers still count rows, so enabling it would
 * double the evidence behind every deferred action and move client-visible
 * benchmarks. See dual-window-gate.ts.
 */
/**
 * Who pass 2 must visit: every client with a connected GSC connector, plus
 * every client pass 1 deferred for.
 *
 * A connector-query failure is reported but never fatal — it would otherwise
 * hide the deferred clients, whose actions pass 1 has already declined.
 */
async function resolvePass2Clients(
  clientId: string | undefined,
  deferredClientIds: string[],
  errors: string[],
): Promise<string[]> {
  let connectedIds: string[] = []
  try {
    connectedIds = await loadGscClientIds(clientId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[attribution/cron] loadGscClientIds error:', message)
    errors.push(`load GSC clients: ${message}`)
  }
  return Array.from(new Set([...connectedIds, ...deferredClientIds]))
}

function emptyGscResult(): GscPassResult {
  return {
    clients_processed: 0,
    actions_found:     0,
    outcomes_written:  0,
    skipped:           0,
    cleanup_errors:    0,
    reconcile_errors:  0,
    errors:            [],
  }
}

function accumulate(into: GscPassResult, r: GscAttributionResult): void {
  into.clients_processed++
  into.actions_found    += r.actions_found
  into.outcomes_written += r.outcomes_written
  into.skipped          += r.skipped
  into.cleanup_errors   += r.cleanup_errors
  into.reconcile_errors += r.reconcile_errors
  if (r.errors.length) into.errors.push(...r.errors)
}

async function runPass2(
  clientId: string | undefined,
  windowDays: number,
  deferredClientIds: string[],
): Promise<GscPassResult> {
  const gscResult = emptyGscResult()
  const dualWindow = dualWindowEnabled()

  try {
    const clientIds = await resolvePass2Clients(clientId, deferredClientIds, gscResult.errors)

    for (const cid of clientIds) {
      accumulate(gscResult, await runGscAttributionForClient(
        cid,
        undefined,
        dualWindow ? { deferredWindowDays: windowDays } : {},
      ))
    }

    console.log(
      `[attribution/cron] pass2(gsc) clients=${gscResult.clients_processed} outcomes=${gscResult.outcomes_written} skipped=${gscResult.skipped} deferred_window=${dualWindow ? windowDays : 'off'}`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error in GSC attribution pass'
    console.error('[attribution/cron] Pass 2 error:', message)
    gscResult.errors.push(message)
  }

  return gscResult
}


/**
 * Write the run summary and build the response.
 *
 * All three counters are in the same unit — ACTIONS — so `completed` can be read
 * against `processed`. `completed` used to ignore pass 2 entirely (a run whose
 * only writes came from the GSC evaluator reported zero completed), and counting
 * its outcome ROWS instead would make completed exceed processed several times
 * over, since one action yields three metric rows per window.
 *
 * `failed` counts what actually went wrong: pass-1 actions that threw, pass-1
 * reconciliation failures, plus pass-2 errors (including post-write cleanup
 * failures, which do not reduce `completed`). Reconciliation failures count even
 * when the action attributed perfectly — that is the point, because nothing else
 * would ever show them: `written` goes up, `failed` stays 0, the digest reports
 * a healthy run, and meanwhile the unsigned row keeps the contract migration
 * blocked. (Codex P1, round 18 on PR #862.)
 *
 * `unattributable` is deliberately NOT counted here — it is a standing property
 * of stored rows, recomputed identically every run, so folding it in would pin
 * the daily digest's alarm on forever with no remediation path. It travels in
 * the response and the run summary instead. See Issue #859.
 */
async function finishRun(
  cronRun: Awaited<ReturnType<typeof startCronRun>>,
  pass1Result: AttributionJobResult,
  gscResult: GscPassResult,
  windowDays: number,
  pass1: { overrideRefused: boolean; requested?: number },
): Promise<NextResponse<AttributionCronResponse>> {
  const gscAttributed = Math.max(0, gscResult.actions_found - gscResult.skipped)

  await cronRun.finish({
    processed: pass1Result.processed + gscResult.actions_found,
    completed: pass1Result.written + gscAttributed,
    failed: pass1Result.failed + pass1Result.reconcileErrors + gscResult.errors.length,
    summary: { pass1: pass1Result, gsc: gscResult },
  })

  return NextResponse.json<AttributionCronResponse>({
    timestamp: new Date().toISOString(),
    ...pass1Result,
    window_days: windowDays,
    ...(pass1.overrideRefused
      ? {
          window_override_refused: {
            requested: pass1.requested ?? windowDays,
            used: windowDays,
            reason:
              'Custom attribution windows are disabled while ' +
              'ATTRIBUTION_DUAL_WINDOW_ENABLED is off — a second window would ' +
              'double the evidence behind each action for consumers that still ' +
              'count outcome rows. See Issue #859.',
          },
        }
      : {}),
    gsc: gscResult,
  })
}

/** Bearer check. Returns a response to send, or null to proceed. */
function authorize(req: NextRequest): NextResponse<ApiErrorResponse> | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json<ApiErrorResponse>(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json<ApiErrorResponse>({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

/**
 * Query parameters, with pass 1's window run through the dual-window gate.
 *
 * Pass 1 accepts a window too, and on main a re-run at a different window
 * REPLACED the previous rows. The natural key now appends instead, so this
 * endpoint is a third way to create a second window — gated with the same
 * switch, and the refusal is reported rather than silently applied.
 */
function parseRequest(req: NextRequest): {
  clientId: string | undefined
  windowDays: number
  pass1Window: EffectiveWindow
} {
  const { searchParams } = new URL(req.url)
  const windowDaysParam = searchParams.get('window_days')
  const requested = windowDaysParam !== null ? parseInt(windowDaysParam, 10) : undefined
  const pass1Window = resolveEffectiveWindow(requested, DEFAULT_WINDOW_DAYS)

  return {
    clientId: searchParams.get('client_id') ?? undefined,
    windowDays: pass1Window.windowDays,
    pass1Window,
  }
}

function emptyJobResult(): AttributionJobResult {
  return {
    processed: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    pass2ClientIds: [],
    unattributable: 0,
    unattributableSamples: [],
    reconcileErrors: 0,
    reconcileErrorSamples: [],
  }
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<AttributionCronResponse | ApiErrorResponse>> {
  const denied = authorize(req)
  if (denied) return denied

  const { clientId, windowDays, pass1Window } = parseRequest(req)
  const cronRun = await startCronRun('attribution-cron')

  // ── Pass 1: flywheel_metrics-based attribution ────────────────────────────
  let pass1Result: AttributionJobResult = emptyJobResult()
  try {
    pass1Result = await runAttributionJob({ windowDays, clientId })
    console.log(
      `[attribution/cron] pass1 processed=${pass1Result.processed} written=${pass1Result.written} skipped=${pass1Result.skipped} deferred=${pass1Result.deferred} unattributable=${pass1Result.unattributable}`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[attribution/cron] Pass 1 error:', message)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json<ApiErrorResponse>({ error: message }, { status: 500 })
  }

  const gscResult = await runPass2(clientId, windowDays, pass1Result.pass2ClientIds)

  return finishRun(cronRun, pass1Result, gscResult, windowDays, pass1Window)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function loadGscClientIds(singleClientId?: string): Promise<string[]> {
  if (singleClientId) return [singleClientId]

  const { data, error } = await supabaseAdmin
    .from('client_connectors')
    .select('client_id')
    .eq('anchor', 'gsc')
    .eq('status', 'connected')

  if (error) {
    // Throw, don't return [] — an empty list here used to make a transient
    // connectors failure look like a successful "no GSC clients" run, with the
    // only trace in console. The caller records it into gscResult.errors (so
    // the cron summary counts it) and still processes the deferred clients.
    throw new Error(`client_connectors query failed: ${error.message}`)
  }

  return (data ?? []).map((r: { client_id: string }) => r.client_id)
}
