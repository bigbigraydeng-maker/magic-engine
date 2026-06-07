/**
 * Synthesis Orchestrator — BUG-FMT-S13/S16 (the "empty report" fix)
 *
 * Drives the 5 Synthesis modules (score-explainer / dimension-narrator /
 * competitor-analyst / market-context) and persists their output to
 * `diagnostic_narratives` via the helpers in synthesis/persistence.ts.
 *
 * The report-generator already knows how to render these narratives — it just
 * silently drops the sections when `loadNarrativesForRun()` returns an empty
 * array. Before this orchestrator existed, NOTHING in the codebase ever wrote
 * to diagnostic_narratives, so EVERY full report came out as an empty shell.
 *
 * Design contract:
 *   - Called AFTER persistResult() in runner.ts. Never blocks the diagnostic
 *     run — every Synthesis call is wrapped in try/catch and failures are
 *     logged but swallowed (per CLAUDE.md "synthesis writes are opt-in,
 *     must not block").
 *   - Rate-limited: at most one auto-synthesis per client per 24h (the
 *     `force` flag — set by the manual-trigger endpoint — bypasses this).
 *   - Gated by env DIAGNOSTIC_SYNTHESIS_ENABLED (default 'true'). Set to
 *     'false' in any env to disable LLM spend without code changes.
 *   - Per-module env switches for fine-grained control during incidents:
 *       DIAGNOSTIC_SYNTHESIS_MARKET_CONTEXT_ENABLED (web search = $$)
 *       DIAGNOSTIC_SYNTHESIS_COMPETITOR_ENABLED
 *
 * Cost expectation per run (Sonnet pricing, AU/NZ context):
 *   - score-explainer:     ~$0.05  (one call, all dimensions in one JSON)
 *   - dimension-narrator:  ~$0.30  (one call per non-empty dimension, ≤6)
 *   - competitor-analyst:  ~$0.10  (one call, only if ≥2 competitors)
 *   - market-context:      ~$0.40  (one call + ≤5 web_search invocations)
 *   ────────────────────────────
 *   total:                ~$0.30–$1.50 per full run (PM-approved budget).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DiagnosticDimension,
  DiagnosticRun,
} from '@/types/diagnostic'
import type { CollectorResult, NewFinding } from './types'
import type { CompetitorEntry } from './collectors/competitor-collector'
import { DIMENSION_WEIGHTS } from './constants'

import { explainScores } from './synthesis/score-explainer'
import { narrateAllDimensions } from './synthesis/dimension-narrator'
import { analyzeCompetitorLandscape } from './synthesis/competitor-analyst'
import { gatherMarketContext, type MarketCode } from './synthesis/market-context'

import {
  saveScoreExplanations,
  saveDimensionNarratives,
  saveCompetitorAnalysis,
  saveMarketContext,
} from './synthesis/persistence'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrchestratorInput {
  runId: string
  clientId: string
  /** Per-dimension collector output. `competitor` may carry `competitorList`. */
  resultMap: Record<string, CollectorResult & { competitorList?: CompetitorEntry[] }>
  /** Overall weighted score computed by runner.persistResult. */
  overallScore: number
  /**
   * Bypass the per-client 24h rate limit. The manual /synthesize endpoint
   * sets this to true so FDE can refresh narratives on demand.
   */
  force?: boolean
  /**
   * Set by rerunSynthesisForRun. When true, competitorList won't be
   * available (it lives only in collector memory) so competitor_analysis
   * will skip with a clearer reason than "need ≥2 competitors".
   */
  isManualRerun?: boolean
}

export interface OrchestratorResult {
  ran: boolean
  /** Reason we skipped — used by the API layer to surface a clean message. */
  skipped_reason?:
    | 'disabled_by_env'
    | 'rate_limited_24h'
    | 'no_findings_at_all'
    | 'client_not_found'
  /** Per-module status. Lets the manual endpoint show FDE what worked. */
  modules: {
    score_explanations: ModuleStatus
    dimension_narratives: ModuleStatus
    competitor_analysis: ModuleStatus
    market_context: ModuleStatus
  }
  /** Sum of cost_usd across modules. 0 when skipped. */
  total_cost_usd: number
}

