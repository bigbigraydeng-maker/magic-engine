/**
 * Daily total from the one approved plan the source lock already chose.
 * A second approved plan is not consulted. Campaign budgets are not summed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { dailyTotalCapCents } from '@/lib/marketing-plan/promo/daily-total-cap'
import { readApprovalSource } from './read'

export const MISSING_PLAN_CAP = '已批准的计划里还没有每天广告总上限，没有改。'
export const FILL_PLAN_DAILY_CAP = '在广告计划里填上每天的广告总上限。'
const PLAN_CAP_DISAGREE = '已批准的计划上每天广告总上限不一致，没有选用其中一份。'
const PLAN_CAP_UNREADABLE = '已批准的计划读不出来。'

export type ClientDailyTotalCap =
  | { state: 'set'; cents: number }
  | { state: 'missing'; reason: string }
  | { state: 'unreadable'; reason: string }

function hasPromo(planData: unknown): boolean {
  if (!planData || typeof planData !== 'object' || Array.isArray(planData)) return false
  const promo = (planData as { promo?: unknown }).promo
  return promo !== null && typeof promo === 'object' && !Array.isArray(promo)
}

/**
 * One number for the client. Approved promo plans must agree.
 * A plan with no cap, or two different caps, is missing — not zero, not a pick.
 */
export function agreedPlanDailyTotalCap(
  rows: readonly { status?: unknown; plan_data?: unknown }[],
): ClientDailyTotalCap {
  const promo = rows.filter((row) => (
    (row.status === undefined || row.status === 'approved') && hasPromo(row.plan_data)
  ))
  if (promo.length === 0) return { state: 'missing', reason: FILL_PLAN_DAILY_CAP }
  const caps = promo.map((row) => dailyTotalCapCents(row.plan_data))
  if (caps.some((cents) => cents === null)) return { state: 'missing', reason: FILL_PLAN_DAILY_CAP }
  const unique = new Set(caps)
  if (unique.size !== 1) return { state: 'missing', reason: PLAN_CAP_DISAGREE }
  return { state: 'set', cents: caps[0] as number }
}

/** The client's daily total from approved promo plans. Does not read the old client column. */
export async function readClientDailyTotalCap(
  sb: SupabaseClient,
  clientId: string,
): Promise<ClientDailyTotalCap> {
  const { data, error } = await sb
    .from('marketing_plans')
    .select('id, client_id, status, plan_data')
    .eq('client_id', clientId)
    .eq('status', 'approved')
  if (error) return { state: 'unreadable', reason: PLAN_CAP_UNREADABLE }
  return agreedPlanDailyTotalCap((data ?? []) as { status?: unknown; plan_data?: unknown }[])
}

export async function readPlanDailyTotalCap(
  sb: SupabaseClient,
  clientId: string,
  planId: string,
): Promise<{ ok: true; cents: number } | { ok: false; reason: string }> {
  const { data, error } = await sb
    .from('marketing_plans')
    .select('id, client_id, status, plan_data')
    .eq('id', planId)
    .eq('client_id', clientId)
    .eq('status', 'approved')
    .maybeSingle()
  if (error) return { ok: false, reason: '已批准的计划读不出来，没有改。' }
  const cents = dailyTotalCapCents((data as { plan_data?: unknown } | null)?.plan_data)
  if (cents === null) return { ok: false, reason: MISSING_PLAN_CAP }
  return { ok: true, cents }
}

export async function readApprovedDailyTotalCap(
  sb: SupabaseClient,
  clientId: string,
  prescriptionId: string,
): Promise<{ ok: true; cents: number } | { ok: false; reason: string }> {
  if (!prescriptionId) {
    return { ok: false, reason: '没有这条批准链，读不到计划上的每天广告总上限，没有改。' }
  }
  const source = await readApprovalSource(sb, clientId, prescriptionId)
  if (!source.ok) return { ok: false, reason: '没有这条批准链上的每天广告总上限，没有改。' }
  return readPlanDailyTotalCap(sb, clientId, source.source.planId)
}
