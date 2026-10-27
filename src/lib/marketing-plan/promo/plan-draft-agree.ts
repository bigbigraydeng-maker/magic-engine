/**
 * "Agree" on a prescription may carry its plan draft along.
 *
 * Every applicable check green -> the plan is approved with the same click.
 * Any yellow / red / grey, on any phase -> nothing is approved; a confirmation card asks the OPC.
 * Only OPC accounts count. An agent never approves. Plan state only: no Meta draft,
 * no Meta write, no spend, no budget change. A failure here never blocks the
 * prescription agree itself; the outcome is returned and stored for the agree card.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { approvePlan, type ApprovePlanResult } from '@/lib/marketing-plan/approve-plan'
import {
  issueConfirmationCard,
  type CardClicker,
  type ConfirmationCardView,
  type HardCheck,
} from '@/lib/confirmation-card'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { GateResult } from './gates'

export type PlanAgreeStatus =
  | 'approved'
  | 'already_approved'
  | 'needs_confirmation'
  | 'no_draft'
  | 'not_allowed'
  | 'failed'

export interface PlanAgreeOutcome {
  status: PlanAgreeStatus
  text: string
  plan_id: string | null
  /** Hash of the draft content that was approved (approved only). */
  content_hash: string | null
  card: ConfirmationCardView | null
  at: string
}

export const PLAN_AGREE_NO_DRAFT = '没有可以一起批准的计划草稿，只批准了处方。'
export const PLAN_AGREE_NOT_ALLOWED = '计划只认 Magic Lab 内部负责人本人批准，这次没有批计划，只批准了处方。'
export const PLAN_AGREE_APPROVED = '计划草稿的必过检查全部通过，已随「同意」一起批准。还没开投，不会花钱。'
export const PLAN_AGREE_ALREADY = '这份计划之前已经批准过，没有重复处理。'

function failedText(why: string): string {
  return `处方已批准，但计划没有批成：${why}可以到推广计划页单独批准。`
}

/** The plan id this prescription's draft receipt points at, if a usable draft exists. */
export function draftPlanIdOf(generationMeta: unknown): string | null {
  if (!generationMeta || typeof generationMeta !== 'object') return null
  const receipt = (generationMeta as { plan_draft?: unknown }).plan_draft
  if (!receipt || typeof receipt !== 'object') return null
  const { status, plan_id } = receipt as { status?: unknown; plan_id?: unknown }
  if (status !== 'created' && status !== 'already_exists') return null
  return typeof plan_id === 'string' && plan_id.trim() !== '' ? plan_id : null
}

function plainReason(text: string): string {
  return text.replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 170)
}

function cardCheck(result: GateResult): HardCheck {
  const reason = plainReason(result.reason) || '这一项还没通过'
  if (result.light === 'green') return { label: plainReason(result.label), state: 'green', reason: '' }
  // Red is a failed check. Yellow and grey are "not confirmed yet": never shown as passed.
  return {
    label: plainReason(result.label),
    state: result.light === 'red' ? 'red' : 'unread',
    reason,
  }
}

async function cardFor(
  deps: KernelDeps,
  args: { clientId: string; planId: string; clicker: CardClicker; start: string; end: string; checks: GateResult[] },
): Promise<ConfirmationCardView | null> {
  try {
    return await issueConfirmationCard(deps, {
      clientId: args.clientId,
      clicker: args.clicker,
      facts: {
        subjectKey: `plan-approve:${args.planId}`,
        what: '批准推广计划草稿（只改计划状态，不开投）',
        account: '不操作任何广告账户',
        amount: '批准计划本身不花钱，不改预算',
        date: `${args.start} 至 ${args.end}`,
        scope: '只改这份计划的状态，不建广告草稿，不写 Meta',
        hardChecks: args.checks.slice(0, 8).map(cardCheck),
      },
    })
  } catch (err) {
    console.warn('[plan-draft-agree] confirmation card not issued', err instanceof Error ? err.name : 'error')
    return null
  }
}

function make(status: PlanAgreeStatus, text: string, planId: string | null, now: Date, extra?: Partial<PlanAgreeOutcome>): PlanAgreeOutcome {
  return { status, text, plan_id: planId, content_hash: null, card: null, at: now.toISOString(), ...extra }
}

export function noPlanDraftOutcome(now: Date = new Date()): PlanAgreeOutcome {
  return make('no_draft', PLAN_AGREE_NO_DRAFT, null, now)
}

export function failedPlanAgree(planId: string | null, now: Date = new Date()): PlanAgreeOutcome {
  return make('failed', failedText('系统出错了，没有改动这份计划。'), planId, now)
}

