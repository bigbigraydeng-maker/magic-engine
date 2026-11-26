/**
 * One approval chain: this prescription version, its goal, and the single
 * approved plan that still points back at that version.
 * Confirm and the final write both re-read it. A draft is not a source.
 * Two approved plans are a refusal, not a pick. This file does not write.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { planLinkedGoalId } from '@/lib/marketing-plan/promo/plan-pick'

export interface ApprovalSource {
  readonly prescriptionId: string
  readonly version: number
  readonly goalId: string
  readonly planId: string
  readonly planHash: string
  readonly approvedOn: string
}

export type ApprovalRead =
  | { readonly ok: true; readonly source: ApprovalSource }
  | { readonly ok: false; readonly reason: string }

export function sameApprovalSource(saved: ApprovalSource, live: ApprovalSource): boolean {
  return saved.prescriptionId === live.prescriptionId
    && saved.version === live.version
    && saved.goalId === live.goalId
    && saved.planId === live.planId
    && saved.planHash === live.planHash
    && saved.approvedOn === live.approvedOn
}

export function approvalPlanHash(planId: string, contentHash: string | null): string {
  return canonicalHashOfInput({ planId, contentHash })
}

export function approvalCardFields(source: ApprovalSource): Record<string, unknown> {
  return {
    card_prescription_id: source.prescriptionId,
    card_version: source.version,
    card_goal_id: source.goalId,
    card_plan_id: source.planId,
    card_plan_hash: source.planHash,
    card_approved_on: source.approvedOn,
  }
}

export async function readApprovalSource(
  sb: SupabaseClient,
  clientId: string,
  prescriptionId: string,
): Promise<ApprovalRead> {
  const prescription = await one(sb, 'prescriptions', PRESCRIPTION_COLUMNS, clientId, prescriptionId)
  if (prescription === 'unreadable') return fail('处方读不出来，没有出卡。')
  const opened = openPrescription(prescriptionId, prescription)
  if (!opened.ok) return opened
  const goal = await one(sb, 'goals', 'id, client_id, status', clientId, opened.goalId)
  if (goal === 'unreadable') return fail('目标读不出来，没有出卡。')
  const goalReason = goalBlock(goal, clientId)
  if (goalReason) return fail(goalReason)
  const plans = await approvedPlans(sb, clientId)
  if (plans === 'unreadable') return fail('计划读不出来，没有出卡。')
  return pickPlan(opened, plans, clientId)
}

export async function pauseCardWriteBlock(
  sb: SupabaseClient,
  clientId: string,
  input: Readonly<Record<string, unknown>>,
): Promise<string | null> {
  const saved = savedSource(input)
  if (saved === 'absent') return null
  if (saved === 'invalid') return '暂停卡上的批准源读不全，没有去暂停。'
  const live = await readApprovalSource(sb, clientId, saved.prescriptionId)
  if (!live.ok) return live.reason
  if (!sameApprovalSource(saved, live.source)) return '处方的版本、目标或计划变了，没有去暂停。'
  return null
}

const PRESCRIPTION_COLUMNS = 'id, status, version, goal_id, approved_at, generation_meta'

function fail(reason: string): ApprovalRead {
  return { ok: false, reason }
}

interface Opened {
  readonly ok: true
  readonly prescriptionId: string
  readonly version: number
  readonly goalId: string
  readonly approvedOn: string
}

function openPrescription(prescriptionId: string, row: Record<string, unknown> | null): Opened | ApprovalRead {
  if (!row) return fail('找不到这份已批准的处方，没有出卡。')
  if (row.status !== 'approved') return fail('处方还没批准，没有出卡。')
  const version = row.version
  const goalId = row.goal_id
  const approvedOn = dayOf(row.approved_at)
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return fail('处方版本读不到，没有出卡。')
  }
  if (typeof goalId !== 'string' || goalId.length === 0) return fail('处方没有挂增长目标，没有出卡。')
  if (!approvedOn) return fail('处方的批准日期读不到，没有出卡。')
  return { ok: true, prescriptionId, version, goalId, approvedOn }
}

function goalBlock(row: Record<string, unknown> | null, clientId: string): string | null {
  if (!row || row.client_id !== clientId) return '目标已经不在这个客户下，没有出卡。'
  if (row.status !== 'active') return '目标已经不在执行中，没有出卡。'
  return null
}

function pickPlan(opened: Opened, rows: readonly Record<string, unknown>[], clientId: string): ApprovalRead {
  const matched = rows.filter((row) => planMatches(row, opened, clientId))
  if (matched.length === 0) return fail('这一版处方还没有对应的已批准计划，没有出卡。')
  if (matched.length > 1) return fail('同一目标有不止一份已批准计划，没有选用其中一份。')
  const plan = matched[0]
  const planId = text(plan.id)
  if (!planId) return fail('计划读不出来，没有出卡。')
  return {
    ok: true,
    source: {
      prescriptionId: opened.prescriptionId,
      version: opened.version,
      goalId: opened.goalId,
      planId,
      planHash: approvalPlanHash(planId, contentHashOf(plan.generation_meta)),
      approvedOn: opened.approvedOn,
    },
  }
}

function planMatches(row: Record<string, unknown>, opened: Opened, clientId: string): boolean {
  if (row.client_id !== clientId || row.status !== 'approved') return false
  if (planLinkedGoalId(row as never) !== opened.goalId) return false
  const link = planLink(row.generation_meta)
  return link?.prescriptionId === opened.prescriptionId && link.version === opened.version
}

function savedSource(input: Readonly<Record<string, unknown>>): ApprovalSource | 'absent' | 'invalid' {
  if (input.card_prescription_id === undefined) return 'absent'
  const prescriptionId = text(input.card_prescription_id)
  const goalId = text(input.card_goal_id)
  const planId = text(input.card_plan_id)
  const planHash = text(input.card_plan_hash)
  const approvedOn = text(input.card_approved_on)
  const version = input.card_version
  if (!prescriptionId || !goalId || !planId || !planHash || !approvedOn) return 'invalid'
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return 'invalid'
  return { prescriptionId, version, goalId, planId, planHash, approvedOn }
}

function contentHashOf(meta: unknown): string | null {
  const receipt = record(record(meta)?.approval_receipt)
  return text(receipt?.content_hash)
}

function planLink(meta: unknown): { prescriptionId: string; version: number } | null {
  const from = record(record(meta)?.from_prescription)
  const prescriptionId = text(from?.prescription_id)
  const version = from?.version
  if (!prescriptionId || typeof version !== 'number' || !Number.isInteger(version)) return null
  return { prescriptionId, version }
}

function dayOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString().slice(0, 10)
}

async function approvedPlans(
  sb: SupabaseClient,
  clientId: string,
): Promise<Record<string, unknown>[] | 'unreadable'> {
  const { data, error } = await sb
    .from('marketing_plans')
    .select('id, client_id, status, plan_data, generation_meta')
    .eq('client_id', clientId)
    .eq('status', 'approved')
  if (error) return 'unreadable'
  return (data ?? []) as Record<string, unknown>[]
}

async function one(
  sb: SupabaseClient,
  table: string,
  columns: string,
  clientId: string,
  id: string,
): Promise<Record<string, unknown> | null | 'unreadable'> {
  const { data, error } = await sb.from(table).select(columns).eq('id', id).eq('client_id', clientId).maybeSingle()
  if (error) return 'unreadable'
  return (data as Record<string, unknown> | null) ?? null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
