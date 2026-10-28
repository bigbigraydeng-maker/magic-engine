/**
 * Database reads and writes for the post-launch check.
 * Page reads use equality filters only. The two-hour job pages the action list.
 * Nothing here calls Meta or a model.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { storedEffectCard } from '@/lib/ads-strategy/effect-judgment/card'
import { resolveAccountTimezone } from '@/lib/ads-strategy/account-timezone'
import {
  kpisFromContent, pickLatestCase, readMetric, LAUNCH_CHECK_METRICS,
  type ActionRow, type InsightRef, type PlanRef,
} from './prescription-launch-check'
import {
  readOneLaunch, runWithStore,
  type LaunchCheckReceipt, type LaunchCheckStore, type StoredPrescription,
} from './prescription-launch-check-run'

const PAGE = 500
const CAP = 5000
const OURS = new Set<string>(LAUNCH_CHECK_METRICS)

interface TableApi {
  select(columns: string): TableApi
  eq(column: string, value: string): TableApi
  order(column: string, options: { ascending: boolean }): TableApi
  range(from: number, to: number): Promise<QueryResult>
  insert(row: Record<string, unknown>): Promise<QueryResult>
  update(patch: Record<string, unknown>): TableApi
  then<T>(onfulfilled: (value: QueryResult) => T): Promise<T>
}

interface QueryResult {
  data: unknown
  error: { message: string } | null
}

export async function readPrescriptionLaunch(input: {
  clientId: string
  prescription: StoredPrescription
  now: Date
}): Promise<{ lines: string[] }> {
  return readOneLaunch(supabaseLaunchStore(), {
    clientId: input.clientId,
    prescription: input.prescription,
    kpis: input.prescription.kpis,
    effectCard: input.prescription.effectCard,
    now: input.now,
  })
}

export async function runPrescriptionLaunchCheck(now: Date): Promise<LaunchCheckReceipt> {
  return runWithStore(supabaseLaunchStore(), now)
}

export function supabaseLaunchStore(): LaunchCheckStore {
  return {
    listClientActions,
    listAllActions,
    listApprovedPlans,
    listApprovedPrescriptions,
    listInsights,
    readAccountTimezone,
    findCaseId,
    listOutcomes,
    insertOutcome,
    updateOutcome,
  }
}

async function listClientActions(clientId: string): Promise<ActionRow[]> {
  const data = await eqRows('flywheel_actions', 'id, client_id, payload', [
    ['client_id', clientId],
    ['action_type', 'ads.create_ad'],
  ])
  return data.map(actionFrom).filter((row): row is ActionRow => row !== null)
}

async function listAllActions(): Promise<{ rows: ActionRow[]; partial: boolean }> {
  const rows: ActionRow[] = []
  for (let from = 0; from < CAP; from += PAGE) {
    const to = Math.min(from + PAGE, CAP) - 1
    const batch = await pageActions(from, to)
    rows.push(...batch)
    if (batch.length < to - from + 1) return { rows, partial: false }
  }
  return { rows, partial: true }
}

async function listApprovedPlans(clientId: string): Promise<PlanRef[]> {
  const data = await eqRows('marketing_plans', 'status, approved_at, plan_data', [
    ['client_id', clientId],
    ['status', 'approved'],
  ])
  return data.map(planFrom).filter((row): row is PlanRef => row !== null)
}

async function listApprovedPrescriptions(clientId: string): Promise<StoredPrescription[]> {
  const data = await eqRows('prescriptions', 'id, client_id, goal_id, status, approved_at, content, generation_meta', [
    ['client_id', clientId],
    ['status', 'approved'],
  ])
  return data.map(prescriptionFrom).filter((row): row is StoredPrescription => row !== null)
}

async function listInsights(clientId: string, campaignId: string): Promise<InsightRef[]> {
  const data = await eqRows('ad_daily_insights', 'insight_date, spend, results, video_thruplays, messaging_conversations', [
    ['client_id', clientId],
    ['level', 'campaign'],
    ['entity_id', campaignId],
  ])
  return data.map(insightFrom)
}

async function readAccountTimezone(clientId: string, campaignId: string): Promise<string | null> {
  const data = await eqRows('ad_daily_insights', 'ad_account_id', [
    ['client_id', clientId],
    ['level', 'campaign'],
    ['entity_id', campaignId],
  ])
  const ids = new Set(data.map(row => text(asRecord(row)?.ad_account_id)).filter(id => id !== ''))
  if (ids.size !== 1) return null
  return resolveAccountTimezone([...ids][0])
}

async function findCaseId(prescriptionId: string): Promise<string | null> {
  const data = await eqRows('prescription_cases', 'id, created_at', [
    ['prescription_id', prescriptionId],
  ])
  const cases = data.map(caseFrom).filter((row): row is { id: string; createdAt: string } => row !== null)
  return pickLatestCase(cases)
}

async function listOutcomes(caseId: string) {
  const data = await eqRows('prescription_outcomes', 'id, kpi_metric, unit, dimension', [
    ['case_id', caseId],
  ])
  return data.map(outcomeFrom).filter((row): row is NonNullable<ReturnType<typeof outcomeFrom>> => row !== null)
}

async function insertOutcome(row: {
  prescriptionId: string
  caseId: string
  clientId: string
  kpiMetric: string
  unit: string
  dimension: string
}): Promise<void> {
  const { error } = await table('prescription_outcomes').insert({
    prescription_id: row.prescriptionId,
    case_id: row.caseId,
    client_id: row.clientId,
    kpi_metric: row.kpiMetric,
    unit: row.unit,
    dimension: row.dimension,
  })
  if (error) throw new Error('launch check outcome insert failed')
}

async function updateOutcome(id: string, patch: { unit: string; dimension: string }): Promise<void> {
  const { error } = await table('prescription_outcomes').update({
    unit: patch.unit,
    dimension: patch.dimension,
  }).eq('id', id)
  if (error) throw new Error('launch check outcome update failed')
}

async function pageActions(from: number, to: number): Promise<ActionRow[]> {
  const { data, error } = await table('flywheel_actions')
    .select('id, client_id, payload')
    .eq('action_type', 'ads.create_ad')
    .order('id', { ascending: true })
    .range(from, to)
  if (error) throw new Error('launch check scan failed')
  return asList(data).map(actionFrom).filter((row): row is ActionRow => row !== null)
}

async function eqRows(name: string, columns: string, filters: Array<[string, string]>): Promise<unknown[]> {
  let query = table(name).select(columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  const { data, error } = await query
  if (error) throw new Error('launch check read failed')
  return asList(data)
}

function table(name: string): TableApi {
  return supabaseAdmin.from(name) as unknown as TableApi
}

function asList(data: unknown): unknown[] {
  return Array.isArray(data) ? data : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function actionFrom(value: unknown): ActionRow | null {
  const row = asRecord(value)
  const clientId = text(row?.client_id)
  if (!row || clientId === '') return null
  return { id: text(row.id), clientId, payload: row.payload }
}

function planFrom(value: unknown): PlanRef | null {
  const row = asRecord(value)
  const approvedAt = text(row?.approved_at)
  const goalId = goalFromPlan(row?.plan_data)
  if (approvedAt === '' || goalId === '') return null
  return { goalId, approvedAt }
}

function prescriptionFrom(value: unknown): StoredPrescription | null {
  const row = asRecord(value)
  const id = text(row?.id)
  const clientId = text(row?.client_id)
  if (!row || id === '' || clientId === '') return null
  const approvedAt = text(row.approved_at)
  return {
    id,
    clientId,
    goalId: text(row.goal_id),
    status: text(row.status),
    approvedAt: approvedAt === '' ? null : approvedAt,
    kpis: kpisFromContent(row.content),
    effectCard: storedEffectCard(row.generation_meta) ?? null,
  }
}

function insightFrom(value: unknown): InsightRef {
  const row = asRecord(value)
  return {
    insightDate: row && typeof row.insight_date === 'string' ? row.insight_date : null,
    spend: row ? readMetric(row.spend) : null,
    results: row ? readMetric(row.results) : null,
    videoThruplays: row ? readMetric(row.video_thruplays) : null,
    messagingConversations: row ? readMetric(row.messaging_conversations) : null,
  }
}

function caseFrom(value: unknown): { id: string; createdAt: string } | null {
  const row = asRecord(value)
  const id = text(row?.id)
  if (id === '') return null
  return { id, createdAt: text(row?.created_at) }
}

function outcomeFrom(value: unknown): { id: string; kpiMetric: string; unit: string | null; dimension: string | null } | null {
  const row = asRecord(value)
  const id = text(row?.id)
  const kpiMetric = text(row?.kpi_metric)
  if (id === '' || !OURS.has(kpiMetric)) return null
  return {
    id,
    kpiMetric,
    unit: text(row?.unit) === '' ? null : text(row?.unit),
    dimension: text(row?.dimension) === '' ? null : text(row?.dimension),
  }
}

function goalFromPlan(value: unknown): string {
  const promo = asRecord(asRecord(value)?.promo)
  return text(promo?.goal_id)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
