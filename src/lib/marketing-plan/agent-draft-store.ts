/**
 * Database adapter for an ads-agent draft save.
 * Reads the same budget facts as the human promo save. Does not call Meta writes.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { loadGoal, loadPromoFacts } from '@/lib/marketing-plan/promo/facts'
import type { PromoSpec } from '@/lib/marketing-plan/promo/spec'
import { readPlanSeedForClient } from '@/lib/ads-strategy/plan-seed/read-for-client'
import type {
  AgentDraftDeps,
  AgentPlanRow,
  BudgetFacts,
  DraftInsert,
  DraftPatch,
} from '@/lib/marketing-plan/agent-draft'

export function productionAgentDraftDeps(): AgentDraftDeps {
  return {
    now: () => new Date(),
    readSeed: (clientId, prescriptionId) => readPlanSeedForClient(clientId, prescriptionId),
    loadGoal: (clientId, goalId) => loadGoal(clientId, goalId),
    loadBudget: (clientId, spec) => loadBudgetFacts(clientId, spec),
    loadPlan: (clientId, planId) => loadAgentPlan(clientId, planId),
    insertPlan: insertAgentPlan,
    updatePlan: updateAgentPlan,
  }
}

async function loadBudgetFacts(clientId: string, spec: PromoSpec): Promise<BudgetFacts | 'unreadable'> {
  try {
    const facts = await loadPromoFacts(clientId, spec, [])
    return {
      accounts: facts.gate.accounts,
      clientCapCents: facts.gate.config?.daily_budget_cap_cents ?? null,
    }
  } catch {
    console.error('[agent-draft] budget facts failed')
    return 'unreadable'
  }
}

async function loadAgentPlan(clientId: string, planId: string): Promise<AgentPlanRow | null | 'error'> {
  const { data, error } = await supabaseAdmin
    .from('marketing_plans')
    .select('id, status, updated_at, title, start_date, end_date, plan_data, generation_meta')
    .eq('id', planId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    console.error('[agent-draft] plan read failed')
    return 'error'
  }
  if (!data) return null
  return {
    id: String(data.id),
    status: String(data.status),
    updatedAt: String(data.updated_at),
    title: String(data.title ?? ''),
    startDate: typeof data.start_date === 'string' ? data.start_date : null,
    endDate: typeof data.end_date === 'string' ? data.end_date : null,
    planData: asRecord(data.plan_data),
    generationMeta: data.generation_meta && typeof data.generation_meta === 'object'
      ? asRecord(data.generation_meta)
      : null,
  }
}

async function insertAgentPlan(row: DraftInsert): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('marketing_plans').insert(row).select('id').single()
  if (error || !data?.id) {
    console.error('[agent-draft] plan insert failed')
    return null
  }
  return String(data.id)
}

async function updateAgentPlan(
  planId: string,
  clientId: string,
  updatedAt: string,
  patch: DraftPatch,
): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from('marketing_plans')
    .update(patch)
    .eq('id', planId)
    .eq('client_id', clientId)
    .eq('status', 'draft')
    .eq('updated_at', updatedAt)
    .select('id')
  if (error) {
    console.error('[agent-draft] plan update failed')
    return null
  }
  return Array.isArray(data) && data.length === 1
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
