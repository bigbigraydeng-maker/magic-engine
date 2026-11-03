import { supabaseAdmin } from '@/lib/supabase'
import { collectAdPlays } from '@/lib/ads-strategy/plan-seed/attach'
import { buildPlanSeed } from '@/lib/ads-strategy/plan-seed/build'
import { productionDeps as seedProductionDeps } from '@/lib/ads-strategy/plan-seed/deps'
import type { PrescriptionContent } from '@/types/diagnostic'
import { loadOwnedAccounts } from './facts'
import { planLinkedGoalId } from './plan-pick'
import { recordPlanDraftRun } from './plan-draft-kernel'
import { writePlanDraftReceipt } from './plan-draft-receipt'
import { AccountReadError } from './plan-draft-retry'
import { schedulePlanDraftRetry } from './plan-draft-schedule'
import type { DraftPrescriptionRow, PlanDraftDeps, PlanDraftInsert } from './plan-draft-types'
import type { MarketingPlan } from '../types'

export function countryFromSemrushDb(value: unknown): 'AU' | 'NZ' | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toLowerCase()
  if (code === 'au') return 'AU'
  if (code === 'nz') return 'NZ'
  return null
}

export function enabledPlanDraftClientIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PLAN_DRAFT_AUTO_CLIENT_IDS ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '')
}

function asDraftRow(data: unknown): DraftPrescriptionRow | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (typeof row.id !== 'string') return null
  return {
    id: row.id,
    client_id: typeof row.client_id === 'string' ? row.client_id : '',
    status: typeof row.status === 'string' ? row.status : '',
    version: typeof row.version === 'number' ? row.version : Number.NaN,
    goal_id: typeof row.goal_id === 'string' ? row.goal_id : null,
    content: row.content ?? null,
    generation_meta: row.generation_meta ?? null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

function duplicateInsert(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || /duplicate key/i.test(error.message ?? '')
}

async function loadPrescription(clientId: string, prescriptionId: string): Promise<DraftPrescriptionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('prescriptions')
    .select('id, client_id, status, version, goal_id, content, generation_meta, updated_at')
    .eq('id', prescriptionId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error('timeout')
  return asDraftRow(data)
}

async function loadPeriod(clientId: string, goalId: string) {
  const { data, error } = await supabaseAdmin
    .from('goals')
    .select('period_start, period_end')
    .eq('id', goalId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { period_start?: unknown; period_end?: unknown }
  if (typeof row.period_start !== 'string' || typeof row.period_end !== 'string') return null
  return { start_date: row.period_start.slice(0, 10), end_date: row.period_end.slice(0, 10) }
}

async function loadGoalTitle(clientId: string, goalId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('goals')
    .select('title')
    .eq('id', goalId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const title = (data as { title?: unknown }).title
  return typeof title === 'string' ? title : null
}

async function loadCountry(clientId: string): Promise<'AU' | 'NZ' | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('semrush_db')
    .eq('id', clientId)
    .maybeSingle()
  if (error || !data) return null
  return countryFromSemrushDb((data as { semrush_db?: unknown }).semrush_db)
}

async function loadAccounts(clientId: string) {
  const owned = await loadOwnedAccounts(clientId)
  if (owned === null) throw new AccountReadError()
  return owned.map(account => ({
    ad_account_id: account.id,
    currency: null,
    daily_cap_cents: account.cap,
    owned_by_client: true,
  }))
}

async function loadClientCapCents(clientId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('daily_budget_cap_cents')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const cap = (data as { daily_budget_cap_cents?: unknown }).daily_budget_cap_cents
  return typeof cap === 'number' && cap > 0 ? cap : null
}

async function hasApprovedPlan(clientId: string, goalId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('marketing_plans')
    .select('plan_data, generation_meta')
    .eq('client_id', clientId)
    .eq('status', 'approved')
    .limit(50)
  if (error || !data) return false
  return (data as Array<{ plan_data: unknown; generation_meta: unknown }>).some(row => {
    return planLinkedGoalId({
      plan_data: row.plan_data as MarketingPlan['plan_data'],
      generation_meta: (row.generation_meta ?? null) as MarketingPlan['generation_meta'],
    }) === goalId
  })
}

async function insertPlan(row: PlanDraftInsert): Promise<'created' | 'already_exists'> {
  const { error } = await supabaseAdmin.from('marketing_plans').insert(row)
  if (!error) return 'created'
  if (duplicateInsert(error)) return 'already_exists'
  throw new Error('plan insert failed')
}

export function productionPlanDraftDeps(): PlanDraftDeps {
  return {
    now: () => new Date(),
    enabledClientIds: () => enabledPlanDraftClientIds(),
    loadPrescription,
    readPlays: content => {
      if (!content || typeof content !== 'object') return []
      return collectAdPlays(content as PrescriptionContent)
    },
    loadPeriod,
    loadGoalTitle,
    loadCountry,
    loadAccounts,
    loadClientCapCents,
    buildSeed: (args) => buildPlanSeed(args, seedProductionDeps()),
    hasApprovedPlan,
    insertPlan,
    writeReceipt: (clientId, prescriptionId, receipt) => writePlanDraftReceipt(
      supabaseAdmin, clientId, prescriptionId, receipt,
    ),
    recordRun: record => recordPlanDraftRun(supabaseAdmin, record),
    scheduleRetry: schedulePlanDraftRetry,
  }
}
