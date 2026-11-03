import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

interface ReceiptRow {
  id?: unknown
  client_id?: unknown
  generation_meta?: unknown
}

function escalated(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false
  const receipt = (meta as { plan_draft?: unknown }).plan_draft
  if (!receipt || typeof receipt !== 'object') return false
  const row = receipt as { escalated?: unknown; status?: unknown }
  return row.escalated === true && row.status === 'failed'
}

function itemFrom(row: ReceiptRow, nameOf: (id: string) => string): ManualItem | null {
  if (typeof row.client_id !== 'string' || typeof row.id !== 'string') return null
  if (!escalated(row.generation_meta)) return null
  return {
    kind: 'plan_draft_auto_failed',
    client_id: row.client_id,
    client_name: nameOf(row.client_id),
    what: '推广计划草稿连续 3 次没生成。同意卡上看不到计划，后来批准处方也不受影响。',
    how: '打开这个客户的推广计划页看失败原因。这是系统没起草成功，不用去广告后台改预算。',
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(row.client_id)}/promo-plan`,
  }
}

/** Pull-mode: an escalated receipt becomes one today-todo item. */
export async function pushPlanDraftFailureItems(
  supabase: SupabaseClient,
  bucket: ManualItem[],
  clientIds: readonly string[],
  nameOf: (id: string) => string,
): Promise<void> {
  if (clientIds.length === 0) return
  const { data, error } = await supabase
    .from('prescriptions')
    .select('id, client_id, generation_meta')
    .in('client_id', [...clientIds])
    .eq('generation_meta->plan_draft->>escalated', 'true')
    .limit(50)
  if (error) throw new Error('plan draft failure items unreadable')
  for (const row of (data ?? []) as ReceiptRow[]) {
    const item = itemFrom(row, nameOf)
    if (item) bucket.push(item)
  }
}
