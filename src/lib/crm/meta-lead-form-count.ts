/**
 * 读 CRM 里 Meta 表单进线（只读，给广告健康页用）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { endOfNzDayMs, nzToday } from '@/lib/ads-strategy/promo-window'

function startOfNzDayMs(day: string): number {
  const end = endOfNzDayMs(day)
  return end - 86_400_000 + 1000
}

/** 某新西兰自然日内的 meta_lead_form 触点数；DB 出错 → null（不是 0）。 */
export async function countMetaLeadFormTouchpointsForNzDay(
  clientId: string,
  nzDay: string,
): Promise<number | null> {
  const startIso = new Date(startOfNzDayMs(nzDay)).toISOString()
  const endIso = new Date(endOfNzDayMs(nzDay)).toISOString()
  const { count, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('channel', 'meta_lead_form')
    .gte('occurred_at', startIso)
    .lte('occurred_at', endIso)
  if (error) {
    console.warn('[crm] meta_lead_form count failed', { clientId, nzDay, error: error.message })
    return null
  }
  return count ?? 0
}

/** 今天（新西兰）的表单进线数。 */
export async function countMetaLeadFormTouchpointsToday(
  clientId: string,
  now: Date = new Date(),
): Promise<number | null> {
  return countMetaLeadFormTouchpointsForNzDay(clientId, nzToday(now.getTime()))
}
