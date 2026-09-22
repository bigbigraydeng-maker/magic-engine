/**
 * 「这个团名值多少钱」——按团名查真实官网价格，绝不编造金额（Issue #1397 CAPI 续）。
 *
 * 只做精确匹配（去空格、大小写不敏感）。不做模糊/相似度匹配——团名对不上就该让
 * 人去看一眼，而不是让系统猜"这个应该是那个团吧"，猜错一次就是把错的金额发给
 * Meta，撤不回。
 *
 * 复用顺序（Reuse First，不新增抓官网的代码）：
 *   1. `group_tours` 表——ME 自己维护的 CTS 团数据（已发布的团有真实 payload.price）。
 *   2. `src/lib/web-intelligence/first-party-tours.ts`——通用的官网价格 feed 机制，
 *      如果 CTS 域名已经在 `WEB_INTELLIGENCE_FIRST_PARTY_TOUR_SOURCES` 里注册。
 *   两处都没查到 → 返回 null，调用方负责转成人工任务，不猜。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { toMinorUnits } from './money'
import { loadFirstPartyTourProducts } from '@/lib/web-intelligence/first-party-tours'

export interface TourPrice {
  amountMinor: number
  currency: string
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** 从 "From NZD $4,999 per person" 这类展示字符串里抠出金额和币种。抠不出来返回 null。 */
export function parsePriceDisplayString(raw: string | null | undefined): TourPrice | null {
  if (!raw) return null
  const m = raw.match(/\b([A-Z]{3})\b[^\d]*\$?\s*([\d,]+(?:\.\d+)?)/)
  if (!m) return null
  const currency = m[1].toUpperCase()
  const amountStr = m[2].replace(/,/g, '')
  const amountMinor = toMinorUnits(amountStr, currency)
  return amountMinor != null ? { amountMinor, currency } : null
}

interface GroupTourRow {
  payload: { name?: string; title?: string; price?: string } | null
}

async function lookupFromGroupTours(
  supabase: SupabaseClient,
  clientId: string,
  tourName: string,
): Promise<TourPrice | null> {
  const { data } = await supabase
    .from('group_tours')
    .select('payload')
    .eq('client_id', clientId)
    .eq('status', 'published')

  const rows = (data ?? []) as GroupTourRow[]
  const target = norm(tourName)
  const match = rows.find((r) => {
    const name = r.payload?.name ? norm(r.payload.name) : null
    const title = r.payload?.title ? norm(r.payload.title) : null
    return name === target || title === target
  })
  return match ? parsePriceDisplayString(match.payload?.price) : null
}

async function lookupFromFirstPartyFeed(domain: string | null, tourName: string): Promise<TourPrice | null> {
  const products = await loadFirstPartyTourProducts(domain)
  const target = norm(tourName)
  const match = products.find((p) => norm(p.name) === target)
  return match ? parsePriceDisplayString(match.price) : null
}

/**
 * 按团名查价，两个来源都试过再放弃。`websiteDomain` 传 null 就跳过官网 feed 那一步
 * （比如还没确认 CTS 域名有没有注册这个 feed）。
 */
export async function lookupTourPrice(
  supabase: SupabaseClient,
  clientId: string,
  tourName: string,
  websiteDomain: string | null,
): Promise<TourPrice | null> {
  const fromGroupTours = await lookupFromGroupTours(supabase, clientId, tourName)
  if (fromGroupTours) return fromGroupTours
  return lookupFromFirstPartyFeed(websiteDomain, tourName)
}
