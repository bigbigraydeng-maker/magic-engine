/**
 * Content-side todo for a Tune finding that has no usable image.
 * The row is a request, not an ad change.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { nzToday } from '@/lib/ads-strategy/promo-window'
import { APP_BASE } from '@/lib/pm-todo/binding-request-items'
import type { ManualItem } from '@/lib/pm-todo/manual-item-types'
import { TUNE_ACTION, type TuneMarker } from './plan'

export type AdsTuneTicketKind = 'ads_tune_content_ticket'

export async function pushTuneContentTickets(
  sb: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('client_id, payload')
    .eq('action_type', TUNE_ACTION)
    .eq('payload->>nzDay', nzToday(now.getTime()))
    .limit(40)
  if (error) throw new Error('调方内容待办读不出来')
  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ client_id?: unknown; payload?: unknown }>) {
    const item = ticketItem(row.client_id, row.payload, nameOf)
    if (!item || seen.has(`${item.client_id}:${item.what}`)) continue
    seen.add(`${item.client_id}:${item.what}`)
    items.push(item)
  }
}

export function ticketItem(clientId: unknown, payload: unknown, nameOf: (id: string) => string): ManualItem | null {
  if (typeof clientId !== 'string' || !payload || typeof payload !== 'object') return null
  const marker = payload as TuneMarker
  if (marker.kind !== 'ads_tune' || marker.remedy !== 'ticket') return null
  const label = marker.label && marker.label.length <= 40 ? marker.label : '这一组'
  return {
    kind: 'ads_tune_content_ticket',
    client_id: clientId,
    client_name: nameOf(clientId),
    what: `「${label}」需要一条新素材，不然广告调方只能停在建议上。`,
    how: '打开这位客户的确认卡页看是哪一组。去内容工厂出一张已审核、还没用于广告的图。不要自己去广告后台改。',
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/confirmation-cards`,
  }
}
