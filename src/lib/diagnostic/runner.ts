import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiagnosticDimension } from '@/types/diagnostic'
import type { CollectorResult, NewFinding } from './types'
import { SeoCollector } from './collectors/seo-collector'
import { SocialCollector } from './collectors/social-collector'
import { ReputationCollector } from './collectors/reputation-collector'
import { CompetitorCollector } from './collectors/competitor-collector'
import { AiVisibilityCollector } from './collectors/ai-visibility-collector'
import { createDefaultLiveProbe } from './ai-visibility-live-probe'
import { AdsCollector } from './collectors/ads-collector'
import { computeOverallScore, isDiagnosticDimension } from './guards'

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
    await persistResult(supabase, runId, resultMap)
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
}

async function fetchClientData(
  supabase: SupabaseClient,
  clientId: string,
): Promise<[ClientData, string[], string[]]> {
  const [clientRes, kwRes, discoveryRes] = await Promise.all([
    supabase.from('clients').select('domain, name, city, country').eq('id', clientId).single(),
    supabase.from('keywords').select('keyword').eq('client_id', clientId).eq('status', 'approved'),
    supabase.from('client_discovery').select('payload').eq('client_id', clientId).maybeSingle(),
  ])

  const raw = clientRes.data as { domain: string | null; name: string | null; city: string | null; country: string | null } | null
  const client: ClientData = {
    domain: raw?.domain ?? '',
    name: raw?.name ?? null,
    city: raw?.city ?? null,
    country: raw?.country ?? null,
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
): Promise<Record<string, CollectorResult>> {
  const { domain } = client
  const jobs: Array<{ dim: string; promise: Promise<CollectorResult> }> = []

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
  const resultMap: Record<string, CollectorResult> = {}

  jobs.forEach((job, i) => {
    const s = settled[i]
    resultMap[job.dim] = s.status === 'fulfilled' ? s.value : { score: 0, findings: [] }
  })

  return resultMap
}

async function persistResult(
  supabase: SupabaseClient,
  runId: string,
  resultMap: Record<string, CollectorResult>,
): Promise<void> {
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
}