export type ModuleStatus =
  | { state: 'ok'; rows_written: number; cost_usd: number }
  | { state: 'skipped'; reason: string }
  | { state: 'failed'; error: string }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultValue
  return raw.toLowerCase() !== 'false' && raw !== '0'
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runSynthesis(
  supabase: SupabaseClient,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const emptyResult: OrchestratorResult = {
    ran: false,
    modules: {
      score_explanations:   { state: 'skipped', reason: 'orchestrator skipped' },
      dimension_narratives: { state: 'skipped', reason: 'orchestrator skipped' },
      competitor_analysis:  { state: 'skipped', reason: 'orchestrator skipped' },
      market_context:       { state: 'skipped', reason: 'orchestrator skipped' },
    },
    total_cost_usd: 0,
  }

  // Master kill switch
  if (!envFlag('DIAGNOSTIC_SYNTHESIS_ENABLED', true)) {
    return { ...emptyResult, skipped_reason: 'disabled_by_env' }
  }

  // Rate limit (auto-run only — manual /synthesize sets force=true)
  if (!input.force) {
    const allowed = await isAutoRunAllowed(supabase, input.clientId)
    if (!allowed) {
      return { ...emptyResult, skipped_reason: 'rate_limited_24h' }
    }
  }

  // Need at least some findings somewhere to narrate — pure empty diagnostics
  // (all dimensions skipped) produce nothing to talk about.
  const allFindings = Object.values(input.resultMap).flatMap(r => r.findings)
  if (allFindings.length === 0) {
    return { ...emptyResult, skipped_reason: 'no_findings_at_all' }
  }

  // Load client context (brand name, domain, industry, country) for prompts.
  const client = await loadClientContext(supabase, input.clientId)
  if (!client) {
    // Can't prompt without client name/domain — shouldn't happen in practice
    // but degrade gracefully so the runner doesn't crash. Distinct reason
    // string so log triage knows it wasn't a findings-empty diagnostic.
    return { ...emptyResult, skipped_reason: 'client_not_found' }
  }

  const ctx = { runId: input.runId, clientId: input.clientId }
  const modules: OrchestratorResult['modules'] = {
    score_explanations:   { state: 'skipped', reason: 'not attempted' },
    dimension_narratives: { state: 'skipped', reason: 'not attempted' },
    competitor_analysis:  { state: 'skipped', reason: 'not attempted' },
    market_context:       { state: 'skipped', reason: 'not attempted' },
  }
  let totalCost = 0

  // ─── 1. Score explanations (one call, all dimensions) ────────────────────
  try {
    const result = await explainScores({
      clientBrandName: client.name,
      clientDomain:    client.domain,
      overallScore:    input.overallScore,
      dimensions:      buildScoreDimensionInputs(input.resultMap),
    })
    const persist = await saveScoreExplanations(supabase, ctx, result)
    modules.score_explanations = persist.ok
      ? { state: 'ok', rows_written: persist.rows_written, cost_usd: result.cost_usd }
      : { state: 'failed', error: persist.error ?? 'persist failed' }
    totalCost += result.cost_usd
  } catch (err) {
    modules.score_explanations = { state: 'failed', error: safeErrorForFde(err, 'score_explanations') }
  }

  // ─── 2. Dimension narratives (one call per dimension with findings) ──────
  try {
    const narratorInputs = Object.entries(input.resultMap)
      .filter(([dim, r]) => isDimension(dim) && r.findings.length > 0)
      .map(([dim, r]) => ({
        clientBrandName: client.name,
        clientDomain:    client.domain,
        dimension:       dim as DiagnosticDimension,
        score:           r.score,
        findings:        r.findings,
      }))
    if (narratorInputs.length === 0) {
      modules.dimension_narratives = { state: 'skipped', reason: 'no dimension has findings' }
    } else {
      const results = await narrateAllDimensions(narratorInputs)
      const persist = await saveDimensionNarratives(supabase, ctx, results)
      const dimCost = results.reduce((s, r) => s + r.cost_usd, 0)
      modules.dimension_narratives = persist.ok
        ? { state: 'ok', rows_written: persist.rows_written, cost_usd: dimCost }
        : { state: 'failed', error: persist.error ?? 'persist failed' }
      totalCost += dimCost
    }
  } catch (err) {
    modules.dimension_narratives = { state: 'failed', error: safeErrorForFde(err, 'dimension_narratives') }
  }

  // ─── 3. Competitor analysis (one call, ≥2 competitors required) ──────────
  if (envFlag('DIAGNOSTIC_SYNTHESIS_COMPETITOR_ENABLED', true)) {
    try {
      const competitorList = input.resultMap['competitor']?.competitorList ?? []
      if (competitorList.length < 2) {
        // Distinct reason for manual rerun: competitorList only lives in
        // collector memory and is lost on rerun-from-DB. FDE needs to know
        // this is design, not bug — and how to get the missing analysis.
        modules.competitor_analysis = {
          state: 'skipped',
          reason: input.isManualRerun
            ? 'competitor list not available on manual rerun (re-run the full diagnostic for fresh competitor analysis)'
            : `need ≥2 competitors, got ${competitorList.length}`,
        }
      } else {
        const result = await analyzeCompetitorLandscape({
          clientBrandName: client.name,
          clientDomain:    client.domain,
          competitors:     competitorList,
        })
        const persist = await saveCompetitorAnalysis(supabase, ctx, result)
        modules.competitor_analysis = persist.ok
          ? { state: 'ok', rows_written: persist.rows_written, cost_usd: result.cost_usd }
          : { state: 'failed', error: persist.error ?? 'persist failed' }
        totalCost += result.cost_usd
      }
    } catch (err) {
      modules.competitor_analysis = { state: 'failed', error: safeErrorForFde(err, 'competitor_analysis') }
    }
  } else {
    modules.competitor_analysis = { state: 'skipped', reason: 'disabled by env' }
  }

  // ─── 4. Market context (one call + ≤5 web_search) ────────────────────────
  if (envFlag('DIAGNOSTIC_SYNTHESIS_MARKET_CONTEXT_ENABLED', true)) {
    try {
      const market = resolveMarketCode(client.country)
      if (!market) {
        modules.market_context = {
          state: 'skipped',
          reason: `country "${client.country ?? '(null)'}" is not AU or NZ`,
        }
      } else if (!client.industry || !client.industry.trim()) {
        modules.market_context = { state: 'skipped', reason: 'client.industry is empty' }
      } else {
        const result = await gatherMarketContext({
          clientBrandName: client.name,
          clientDomain:    client.domain,
          industry:        client.industry,
          market,
        })
        const persist = await saveMarketContext(supabase, ctx, result)
        modules.market_context = persist.ok
          ? { state: 'ok', rows_written: persist.rows_written, cost_usd: result.cost_usd }
          : { state: 'failed', error: persist.error ?? 'persist failed' }
        totalCost += result.cost_usd
      }
    } catch (err) {
      modules.market_context = { state: 'failed', error: safeErrorForFde(err, 'market_context') }
    }
  } else {
    modules.market_context = { state: 'skipped', reason: 'disabled by env' }
  }

  return {
    ran: true,
    modules,
    total_cost_usd: totalCost,
  }
}

