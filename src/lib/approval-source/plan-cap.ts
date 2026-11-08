/**
 * Daily total from the one approved plan the source lock already chose.
 * A second approved plan is not consulted. Campaign budgets are not summed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { dailyTotalCapCents } from '@/lib/marketing-plan/promo/daily-total-cap'
import { readApprovalSource } from './read'

export const MISSING_PLAN_CAP = '已批准的计划里还没有每天广告总上限，没有改。'

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
