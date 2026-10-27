// After a prescription is approved, open one material-only factory signal.
// The existing decideSignal gates still own budget, quota, and angle checks.
// This file does not approve work orders and does not write the creative pool.

import { FACTORY_ORDER_BUDGET_CAP_USD } from './constants'
import { evaluateSignal } from './evaluate'
import { supabaseAdmin } from '@/lib/supabase'

export const PROMOTION_SIGNAL_SOURCE = 'prescription-approved'
export const UNREADABLE = '读不到'
const CAMPAIGN_FALLBACK = '处方已同意'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PromotionSignalResult {
  ok: boolean
  deduped?: boolean
  signal_id?: string
  work_order_id?: string | null
  outcome?: string
  reason?: string
}

export function promotionDedupeKey(prescriptionId: string): string {
  return `prescription-approved:${prescriptionId}`
}

export function campaignNameFromContent(content: unknown): string {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return CAMPAIGN_FALLBACK
  const summary = (content as { summary?: unknown }).summary
  if (typeof summary !== 'string') return CAMPAIGN_FALLBACK
  const line = summary.replace(/\s+/g, ' ').trim()
  return line ? line.slice(0, 80) : CAMPAIGN_FALLBACK
}

export function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 500)
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 500)
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500)
  }
  return UNREADABLE
}

export function buildPromotionSignalRow(input: {
  clientId: string
  prescriptionId: string
  goalId: string
  content: unknown
}): Record<string, unknown> {
  const campaignName = campaignNameFromContent(input.content)
  return {
    client_id: input.clientId,
    signal_type: 'new_campaign',
    source: PROMOTION_SIGNAL_SOURCE,
    dedupe_key: promotionDedupeKey(input.prescriptionId),
    evidence: {
      campaign_name: campaignName,
      goal_id: input.goalId,
      budget_cap_usd: FACTORY_ORDER_BUDGET_CAP_USD,
      deliverable: 'asset_only',
    },
    request: {
      notes: campaignName,
      deliverable: 'asset_only',
    },
  }
}

function rejected(reason: string, extra: Partial<PromotionSignalResult> = {}): PromotionSignalResult {
  return { ok: false, reason: reason.trim() || UNREADABLE, ...extra }
}

async function readDuplicate(dedupeKey: string): Promise<PromotionSignalResult> {
  const { data, error } = await supabaseAdmin
    .from('content_demand_signals')
    .select('id, status, reject_reason, work_order_id')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (error || !data) return rejected(error ? readableError(error) : UNREADABLE, { deduped: true })
  const row = data as { id: string; status: string; reject_reason: string | null; work_order_id: string | null }
  if (row.status === 'accepted' && row.work_order_id) {
    return { ok: true, deduped: true, signal_id: row.id, work_order_id: row.work_order_id, outcome: 'accepted' }
  }
  return rejected(row.reject_reason?.trim() || UNREADABLE, {
    deduped: true,
    signal_id: row.id,
    outcome: row.status,
    work_order_id: row.work_order_id,
  })
}

export async function emitPromotionSignal(input: {
  clientId: string
  prescriptionId: string
  goalId: string | null
  content: unknown
}): Promise<PromotionSignalResult> {
  if (!UUID_RE.test(input.clientId) || !UUID_RE.test(input.prescriptionId)) {
    return rejected('prescription_id_unreadable')
  }
  if (!input.goalId || !UUID_RE.test(input.goalId)) return rejected('goal_unreadable')

  const row = buildPromotionSignalRow({ ...input, goalId: input.goalId })
  const { data, error } = await supabaseAdmin
    .from('content_demand_signals')
    .insert(row)
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return readDuplicate(promotionDedupeKey(input.prescriptionId))
    return rejected(readableError(error))
  }
  const signalId = (data as { id?: string } | null)?.id
  if (!signalId) return rejected(UNREADABLE)

  const result = await evaluateSignal(signalId)
  if (result.outcome === 'accepted' && result.work_order_id) {
    return { ok: true, signal_id: signalId, work_order_id: result.work_order_id, outcome: 'accepted' }
  }
  return rejected(result.reject_reason?.trim() || UNREADABLE, {
    signal_id: signalId,
    outcome: result.outcome,
    work_order_id: result.work_order_id ?? null,
  })
}
