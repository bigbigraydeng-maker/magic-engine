import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiagnosticDimension } from '@/types/diagnostic'
import type { CollectorResult, NewFinding } from './types'
import { SeoCollector } from './collectors/seo-collector'
import { SocialCollector } from './collectors/social-collector'
import { ReputationCollector } from './collectors/reputation-collector'
import { CompetitorCollector, type CompetitorEntry } from './collectors/competitor-collector'
import { AiVisibilityCollector } from './collectors/ai-visibility-collector'
import { createDefaultLiveProbe } from './ai-visibility-live-probe'
import { AdsCollector } from './collectors/ads-collector'
import { computeOverallScore, isDiagnosticDimension } from './guards'
import { runSynthesis } from './synthesis-orchestrator'

/** Per-dimension collector return — `competitor` may carry competitorList. */
type RunnerCollectorResult = CollectorResult & { competitorList?: CompetitorEntry[] }

// ---------------------------------------------------------------------------
// Module registry
// ---------------------------------------------------------------------------

const VALID_MODULES = ['seo', 'social', 'reputation', 'competitor', 'ai_visibility', 'ads', 'full'] as const
export type DiagnosticModule = (typeof VALID_MODULES)[number]

export function isValidModule(module: string): module is DiagnosticModule {
  return (VALID_MODULES as readonly string[]).includes(module)
}

