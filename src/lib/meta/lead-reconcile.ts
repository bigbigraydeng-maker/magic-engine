/**
 * 对账：广告后台说进了多少个 lead vs CRM 里真的躺着多少个人。
 *
 * WHY
 * ---
 * 这条管道最要命的失败形态是**静默**：令牌少一个权限、主页没绑、表单不属于这个
 * 主页 —— 表现全都一样，就是 CRM 里静悄悄地没有人。而 ME 手里其实早就有对照组：
 * `ad_daily_insights` 每天在记「Meta 说今天来了几个 lead」。两边一减就知道漏没漏。
 *
 * 2026-08-10 实测：Oztop 广告侧 6/24 起累计 70 条 lead，CRM 侧 0 条 —— 差 70。
 *
 * 这个函数同时是三样东西：
 *   · 接客户时的验收口径（同步跑完，两边数字要对得上）
 *   · 今日待办里那条「广告在收人、CRM 一个都没有」的判据
 *   · 以后任何人问「这个客户的 lead 全不全」时的唯一算法（别再各算各的）
 *
 * ⚠️ **两边永远不会严格相等**，差异要能解释，不能一看到不等就当坏了：
 *   · 广告侧按广告账户时区切「天」，CRM 侧按 UTC 时间戳 —— 窗口两头各差几小时；
 *   · 电话和邮箱都不成形的提交不建人（垃圾提交防线），广告侧照样算一条；
 *   · 广告账户里可能有投在**别的主页**上的广告，那个主页没接进来就取不到人；
 *   · Meta 侧 lead 过了保留期就取不到了，回补跑得越晚漏得越多；
 *   · 自然贴文（不花钱）来的表单只会出现在 CRM 侧，广告侧根本没有。
 * 所以判断标准是「差得能解释」，不是「差为零」。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface LeadReconcileWindow {
  /** 含当天，YYYY-MM-DD。 */
  from: string
  /** 含当天，YYYY-MM-DD。 */
  to: string
}

export interface LeadReconcileResult {
  clientId: string
  window: LeadReconcileWindow
  /** Meta 广告后台报的 lead 数（只数 campaign 层，见下）。 */
  adsReportedLeads: number
  /** CRM 里这段时间的表单触点数 —— 一条触点 = 一次表单提交。 */
  crmLeadTouchpoints: number
  /** 这些触点落在多少个人身上（同一个人填两次表算一个人）。 */
  crmContacts: number
  /** 广告侧 − CRM 侧。正数 = 有人没进来。 */
  gap: number
  /** 查询本身出的错。有值时上面的数字**不可信**，别拿去下结论。 */
  error?: string
}

/**
 * ⚠️ 必须按层过滤。`ad_daily_insights` 同一天同一个客户既有 `level='campaign'`
 * 也有 `level='ad'`，两层各自是一份完整的 lead 数（实测 Oztop 两层都是 70）。
 * 不过滤直接 sum = 数字翻倍，而且翻得很像真的。
 */
const INSIGHT_LEVEL = 'campaign'

export async function reconcileClientLeads(
  supabase: SupabaseClient,
  clientId: string,
  window: LeadReconcileWindow,
): Promise<LeadReconcileResult> {
  const base = {
    clientId,
    window,
    adsReportedLeads: 0,
    crmLeadTouchpoints: 0,
    crmContacts: 0,
    gap: 0,
  }

  const { data: insights, error: insightErr } = await supabase
    .from('ad_daily_insights')
    .select('leads')
    .eq('client_id', clientId)
    .eq('level', INSIGHT_LEVEL)
    .gte('insight_date', window.from)
    .lte('insight_date', window.to)

  if (insightErr) return { ...base, error: `广告数据查询失败: ${insightErr.message}` }

  const adsReportedLeads = ((insights ?? []) as Array<{ leads: number | null }>).reduce(
    (n, r) => n + (r.leads ?? 0),
    0,
  )

  // 结束日含当天 → 上界取「次日零点之前」，不能直接拿 `to` 当时间戳比
  // （那样会把结束当天一整天的触点全漏掉）。
  const untilExclusive = new Date(`${window.to}T00:00:00.000Z`)
  untilExclusive.setUTCDate(untilExclusive.getUTCDate() + 1)

  const { data: touchpoints, error: tpErr } = await supabase
    .from('contact_touchpoints')
    .select('contact_id')
    .eq('client_id', clientId)
    .eq('channel', 'meta_lead_form')
    .gte('occurred_at', `${window.from}T00:00:00.000Z`)
    .lt('occurred_at', untilExclusive.toISOString())

  if (tpErr) return { ...base, adsReportedLeads, error: `CRM 触点查询失败: ${tpErr.message}` }

  const rows = (touchpoints ?? []) as Array<{ contact_id: string | null }>
  const crmLeadTouchpoints = rows.length
  const crmContacts = new Set(rows.map((r) => r.contact_id).filter(Boolean)).size

  return {
    ...base,
    adsReportedLeads,
    crmLeadTouchpoints,
    crmContacts,
    gap: adsReportedLeads - crmLeadTouchpoints,
  }
}

/** YYYY-MM-DD（UTC）。`ad_daily_insights.insight_date` 就是这个格式。 */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export interface LeadGapClient extends LeadReconcileResult {
  clientName: string | null
}

/**
 * 「广告在收人，但 CRM 一个都没接到」的客户。
 *
 * 判据刻意是**一个都没有**，不是「差了几条」：差几条有一堆正当解释（见文件头），
 * 天天为此打扰 PM 会让这条提醒很快被无视。而「广告报了 N 条、CRM 零条」只有一种
 * 可能 —— 这条管道对这个客户压根没通。
 */
export async function findClientsWithUnsyncedLeads(
  supabase: SupabaseClient,
  now: Date = new Date(),
  lookbackDays = 30,
): Promise<LeadGapClient[]> {
  const from = isoDay(new Date(now.getTime() - lookbackDays * 86_400_000))
  const to = isoDay(now)

  const { data, error } = await supabase
    .from('clients')
    .select('id, name')
    .eq('client_status', 'active')
  if (error) return []

  const out: LeadGapClient[] = []
  for (const c of (data ?? []) as Array<{ id: string; name: string | null }>) {
    const r = await reconcileClientLeads(supabase, c.id, { from, to })
    // 查询本身失败时什么都别说 —— 「查不出来」不等于「没有」，
    // 拿失败的查询去报「一条都没接到」就是在造假警报。
    if (r.error) continue
    if (r.adsReportedLeads > 0 && r.crmLeadTouchpoints === 0) {
      out.push({ ...r, clientName: c.name })
    }
  }
  return out
}
