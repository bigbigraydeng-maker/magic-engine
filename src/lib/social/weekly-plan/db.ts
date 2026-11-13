/**
 * Read and store a weekly slot plan on the existing social_plans table.
 * Selects goal text and labels, plus titles and counts. Tokens, prices, and goal numbers stay out.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { assembleInput } from './assemble'
import { mergeApproval, readApproval, slotDigest, type PlanApproval } from './digest'
import { readReadbackSuggestionForClient } from './readback-suggestion'
import { WEEKLY_SLOT_PLAN_KIND, type WeeklySocialPlan } from './types'

export interface StoredWeeklyPlan {
  id: string
  plan: WeeklySocialPlan
  digest: string
  approval: PlanApproval | null
}

type SaveResult = (StoredWeeklyPlan & { saved: 'same' | 'inserted' }) | 'error'

export async function loadPlanInput(
  db: SupabaseClient,
  clientId: string,
  week: { weekStart: string; weekEnd: string },
  now: Date = new Date(),
): Promise<ReturnType<typeof assembleInput>> {
  const [client, pillars, goal, themes, facts, assets, authStatuses, readbackSuggestion] = await Promise.all([
    readClient(db, clientId),
    readPillarRow(db, clientId),
    readGoalRow(db, clientId),
    readThemeRows(db, clientId),
    factCount(db, clientId),
    assetCount(db, clientId),
    readAuth(db, clientId),
    readReadbackSuggestionForClient(db, clientId, now),
  ])
  return assembleInput({
    ...week,
    ...client,
    ...pillars,
    ...goal,
    ...themes,
    ...facts,
    ...assets,
    authStatuses,
    readbackSuggestion,
  })
}

export async function readLatestWeeklyPlan(
  db: SupabaseClient,
  clientId: string,
  weekStart: string,
): Promise<StoredWeeklyPlan | null | 'unreadable'> {
  const { data, error } = await db
    .from('social_plans')
    .select('id, plan_data')
    .eq('client_id', clientId)
    .eq('platform', 'facebook')
    // Stored JSON uses planKind and weekStart. plan_kind would never match a row.
    .eq('plan_data->>planKind', WEEKLY_SLOT_PLAN_KIND)
    .eq('plan_data->>weekStart', weekStart)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return 'unreadable'
  if (!data) return null
  return parseStored(data.id, data.plan_data)
}

export async function saveWeeklyPlan(
  db: SupabaseClient,
  clientId: string,
  plan: WeeklySocialPlan,
): Promise<SaveResult> {
  const digest = slotDigest(plan)
  const existing = await readLatestWeeklyPlan(db, clientId, plan.weekStart)
  if (existing === 'unreadable') return 'error'
  if (existing && existing.digest === digest) return { ...existing, saved: 'same' }
  const { data, error } = await db
    .from('social_plans')
    .insert({
      client_id: clientId,
      campaign_id: null,
      platform: 'facebook',
      wave_number: 1,
      plan_data: { ...plan, slotDigest: digest },
    })
    .select('id')
    .single()
  if (error || !data?.id) return 'error'
  return { id: String(data.id), plan, digest, approval: null, saved: 'inserted' }
}

export async function stampWeeklyPlan(
  db: SupabaseClient,
  id: string,
  clientId: string,
  approval: PlanApproval,
): Promise<boolean> {
  const { data, error } = await db
    .from('social_plans')
    .select('plan_data')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return false
  const planData = asRecord(data.plan_data)
  if (!planData || planData.planKind !== WEEKLY_SLOT_PLAN_KIND) return false
  const { error: writeError } = await db
    .from('social_plans')
    .update({ plan_data: mergeApproval(planData, approval) })
    .eq('id', id)
    .eq('client_id', clientId)
  return !writeError
}

async function readClient(db: SupabaseClient, clientId: string) {
  const { data, error } = await db
    .from('clients')
    .select('industry, publishing_calendar_config')
    .eq('id', clientId)
    .maybeSingle()
  if (error) return { clientError: true, industry: null, config: null }
  const row = asRecord(data)
  return { clientError: false, industry: row?.industry ?? null, config: row?.publishing_calendar_config ?? null }
}

async function readPillarRow(db: SupabaseClient, clientId: string) {
  const { data, error } = await db
    .from('master_briefs')
    .select('content_pillars')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return { pillarsError: Boolean(error), pillarsRaw: asRecord(data)?.content_pillars ?? null }
}

async function readGoalRow(db: SupabaseClient, clientId: string) {
  const { data, error } = await db
    .from('goals')
    .select('title, fde_reasoning, intent, sub_type, awareness_subtype')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return { goalError: Boolean(error), goalRow: data }
}

async function readThemeRows(db: SupabaseClient, clientId: string) {
  const { data, error } = await db
    .from('campaign_briefs')
    .select('id, title, campaign_angle')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(8)
  return { themeError: Boolean(error), themeRows: data }
}

async function factCount(db: SupabaseClient, clientId: string) {
  const { count, error } = await db
    .from('client_knowledge_facts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'approved')
  return namedCount('fact', count, error)
}

async function assetCount(db: SupabaseClient, clientId: string) {
  const { count, error } = await db
    .from('client_assets')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .in('source', ['client_verified', 'fde_shot'])
  return namedCount('asset', count, error)
}

function namedCount(kind: 'fact' | 'asset', count: number | null, error: { message: string } | null) {
  const failed = Boolean(error) || typeof count !== 'number'
  if (kind === 'fact') return { factError: failed, factCount: failed ? null : count }
  return { assetError: failed, assetCount: failed ? null : count }
}

async function readAuth(db: SupabaseClient, clientId: string): Promise<string[] | 'unreadable'> {
  const { data, error } = await db
    .from('platform_oauth_connections')
    .select('status')
    .eq('client_id', clientId)
    .eq('provider', 'meta')
  if (error || !Array.isArray(data)) return 'unreadable'
  return data.flatMap((row) => {
    const status = asRecord(row)?.status
    return typeof status === 'string' && status ? [status] : []
  })
}

function parseStored(id: unknown, raw: unknown): StoredWeeklyPlan | 'unreadable' {
  const planData = asRecord(raw)
  if (!planData || planData.planKind !== WEEKLY_SLOT_PLAN_KIND) return 'unreadable'
  if (typeof planData.weekStart !== 'string' || typeof planData.slotDigest !== 'string') return 'unreadable'
  if (!Array.isArray(planData.items) || !asRecord(planData.counts)) return 'unreadable'
  if (planData.status !== 'ready' && planData.status !== 'held' && planData.status !== 'incomplete') return 'unreadable'
  const { slotDigest: digest, approval, ...plan } = planData
  return {
    id: String(id),
    plan: plan as unknown as WeeklySocialPlan,
    digest: String(digest),
    approval: readApproval(approval),
  }
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}
