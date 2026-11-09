/**
 * 已批准推广计划缺投放阶段 → 今日待办（按客户去重）。
 * 只读：不改计划、不自动标阶段。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { getActiveClientsWithMetaAccounts } from '@/lib/meta/client-ad-accounts'
import {
  clientHasDeliveringAds,
  loadApprovedPromoDeliveryStage,
} from '@/lib/marketing-plan/promo/approved-delivery-stage'

export type AdsPlanDeliveryStageMissingItemKind = 'ads_plan_delivery_stage_missing'

function promoPlanHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/promo-plan`
}

function deliveryStageMissingItem(clientId: string, clientName: string): ManualItem {
  return {
    kind: 'ads_plan_delivery_stage_missing',
    client_id: clientId,
    client_name: clientName,
    what: `${clientName} 的已批准推广计划还没标「投放阶段」（试投 / 放量 / 稳住）。没有这个标记，每天的素材放量建议和收回稳住建议都不会出确认卡。`,
    how: '打开该客户的推广计划页，在「投放阶段」卡片里看清现在是试投、放量还是稳住；需要换阶段时点「生成放量草稿」等按钮，批准新草稿后再继续跑广告。系统不会替你自动标阶段。',
    href: promoPlanHref(clientId),
  }
}

export async function pushAdsPlanDeliveryStageMissingItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const existing = new Set(
    items.filter((item) => item.kind === 'ads_plan_delivery_stage_missing').map((item) => item.client_id),
  )
  const clients = await getActiveClientsWithMetaAccounts(supabase)
  if (clients.length === 0) return

  for (const client of clients) {
    if (existing.has(client.id)) continue
    const [stageRead, liveAds] = await Promise.all([
      loadApprovedPromoDeliveryStage(supabase, client.id),
      clientHasDeliveringAds(supabase, client.id),
    ])
    if (stageRead === 'query_failed' || liveAds === 'query_failed' || liveAds !== true) continue
    if (stageRead.kind !== 'missing') continue
    const name = client.name || nameOf(client.id)
    items.push(deliveryStageMissingItem(client.id, name))
    existing.add(client.id)
  }
}
