/**
 * 这个客户自己到底有没有在投广告 —— 用**我们直连账户拉回来的真实投放数据**回答。
 *
 * 🔴 为什么必须有这个模块（2026-08-05 实测事故）：
 *    广告采集器判断「有没有在投广告」用的是两个**竞品情报**工具 ——
 *    Apify 爬 Meta 公开广告库、DataForSEO 看搜索结果里有没有广告位。
 *    那是「从外面看别人」的方法，用在自己有直连账户的客户身上就会看走眼：
 *
 *    · CTS 当天真实在投两个广告系列（Retargeting NZ$114.19 / Lead Form NZ$96.88，
 *      合计上万次曝光），Meta 后台明明白白写着 ACTIVE
 *    · 但其中 Lead Form 那条是**表单广告，根本没有网站链接**，
 *      按域名去公开广告库搜自然搜不到
 *    · 于是体检报出「没有检测到任何在投广告」，还标了 high 严重度
 *
 *    这比「没测出来」更糟：这条假发现会喂给下一轮方案，
 *    AI 会给一个正在花钱投广告的客户开出「该开始投广告」的处方。
 *    **错的结论比没有结论更危险。**
 *
 * 所以判断顺序改成：**先看自己账户的真实数据；没有直连账户的客户才退回公开渠道。**
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** 多久内有花费才算「当前在投」。给足周末停投、周期性排期的余量。 */
export const ACTIVE_SPEND_WINDOW_DAYS = 14

export interface OwnAdActivity {
  /** 我们有没有这个客户的真实投放数据（有 = 可以下结论，没有 = 只能退回公开渠道） */
  hasOwnData: boolean
  /** 窗口内的总花费 */
  spend: number
  /** 窗口内的总曝光 */
  impressions: number
  /** 最近一条数据是哪天 */
  latestDate: string | null
}

/**
 * 读这个客户自己的投放数据。
 *
 * 拿不到就返回 `hasOwnData: false` —— **绝不假装成「没在投」**。
 * 「查不到」和「没有」是两件事，混淆它们正是这次事故的根源。
 */
export async function fetchOwnAdActivity(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<OwnAdActivity> {
  const since = new Date(now.getTime() - ACTIVE_SPEND_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supabase
    .from('ad_daily_insights')
    .select('insight_date, spend, impressions')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .gte('insight_date', since)

  if (error || !data || data.length === 0) {
    return { hasOwnData: false, spend: 0, impressions: 0, latestDate: null }
  }

  const rows = data as Array<{ insight_date: string; spend: number | null; impressions: number | null }>
  return {
    hasOwnData: true,
    spend: rows.reduce((s, r) => s + (r.spend ?? 0), 0),
    impressions: rows.reduce((s, r) => s + (r.impressions ?? 0), 0),
    latestDate: rows.map((r) => r.insight_date).sort().at(-1) ?? null,
  }
}

/**
 * 有真实数据时，能不能断定「在投」。
 *
 * 判据只认**花过钱**：有曝光没花费可能是自然触达或历史残留，
 * 而花了钱一定是在投。宁可漏判成「不确定」，也不要误判成「没在投」。
 */
export function isCurrentlyAdvertising(a: OwnAdActivity): boolean {
  return a.hasOwnData && a.spend > 0
}