function describe(result: ApprovePlanResult): { status: PlanAgreeStatus; text: string } | null {
  switch (result.kind) {
    case 'approved': return { status: 'approved', text: PLAN_AGREE_APPROVED }
    case 'already_approved': return { status: 'already_approved', text: PLAN_AGREE_ALREADY }
    case 'not_found': return { status: 'failed', text: failedText('找不到这份计划草稿。') }
    case 'not_draft': return { status: 'failed', text: failedText('它已经不是草稿状态。') }
    case 'invalid_spec': return { status: 'failed', text: failedText('计划内容格式不合法。') }
    case 'conflict': return { status: 'failed', text: failedText(result.error) }
    default: return null
  }
}

function confirmationText(count: number, carded: boolean): string {
  const base = `计划草稿有 ${count} 项必过检查没有全绿，所以没有自动批准，只批准了处方。`
  return carded
    ? `${base}已出确认卡，请负责人在卡上看过再决定。`
    : `${base}确认卡这次没出成，可以到推广计划页单独处理。`
}

/** Never throws. Called after the prescription itself is approved. */
export async function approvePlanWithAgree(args: {
  clientId: string
  generationMeta: unknown
  approvedBy: string
  clicker: CardClicker
  deps: KernelDeps
  now?: Date
}): Promise<PlanAgreeOutcome> {
  const now = args.now ?? new Date()
  const planId = draftPlanIdOf(args.generationMeta)
  if (!planId) return make('no_draft', PLAN_AGREE_NO_DRAFT, null, now)
  // Agents and non-OPC identities never approve a plan.
  if (args.clicker.kind !== 'opc') return make('not_allowed', PLAN_AGREE_NOT_ALLOWED, planId, now)
  try {
    const result = await approvePlan({
      clientId: args.clientId,
      planId,
      approvedBy: args.approvedBy,
      requireAllGreen: true,
    })
    const plain = describe(result)
    if (plain) {
      const hash = result.kind === 'approved' ? result.receipt.content_hash ?? null : null
      return make(plain.status, plain.text, planId, now, { content_hash: hash })
    }
    const checks = result.kind === 'needs_confirmation' ? result.checks : result.kind === 'blocked' ? result.blockers : []
    if (checks.length === 0) return make('failed', failedText('检查结果读不出来。'), planId, now)
    const start = result.kind === 'needs_confirmation' ? result.planStart : '见计划'
    const end = result.kind === 'needs_confirmation' ? result.planEnd : '见计划'
    const card = await cardFor(args.deps, { clientId: args.clientId, planId, clicker: args.clicker, start, end, checks })
    return make('needs_confirmation', confirmationText(checks.length, card !== null), planId, now, { card })
  } catch (err) {
    console.warn('[plan-draft-agree] plan approval failed', err instanceof Error ? err.name : 'error')
    return failedPlanAgree(planId, now)
  }
}

/** Keep the outcome on the prescription so the agree card still shows it after a reload. Best effort. */
export async function storePlanAgreeOutcome(
  sb: SupabaseClient,
  clientId: string,
  prescriptionId: string,
  outcome: PlanAgreeOutcome,
): Promise<void> {
  try {
    const read = await sb
      .from('prescriptions')
      .select('generation_meta')
      .eq('id', prescriptionId)
      .eq('client_id', clientId)
      .maybeSingle()
    // A failed read must not replace the row with only this outcome.
    if (read.error) return
    const current = (read.data as { generation_meta?: unknown } | null)?.generation_meta
    const base = current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {}
    const stored = {
      status: outcome.status,
      text: outcome.text,
      plan_id: outcome.plan_id,
      content_hash: outcome.content_hash,
      at: outcome.at,
    }
    await sb
      .from('prescriptions')
      .update({ generation_meta: { ...base, plan_approval: stored } })
      .eq('id', prescriptionId)
      .eq('client_id', clientId)
  } catch (err) {
    console.warn('[plan-draft-agree] outcome not stored', err instanceof Error ? err.name : 'error')
  }
}

/** Read the stored outcome back (text only; the card is listed by the confirmation card API). */
export function planAgreeFromMeta(generationMeta: unknown): Omit<PlanAgreeOutcome, 'card'> | null {
  if (!generationMeta || typeof generationMeta !== 'object') return null
  const raw = (generationMeta as { plan_approval?: unknown }).plan_approval
  if (!raw || typeof raw !== 'object') return null
  const { status, text, plan_id, content_hash, at } = raw as Record<string, unknown>
  if (typeof status !== 'string' || typeof text !== 'string') return null
  return {
    status: status as PlanAgreeStatus,
    text,
    plan_id: typeof plan_id === 'string' ? plan_id : null,
    content_hash: typeof content_hash === 'string' ? content_hash : null,
    at: typeof at === 'string' ? at : '',
  }
}
