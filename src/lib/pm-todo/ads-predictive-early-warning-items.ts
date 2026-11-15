import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { readTodoState } from '@/lib/ads-strategy/monitoring/predictive-early-warning/switch'
import { accountDayKey } from '@/lib/ads-strategy/intraday-spend/sample'

export type AdsPredictiveEarlyWarningItemKind = 'ads_predictive_early_warning_alert'

const NZ_TZ = 'Pacific/Auckland'

export async function pushAdsPredictiveEarlyWarningItems(
  supabase: SupabaseClient,
  bucket: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
): Promise<void> {
  const day = accountDayKey(NZ_TZ, now)
  if (!day) return
  const { data, error } = await supabase.from('clients').select('id, name, leads_config')
  if (error) return
  for (const row of data ?? []) {
    const r = row as { id?: string; name?: string | null; leads_config?: unknown }
    const clientId = r.id
    if (typeof clientId !== 'string') continue
    const todo = readTodoState(r.leads_config, day)
    if (!todo || todo.items.length === 0) continue
    const name = r.name || nameOf(clientId)
    for (const item of todo.items) {
      bucket.push({
        kind: 'ads_predictive_early_warning_alert',
        client_id: clientId,
        client_name: name,
        what: item.what,
        how: item.how,
        href: item.href,
      })
    }
  }
}