/** Map 'full' to the concrete dimensions it runs. */
function resolveDimensions(module: DiagnosticModule): DiagnosticDimension[] {
  if (module === 'full') return ['seo', 'social', 'reputation', 'competitor', 'ai_visibility', 'ads']
  return [module as DiagnosticDimension]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Creates a pending run record and returns its id. Fast — no collection. */
export async function createDiagnosticRun(
  supabase: SupabaseClient,
  clientId: string,
  module: DiagnosticModule,
): Promise<string> {
  const { data, error } = await supabase
    .from('diagnostic_runs')
    .insert({
      client_id: clientId,
      triggered_by: 'user' as const,
      status: 'pending' as const,
      dimensions_requested: resolveDimensions(module) as DiagnosticDimension[],
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create diagnostic run: ${error?.message ?? 'unknown'}`)
  }
  return (data as { id: string }).id
}

/** Runs collectors for an existing run record and persists results. */
export async function executeDiagnosticRun(
  supabase: SupabaseClient,
  runId: string,
  clientId: string,
  module: DiagnosticModule,
): Promise<void> {
  await supabase
    .from('diagnostic_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', runId)

  try {
    const [client, keywords, gscQueries] = await fetchClientData(supabase, clientId)
    const resultMap = await runCollectors(supabase, clientId, client, keywords, gscQueries, module)
    const overallScore = await persistResult(supabase, runId, resultMap)

    // BUG-FMT-S13/S16 — fan out to LLM synthesis after the deterministic run is
    // safely persisted. Failures here MUST NOT mark the run failed; they are
    // logged and the report-generator silently drops the empty sections.
    if (module === 'full' && overallScore !== null) {
      try {
        const result = await runSynthesis(supabase, {
          runId,
          clientId,
          resultMap,
          overallScore,
        })
        if (!result.ran && result.skipped_reason) {
          console.log(`[runner] synthesis skipped for run ${runId}: ${result.skipped_reason}`)
        } else if (result.ran) {
          console.log(`[runner] synthesis ok for run ${runId}: $${result.total_cost_usd.toFixed(3)}`)
        }
      } catch (synthErr) {
        const message = synthErr instanceof Error ? synthErr.message : String(synthErr)
        console.warn(`[runner] synthesis threw for run ${runId}, ignoring:`, message)
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('diagnostic_runs')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
  }
}

/** Convenience wrapper: create + execute synchronously. Returns run_id. */
export async function runDiagnostic(
  supabase: SupabaseClient,
  clientId: string,
  module: DiagnosticModule,
): Promise<string> {
  const runId = await createDiagnosticRun(supabase, clientId, module)
  await executeDiagnosticRun(supabase, runId, clientId, module)
  return runId
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

interface ClientData {
  domain: string
  name: string | null
  city: string | null
  country: string | null
  /** Free-text industry (e.g. 'travel', 'flooring'). Drives reputation-collector source weights. */
  industry: string | null
}

async function fetchClientData(
  supabase: SupabaseClient,
  clientId: string,
): Promise<[ClientData, string[], string[]]> {
  const [clientRes, kwRes, discoveryRes] = await Promise.all([
    supabase.from('clients').select('domain, name, city, country, industry').eq('id', clientId).single(),
    supabase.from('keywords').select('keyword').eq('client_id', clientId).eq('status', 'approved'),
    supabase.from('client_discovery').select('payload').eq('client_id', clientId).maybeSingle(),
  ])

  const raw = clientRes.data as { domain: string | null; name: string | null; city: string | null; country: string | null; industry: string | null } | null
  const client: ClientData = {
    domain: raw?.domain ?? '',
    name: raw?.name ?? null,
    city: raw?.city ?? null,
    country: raw?.country ?? null,
    industry: raw?.industry ?? null,
  }
  const keywords =
    (kwRes.data as { keyword: string }[] | null)?.map(k => k.keyword) ?? []

  // Extract real search queries from GSC advanced discovery payload
  type DiscoveryPayload = { advanced?: { gsc_data?: { rows?: Array<{ query: string }> } } }
  const payload = (discoveryRes.data as { payload?: DiscoveryPayload } | null)?.payload
  const gscQueries = payload?.advanced?.gsc_data?.rows?.map(r => r.query) ?? []

  return [client, keywords, gscQueries]
}

async function runCollectors(
  supabase: SupabaseClient,
  clientId: string,
  client: ClientData,
  keywords: string[],
  gscQueries: string[],
  module: DiagnosticModule,
): Promise<Record<string, RunnerCollectorResult>> {
  const { domain } = client
  // CompetitorCollectorResult extends CollectorResult with competitorList — the
  // wider promise type lets us preserve that field through Promise.allSettled
  // without losing the per-job dimension labelling.
  const jobs: Array<{ dim: string; promise: Promise<RunnerCollectorResult> }> = []

  if (module === 'seo' || module === 'full') {
    jobs.push({ dim: 'seo', promise: new SeoCollector().collect(clientId, domain, keywords, gscQueries) })
  }
  if (module === 'social' || module === 'full') {
    jobs.push({ dim: 'social', promise: new SocialCollector(supabase).collect(clientId, domain, keywords) })
  }
  if (module === 'reputation' || module === 'full') {
    jobs.push({
      dim: 'reputation',
      promise: new ReputationCollector().collect(clientId, domain, keywords, {
        businessName: client.name,
        city: client.city,
        country: client.country,
        industry: client.industry,
      }),
    })
  }
  if (module === 'competitor' || module === 'full') {
    jobs.push({ dim: 'competitor', promise: new CompetitorCollector().collect(clientId, domain, keywords) })
  }
  if (module === 'ai_visibility' || module === 'full') {
    // P8.10.S2.5: real-time probe runs alongside the snapshot read so freshly
    // onboarded clients (no cron snapshot yet) still get a real AI signal.
    const liveProbe = createDefaultLiveProbe(supabase)
    jobs.push({ dim: 'ai_visibility', promise: new AiVisibilityCollector(supabase, liveProbe).collect(clientId, domain, keywords) })
  }
  if (module === 'ads' || module === 'full') {
    jobs.push({ dim: 'ads', promise: new AdsCollector(supabase).collect(clientId, domain, keywords) })
  }

  const settled = await Promise.allSettled(jobs.map(j => j.promise))
  const resultMap: Record<string, RunnerCollectorResult> = {}

  jobs.forEach((job, i) => {
    const s = settled[i]
    // BUG-FMT-S14 — a rejected collector means the dimension is UNKNOWABLE,
    // not "average". Returning score: 0 was lying with confidence. Use null
    // so computeOverallScore re-normalises weights and the UI shows "not
    // configured" instead of a fake zero (matches the same convention used
    // by collectors themselves when prerequisite data is missing).
    resultMap[job.dim] = s.status === 'fulfilled' ? s.value : { score: null, findings: [] }
  })

  return resultMap
}

async function persistResult(
  supabase: SupabaseClient,
  runId: string,
  resultMap: Record<string, RunnerCollectorResult>,
): Promise<number | null> {
  // P8.5.24: dimensionScores stores number | null — null means "data unavailable"
  // and is excluded from computeOverallScore (weights re-normalised).
  const dimensionScores: Partial<Record<DiagnosticDimension, number | null>> = {}
  const dimensionsSkipped: DiagnosticDimension[] = []
  const allFindings: (NewFinding & { run_id: string })[] = []

  for (const [dim, result] of Object.entries(resultMap)) {
    if (isDiagnosticDimension(dim)) {
      dimensionScores[dim] = result.score
      if (result.score === null) dimensionsSkipped.push(dim)
    }
    allFindings.push(...result.findings.map(f => ({ ...f, run_id: runId })))
  }

  const overallScore = computeOverallScore(dimensionScores)

  if (allFindings.length > 0) {
    await supabase.from('diagnostic_findings').insert(allFindings)
  }

  await supabase
    .from('diagnostic_runs')
    .update({
      status: 'completed',
      overall_score: overallScore,
      dimension_scores: dimensionScores,
      dimensions_skipped: dimensionsSkipped,
      findings_count: allFindings.length,
      critical_count: allFindings.filter(f => f.severity === 'critical').length,
      high_count: allFindings.filter(f => f.severity === 'high').length,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)

  return overallScore
}
