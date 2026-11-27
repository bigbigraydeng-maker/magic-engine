/**
 * 员工留言写了「要发目录」、目录还没发出去的客人 → 今日待办「要转给客户那边的」。
 *
 * ## 为什么要有这条
 * 留言本身不发信：目录要有人在「交给 AI 跟进」页点一次才发。PM 2026-11-28 查到最近 21 天有 6 位客人留言之后一直没
 * 收到（最早的等了 20 天），收到的也平均隔了一天多。名单页当天就会把他们排在最前面，这条负责让人知道该去点。
 *
 * ## 纪律
 * 一行写操作都没有，不发信；只写人数，不写客人姓名、邮箱、电话；
 * 「谁算要目录」用名单页同一套规则（lib/crm/ai-takeover/catalogue-ask.ts），两边数字对得上；
 * 客户没配目录 = 没有这条；读不到 ≠ 没人在等：取数失败留一条 `catalogue_ask_check_failed`（开发的活）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { askAll } from '@/lib/crm/ai-takeover/catalogue-ask'
import { DEFAULT_PICKUP_CONFIG } from '@/lib/crm/ai-takeover/pickup'
import { decideAll, latestEnquiries, loadInputs } from '@/lib/crm/ai-takeover/pickup-run'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type CatalogueAskItemKind =
  /** 员工留言要发目录、还没发出去 —— 一个客户合成一条 */
  | 'catalogue_ask_waiting'
  /** 这一栏今天没算出来 —— 我们这边要查（开发的活） */
  | 'catalogue_ask_check_failed'

function pickupHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/crm/ai-pickup`
}

export function buildCatalogueAskItems(clientId: string, clientName: string, waiting: number): ManualItem[] {
  if (waiting <= 0) return []
  return [{
    kind: 'catalogue_ask_waiting',
    client_id: clientId,
    client_name: clientName,
    what:
      `${clientName} 有 ${waiting} 位客人，员工留言写了要发目录，目录还没发出去。` +
      '留言本身不会发信，客人还在等',
    how:
      '请转给客户的销售：点链接打开「交给 AI 跟进」，标着「员工留言要目录」的排在最前面，看一眼留言、勾上、点一次发送。' +
      '这些客人只收目录，仍留在员工名单上。留言不是要目录的（例如「客人已经有目录了」），取消勾选就行。',
    href: pickupHref(clientId),
  }]
}

/** 取数依赖，测试里注入假的，生产走默认实现。 */
export interface CatalogueAskDeps {
  /** 这个客户今天有几位在等；null = 客户没配目录，没有这条。读不到就抛。 */
  countWaiting: (supabase: SupabaseClient, clientId: string, now: Date) => Promise<number | null>
}

export const defaultCatalogueAskDeps: CatalogueAskDeps = {
  async countWaiting(supabase, clientId, now) {
    const loaded = await loadEmailSettings(supabase, clientId)
    if (loaded.kind !== 'ok' || !loaded.settings.enabled || !loaded.settings.providers.catalogue) return null
    const leads = await latestEnquiries(supabase, clientId, now)
    if (leads.size === 0) return 0
    const inputs = await loadInputs(supabase, clientId, [...leads.keys()])
    // 名单页同一口径：交给 AI 的规则已经接走的人不算在这条里。
    const taken = new Set(decideAll(inputs, leads, now, DEFAULT_PICKUP_CONFIG).map((p) => p.contactId))
    return askAll(inputs, leads, now).filter((a) => !taken.has(a.contactId)).length
  },
}

function errorSnippet(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg
}

/** 调用方在 `loadManualItems` 里必须挂 `.catch`。逐个客户串行：一个客户取数失败不影响别的客户。 */
export async function pushCatalogueAskItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
  deps: CatalogueAskDeps = defaultCatalogueAskDeps,
): Promise<void> {
  for (const id of ids) {
    const name = nameOf(id)
    try {
      const waiting = await deps.countWaiting(supabase, id, now)
      if (waiting !== null) items.push(...buildCatalogueAskItems(id, name, waiting))
    } catch (err) {
      items.push({
        kind: 'catalogue_ask_check_failed',
        client_id: id,
        client_name: name,
        what: `${name}「员工留言要目录、还没发」这一栏今天没算出来（${errorSnippet(err)}）。这时候没有这条提醒，不等于没有人在等`,
        how: '开发窗口查「交给 AI 跟进」名单的取数（询价、联系记录、发信记录、合格客人阶段设置）哪一处读失败；修好前请员工自己打开「交给 AI 跟进」页看最前面几位。',
        href: pickupHref(id),
      })
    }
  }
}
