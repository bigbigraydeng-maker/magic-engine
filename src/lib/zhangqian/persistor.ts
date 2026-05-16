/**
 * 张骞 Zhangqian — DB persistence helpers.
 *
 * Reference: ROADMAP.md P8.10.S0.7
 *
 * Responsibilities:
 *   - createDiscoveryJob: insert a `client_discovery_jobs` row, return job id
 *   - updateJobProgress: stream progress notes to the job row (UI polls this)
 *   - completeJob: mark job completed + UPSERT the report into `client_discovery`
 *   - failJob: mark job failed with an error message
 *   - getLatestDiscovery: read back the most recent (and only) discovery for a client
 *
 * The user-confirmation step (writing back to clients/keywords/competitors)
 * lives in the PATCH /api/clients/[id]/zhangqian/confirm route, NOT here —
 * persistor stays focused on the discovery payload itself.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DiscoveryReport,
  DiscoveryJob,
  ClientDiscoveryRow,
} from './types'
import { applyReputationGuardrail } from './score-guardrails'

// ─── createDiscoveryJob ──────────────────────────────────────────────────────

export async function createDiscoveryJob(
  supabase: SupabaseClient,
  clientId: string,
  domain: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('client_discovery_jobs')
    .insert({
      client_id: clientId,
      domain,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create discovery job: ${error?.message ?? 'unknown'}`)
  }
  return (data as { id: string }).id
}

// ─── updateJobProgress ───────────────────────────────────────────────────────

export async function updateJobProgress(
  supabase: SupabaseClient,
  jobId: string,
  patch: Partial<
    Pick<DiscoveryJob, 'status' | 'progress_note' | 'tool_call_count' | 'cost_usd' | 'started_at'>
  >,
): Promise<void> {
  await supabase.from('client_discovery_jobs').update(patch).eq('id', jobId)
}

// ─── completeJob ─────────────────────────────────────────────────────────────

/**
 * Mark a discovery job as completed AND UPSERT the report into
 * `client_discovery` (one row per client). Returns the discovery row id.
 *
 * Fails the job (not silently) if the UPSERT errors — partial completion is
 * worse than an explicit failure for an UPSERT-semantic table.
 */
export async function completeJob(
  supabase: SupabaseClient,
  jobId: string,
  clientId: string,
  report: DiscoveryReport,
): Promise<string> {
  const completedAt = new Date().toISOString()

  // 落库前的确定性护栏：纠正 LLM 对 reputation 分的折中错误
  // （例如 5 星 + 2 条评价被给 45 分 — 实际应 ≤ 5 分）。
  const { report: guardedReport, result: clampResult } = applyReputationGuardrail(report)
  if (clampResult?.applied) {
    console.log(
      `[zhangqian/persistor] reputation clamped: ${clampResult.oldReputation} → ${clampResult.newReputation} ` +
      `(cap=${clampResult.cap}, overall ${clampResult.oldOverall} → ${clampResult.newOverall}) [client=${clientId}]`,
    )
  }

  // UPSERT discovery payload (unique constraint on client_id)
  const { data: discoveryRow, error: upsertError } = await supabase
    .from('client_discovery')
    .upsert(
      {
        client_id: clientId,
        domain: guardedReport.domain,
        payload: guardedReport,
        cost_usd: report.meta.cost_usd,
        model: report.meta.model,
        tool_calls: report.meta.tool_calls,
        generated_at: completedAt,
        // expires_at default = now() + 30 days; UPSERT must overwrite to refresh
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        confirmed_at: null,         // reset confirmation on any new discovery
        confirmed_by: null,
      },
      { onConflict: 'client_id' },
    )
    .select('id')
    .single()

  if (upsertError || !discoveryRow) {
    await failJob(supabase, jobId, `Discovery UPSERT failed: ${upsertError?.message ?? 'unknown'}`)
    throw new Error(`Failed to persist discovery: ${upsertError?.message ?? 'unknown'}`)
  }

  // Mark job completed
  await supabase
    .from('client_discovery_jobs')
    .update({
      status: 'completed',
      progress_note: 'Discovery complete.',
      tool_call_count: report.meta.tool_calls,
      cost_usd: report.meta.cost_usd,
      completed_at: completedAt,
    })
    .eq('id', jobId)

  return (discoveryRow as { id: string }).id
}

// ─── failJob ─────────────────────────────────────────────────────────────────

export async function failJob(
  supabase: SupabaseClient,
  jobId: string,
  errorMessage: string,
  rawOutput?: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'failed',
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  }
  if (rawOutput !== undefined) patch.raw_output = rawOutput
  await supabase.from('client_discovery_jobs').update(patch).eq('id', jobId)
}

// ─── getLatestDiscovery ──────────────────────────────────────────────────────

/**
 * Read the (single) discovery row for a client. Returns null if no discovery
 * has been run yet. Does NOT filter by expiry — caller decides whether to
 * trigger a refresh based on `expires_at`.
 */
export async function getLatestDiscovery(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientDiscoveryRow | null> {
  const { data, error } = await supabase
    .from('client_discovery')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to read discovery: ${error.message}`)
  }
  return (data as ClientDiscoveryRow | null) ?? null
}

// ─── getJob ──────────────────────────────────────────────────────────────────

export async function getJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<DiscoveryJob | null> {
  const { data, error } = await supabase
    .from('client_discovery_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to read discovery job: ${error.message}`)
  }
  return (data as DiscoveryJob | null) ?? null
}
