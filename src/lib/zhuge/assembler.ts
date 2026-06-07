/**
 * 诸葛亮 Input Assembler — builds ZhugeInput from real Supabase data.
 *
 * Fetches:
 *   1. Client row (name, domain, market, plan)
 *   2. Latest 张骞 discovery (evidence package)
 *   3. Latest completed 华佗 diagnostic run + findings (scores + issue list)
 *   4. Latest prescription intake (budget, business goal — optional)
 *
 * Throws 'NO_DISCOVERY' if no discovery exists (caller maps to 422).
 * Throws 'CLIENT_NOT_FOUND' if the client row is missing (caller maps to 404).
 * Gracefully handles missing diagnostic: empty findings + empty scores.
 *
 * Reference: ROADMAP.md Phase 12.G (P12.G.2)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ZhugeInput, BusinessContext, DiagnosticScores } from './types'
import type { DiagnosticFinding, DiagnosticRun, PrescriptionIntake } from '@/types/diagnostic'
import type { Client } from '@/types/magic-engine'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'
import { LUBAN_TOOL_CATALOG } from './tools-catalog'

export interface AssembledContext {
  input: ZhugeInput
  /** ID of the discovery row used — for context_used response. */
  discovery_id: string
  /** ID of the diagnostic run used — null if no completed run exists. */
  diagnostic_run_id: string | null
  /**
   * DAPE W5 (spec §2.4.3): ID of the latest active prescription for this client.
   * Used by action-persister to fill execution_items.prescription_id so the
   * P→E attribution link survives (Kanban prescription filter + outcome回流).
   * NULL when no approved/draft prescription exists yet.
   */
  prescription_id: string | null
  findings_count: number
}

export async function assembleZhugeInput(
  supabase: SupabaseClient,
  clientId: string,
  businessContextOverride?: Partial<BusinessContext>,
): Promise<AssembledContext> {
  // 1. Fetch client
  const { data: clientRow, error: clientError } = await supabase
    .from('clients')
    .select('id, name, domain, semrush_db, plan_tier, monthly_quota, created_at')
    .eq('id', clientId)
    .maybeSingle()

  if (clientError) throw new Error(`DB error fetching client: ${clientError.message}`)
  if (!clientRow) throw new Error('CLIENT_NOT_FOUND')
  const client = clientRow as Client

  // 2. Fetch latest discovery (required)
  const discoveryRow = await getLatestDiscovery(supabase, clientId)
  if (!discoveryRow) throw new Error('NO_DISCOVERY')

  // 3. Fetch latest completed diagnostic run
  const { data: runRows, error: runError } = await supabase
    .from('diagnostic_runs')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)

  if (runError) throw new Error(`DB error fetching diagnostic run: ${runError.message}`)
  const latestRun = (runRows as DiagnosticRun[] | null)?.[0] ?? null

  // 4. Fetch findings for that run
  let findings: DiagnosticFinding[] = []
  if (latestRun) {
    const { data: findingRows, error: findingError } = await supabase
      .from('diagnostic_findings')
      .select('*')
      .eq('run_id', latestRun.id)
      .order('priority_score', { ascending: false })
      .limit(500)

    if (findingError) throw new Error(`DB error fetching findings: ${findingError.message}`)
    findings = (findingRows as DiagnosticFinding[] | null) ?? []
  }

  // 5. Build diagnostic scores from run (null run → empty scores)
  const diagnosticScores: DiagnosticScores = latestRun?.dimension_scores ?? {}

  // 6. Fetch latest prescription intake for business context (best-effort)
  // DAPE W5: also return the prescription id so action-persister can link
  // execution_items back to the prescription that birthed this conduct call.
  const { data: prescriptions } = await supabase
    .from('prescriptions')
    .select('id, intake')
    .eq('client_id', clientId)
    .in('status', ['approved', 'draft'])
    .order('created_at', { ascending: false })
    .limit(1)

  const latestPrescription = prescriptions?.[0] as
    | { id: string; intake: PrescriptionIntake | null }
    | undefined
  const intake = latestPrescription?.intake ?? null
  const prescriptionId = latestPrescription?.id ?? null

  // 7. Derive market from semrush_db
  const market = deriveMarket(client.semrush_db)

  // 8. Assemble business context (prescription values → then caller overrides)
  const businessContext: BusinessContext = {
    monthly_budget_aud: intake?.monthly_budget_aud ?? null,
    primary_goal: intake?.business_goal ?? null,
    blockers: [],
    has_fde: false,
    market,
    ...businessContextOverride,
  }

  return {
    input: {
      client,
      discoveryEvidence: discoveryRow.payload,
      diagnosticScores,
      findings,
      availableLubanTools: LUBAN_TOOL_CATALOG,
      businessContext,
    },
    discovery_id: discoveryRow.id,
    diagnostic_run_id: latestRun?.id ?? null,
    prescription_id: prescriptionId,
    findings_count: findings.length,
  }
}

function deriveMarket(semrushDb: string): BusinessContext['market'] {
  if (semrushDb === 'nz') return 'NZ'
  if (semrushDb === 'au') return 'AU'
  return 'AU/NZ'
}
