import { supabaseAdmin as db } from '@/lib/supabase'

export const STALE_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000
const INTERPRETATION_CEILING_USD = 0.25

export type StaleRunInput = {
  status: string
  updated_at: string
  accounted_nzd: number | null
  capture_claimed: boolean
  interpretation_claimed: boolean
  provider_run_id: string | null
  capture_cost_usd: number | null
  interpretation_cost_usd: number | null
  capture_limit_usd: number
  error_code: string | null
}

export type StaleCloseoutPlan =
  | { action: 'skip'; reason: 'terminal' | 'already_accounted' | 'fresh' | 'cost_would_exceed_reservation' }
  | { action: 'close'; capture_cost_usd: number; interpretation_cost_usd: number; error_code: string }

/** Decision table mirrored by web_intelligence_close_stale_runs. Money math in production stays in SQL. */
export function planStaleRunCloseout(run: StaleRunInput, now: Date, timeoutMs = STALE_RUN_TIMEOUT_MS): StaleCloseoutPlan {
  if (run.status === 'complete' || run.status === 'failed') return { action: 'skip', reason: 'terminal' }
  if (run.accounted_nzd != null) return { action: 'skip', reason: 'already_accounted' }
  if (now.getTime() - Date.parse(run.updated_at) < timeoutMs) return { action: 'skip', reason: 'fresh' }
  const capture = run.capture_cost_usd ?? (run.capture_claimed || run.provider_run_id ? run.capture_limit_usd : 0)
  const room = run.capture_limit_usd + INTERPRETATION_CEILING_USD - capture
  const interpretation = run.interpretation_cost_usd ?? (run.interpretation_claimed ? Math.min(INTERPRETATION_CEILING_USD, room) : 0)
  if (capture < 0 || interpretation < 0 || capture + interpretation > run.capture_limit_usd + INTERPRETATION_CEILING_USD) {
    return { action: 'skip', reason: 'cost_would_exceed_reservation' }
  }
  const previous = run.error_code?.trim()
  return {
    action: 'close',
    capture_cost_usd: capture,
    interpretation_cost_usd: interpretation,
    error_code: previous ? `stale_run_timeout:${previous}`.slice(0, 200) : 'stale_run_timeout',
  }
}

export type StaleCloseoutReceipt = { closed: string[]; skipped: number; unavailable: boolean }

function missingFunction(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? ''
  return error.code === 'PGRST202' || error.code === '42883' || message.includes('web_intelligence_close_stale_runs')
}

/** No-op when the migration is not applied yet, so the daily runner keeps its old behaviour. */
export async function closeStaleWebIntelligenceRuns(clientId: string): Promise<StaleCloseoutReceipt> {
  const result = await db.rpc('web_intelligence_close_stale_runs', { p_client_id: clientId, p_timeout: '6 hours' })
  if (result.error) {
    if (missingFunction(result.error)) return { closed: [], skipped: 0, unavailable: true }
    throw new Error('stale_run_close_failed')
  }
  const data = result.data as { closed?: string[]; skipped?: number } | null
  return { closed: data?.closed ?? [], skipped: data?.skipped ?? 0, unavailable: false }
}