// ---------------------------------------------------------------------------
// Rate limit: at most one auto-run per client per 24h
// ---------------------------------------------------------------------------

async function isAutoRunAllowed(
  supabase: SupabaseClient,
  clientId: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('diagnostic_narratives')
    .select('id, generated_at')
    .eq('client_id', clientId)
    .gte('generated_at', cutoff)
    .limit(1)

  if (error) {
    // 狄仁杰 review HIGH — fail-CLOSED. Old code returned true here ("better
    // to spend a bit than block silently"), which means a transient Supabase
    // hiccup → uncapped LLM spend across every cron-triggered run. The
    // safer default is to skip this auto-run; FDE can force-rerun via the
    // manual endpoint if they genuinely need narratives now.
    console.warn(
      `[synthesis-orchestrator] rate-limit check failed for client ${clientId}, ` +
      `fail-closed (no auto-synthesis this run):`,
      error.message,
    )
    return false
  }
  return !data || data.length === 0
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ClientContext {
  name:     string
  domain:   string
  country:  string | null
  industry: string | null
}

async function loadClientContext(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientContext | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('name, domain, country, industry')
    .eq('id', clientId)
    .single()

  if (error || !data) return null
  const c = data as { name: string | null; domain: string | null; country: string | null; industry: string | null }
  if (!c.name || !c.domain) return null
  return {
    name:     c.name,
    domain:   c.domain,
    country:  c.country,
    industry: c.industry,
  }
}

const DIMENSION_KEYS: ReadonlyArray<DiagnosticDimension> = [
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
]

function isDimension(s: string): s is DiagnosticDimension {
  return (DIMENSION_KEYS as readonly string[]).includes(s)
}

function buildScoreDimensionInputs(
  resultMap: Record<string, CollectorResult>,
): Array<{
  dimension: DiagnosticDimension
  score:     number | null
  weight:    number
  findings:  NewFinding[]
}> {
  const out: Array<{
    dimension: DiagnosticDimension
    score:     number | null
    weight:    number
    findings:  NewFinding[]
  }> = []
  for (const dim of DIMENSION_KEYS) {
    const r = resultMap[dim]
    if (!r) continue
    out.push({
      dimension: dim,
      score:     r.score,
      weight:    DIMENSION_WEIGHTS[dim],
      findings:  r.findings,
    })
  }
  return out
}

/**
 * Resolve clients.country (free-text in the DB) into MarketCode.
 * Accepts the common spellings: 'AU' / 'au' / 'Australia' / 'NZ' / 'nz' /
 * 'New Zealand'. Returns null for anything else so we skip market_context
 * rather than fabricate.
 */
function resolveMarketCode(country: string | null): MarketCode | null {
  if (!country) return null
  const c = country.trim().toLowerCase()
  if (c === 'au' || c === 'australia') return 'au'
  if (c === 'nz' || c === 'new zealand' || c === 'newzealand') return 'nz'
  return null
}

/**
 * 狄仁杰 review HIGH — return a SAFE error string to the FDE-facing banner.
 *
 * Anthropic SDK errors can include the model name, request ID, partial API
 * key, or even rate-limit headers in `.message` — none of which the UI
 * should display. Server-side logs keep the full detail; the response
 * surfaces only a category + opaque code.
 */
function safeErrorForFde(err: unknown, moduleName: string): string {
  // Always log the full detail server-side so ops can debug.
  const full = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  console.error(`[synthesis-orchestrator] ${moduleName} failed:`, full)

  // Coarse category for the UI — never the raw SDK message.
  const code =
    err instanceof Error && /rate.?limit|429/i.test(err.message) ? 'rate_limited'
    : err instanceof Error && /timeout|timed.?out/i.test(err.message) ? 'timeout'
    : err instanceof Error && /api.?key|unauthorized|401/i.test(err.message) ? 'auth_error'
    : err instanceof Error && /quota|insufficient/i.test(err.message) ? 'quota_exhausted'
    : err instanceof Error && /5\d{2}/.test(err.message) ? 'upstream_error'
    : 'llm_call_failed'

  return `LLM call failed (${code}). See server logs for details.`
}

// ---------------------------------------------------------------------------
// Export for the manual-trigger endpoint (BUG-FMT-S13 commit 2)
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper used by `POST /api/clients/[id]/diagnostic/[runId]/synthesize`.
 * Reloads the runs / findings, then invokes the orchestrator with `force: true`.
 */
export async function rerunSynthesisForRun(
  supabase: SupabaseClient,
  runId: string,
  clientId: string,
): Promise<OrchestratorResult> {
  const [runRes, findingsRes] = await Promise.all([
    supabase
      .from('diagnostic_runs')
      .select('id, client_id, overall_score, dimension_scores, dimensions_skipped')
      .eq('id', runId)
      .eq('client_id', clientId)
      .single(),
    supabase
      .from('diagnostic_findings')
      .select('*')
      .eq('run_id', runId)
      .eq('client_id', clientId),
  ])

  if (runRes.error || !runRes.data) {
    throw new Error(`run not found: ${runId}`)
  }
  const run = runRes.data as Pick<DiagnosticRun, 'id' | 'client_id' | 'overall_score' | 'dimension_scores' | 'dimensions_skipped'>
  const findings = (findingsRes.data ?? []) as NewFinding[]

  // Rebuild a resultMap from persisted findings. We don't have the original
  // competitorList here (it lives only in collector return values), so the
  // competitor-analysis module will skip on rerun — that's acceptable for
  // existing runs. Fresh runs always go through runner.ts and get the full
  // package.
  const resultMap: Record<string, CollectorResult & { competitorList?: CompetitorEntry[] }> = {}
  for (const dim of DIMENSION_KEYS) {
    const score = run.dimension_scores?.[dim] ?? null
    const dimFindings = findings.filter(f => f.dimension === dim)
    resultMap[dim] = { score, findings: dimFindings }
  }

  return runSynthesis(supabase, {
    runId,
    clientId,
    resultMap,
    overallScore: run.overall_score ?? 0,
    force: true,
    isManualRerun: true,
  })
}
