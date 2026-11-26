/**
 * Read 投放阶段 from approved promo plans only. Does not write plans or stages.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { hasPromoField, readPromoSpec, type DeliveryStage } from './spec'

export type ApprovedPromoDeliveryStageRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'set'; readonly stage: DeliveryStage }
  | { readonly kind: 'unreadable' }

export function readApprovedPromoDeliveryStage(
  plans: readonly { plan_data?: unknown }[],
): ApprovedPromoDeliveryStageRead {
  const promos = plans.filter((plan) => hasPromoField(plan.plan_data))
  if (promos.length === 0) return { kind: 'none' }
  const stages: DeliveryStage[] = []
  for (const plan of promos) {
    const spec = readPromoSpec(plan.plan_data)
    if (!spec) return { kind: 'unreadable' }
    const stage = spec.delivery?.stage
    if (!stage) return { kind: 'missing' }
    stages.push(stage)
  }
  if (new Set(stages).size !== 1) return { kind: 'unreadable' }
  return { kind: 'set', stage: stages[0]! }
}

export async function loadApprovedPromoDeliveryStage(
  sb: SupabaseClient,
  clientId: string,
): Promise<ApprovedPromoDeliveryStageRead | 'query_failed'> {
  const { data, error } = await sb
    .from('marketing_plans')
    .select('plan_data')
    .eq('client_id', clientId)
    .eq('status', 'approved')
    .limit(50)
  if (error) return 'query_failed'
  return readApprovedPromoDeliveryStage((data ?? []) as { plan_data?: unknown }[])
}

export async function clientHasDeliveringAds(sb: SupabaseClient, clientId: string): Promise<boolean | 'query_failed'> {
  const { data, error } = await sb
    .from('ad_entity_snapshots')
    .select('effective_status')
    .eq('client_id', clientId)
    .in('level', ['ad', 'adset', 'campaign'])
    .order('captured_at', { ascending: false })
    .limit(120)
  if (error) return 'query_failed'
  for (const row of data ?? []) {
    const status = (row as { effective_status?: string | null }).effective_status
    if (status && DELIVERING_STATUSES.has(status)) return true
  }
  return false
}
