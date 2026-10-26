/**
 * 每日广告巡检的广告级规则（D2 素材疲劳 / D10 点进去之后差了 / D11 再营销受众池断供）→ 下发到「需要你动手」。
 *
 * 只读：只读 `ads_growth_states`、生成待办；系统不会自动改广告。
 * 同一条广告同一个问题按 remind-cadence 节奏提醒（前 3 天每天、之后只周日），不天天刷屏。
 * 数据没拉全（partial）的那天不出 —— 趋势判断在缺数据日最容易假报。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { shouldRemindToday } from './remind-cadence'
import {
  ADS_RULE_STALE_DAYS,
  ADS_RULE_MIN_STREAK,
  ADS_RULE_CODES,
  findingKey,
  pmRuleHits,
  streakFor,
  streakForReason,
  isUsableNewest,
  type RuleFinding,
  type GrowthStateRow,
} from '@/lib/ads-strategy/rules/patrol-findings'

export {
  ADS_RULE_STALE_DAYS,
  ADS_RULE_STREAK_GAP_DAYS,
  ADS_RULE_MIN_STREAK,
  ADS_RULE_CODES,
  findingKey,
  ruleHits,
  streakFor,
  type RuleFinding,
  type GrowthStateRow,
} from '@/lib/ads-strategy/rules/patrol-findings'

export type AdsRuleFindingItemKind = 'ads_rule_finding'

/** 回看多少天的巡察记录来算「连着几天」 */
export const ADS_RULE_LOOKBACK_DAYS = 14
/** 一条待办的 how 里最多列几条 */
export const ADS_RULE_MAX_LISTED = 3

export function adsHealthHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

/** 一行止损文案：reasons 里以 '止损：' 开头的，否则用 checkBack 拼，再否则空串。 */
export function stopLossText(f: RuleFinding): string {
  const stop = f.reasons?.find((r) => r.startsWith('止损：'))
  if (stop) return stop
  if (f.checkBack) {
    return `止损：${f.checkBack.after} 后若 ${f.checkBack.condition}，就 ${f.checkBack.fallback}`
  }
  return ''
}

/** 按客户分组，每组按日期倒序。 */
function groupByClient(rows: readonly GrowthStateRow[]): Map<string, GrowthStateRow[]> {
  const byClient = new Map<string, GrowthStateRow[]>()
  for (const row of rows) {
    const list = byClient.get(row.client_id)
    if (list) list.push(row)
    else byClient.set(row.client_id, [row])
  }
  for (const list of byClient.values()) {
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }
  return byClient
}

/** D3（花钱没结果）在前、D10 次之、D2、D11，其余最后；同 rank 内保持原顺序（sort 稳定）。 */
function orderCandidates(findings: readonly RuleFinding[]): RuleFinding[] {
  const rank = (f: RuleFinding): number => {
    if (f.code === 'D3') return 0
    if (f.code === 'D10') return 1
    if (f.code === 'D2') return 2
    if (f.code === 'D11') return 3
    return 4
  }
  return [...findings].sort((a, b) => rank(a) - rank(b))
}

/** 客户级配置缺口（如没登记 Facebook 主页）：最新一行有带 manualTask 的该问题就出一条，不看命中连击。 */
function configGapItem(
  clientId: string,
  clientRows: readonly GrowthStateRow[],
  now: Date,
  nameOf: (id: string) => string,
): ManualItem | null {
  const newest = clientRows[0]
  const gap = (newest?.payload?.problems ?? []).find(
    (p) => p.notComparableReason === 'client_page_unknown' && p.manualTask,
  )
  if (!gap?.manualTask) return null
  if (!shouldRemindToday(streakForReason('client_page_unknown', clientRows), 0, now)) return null
  return {
    kind: 'ads_rule_finding',
    client_id: clientId,
    client_name: nameOf(clientId),
    what: gap.manualTask.what,
    how: gap.manualTask.how,
    href: gap.manualTask.href ?? adsHealthHref(clientId),
  }
}

function findingLines(f: RuleFinding, prevFirst?: string): string[] {
  const lines = [`• ${f.title}`]
  const first = f.reasons?.[0]
  if (first && !first.startsWith('止损：')) {
    lines.push(first === prevFirst ? '  怎么办：同上一条' : `  怎么办：${first}`)
  }
  const stop = stopLossText(f)
  if (stop) lines.push(`  ${stop}`)
  return lines
}

function buildHow(kept: readonly RuleFinding[]): string {
  const listed = kept.slice(0, ADS_RULE_MAX_LISTED)
  const lines = listed.flatMap((f, i) => findingLines(f, listed[i - 1]?.reasons?.[0]))
  const rest = kept.length - listed.length
  if (rest > 0) lines.push(`…另有 ${rest} 条，进广告健康页「要看的事」里看`)
  lines.push('这些系统不会自动改；打开广告健康页看证据和对照，要不要动由你定（一次只改一处）。')
  return lines.join('\n')
}

/**
 * 纯函数：把**所有**行（任意客户、任意顺序）变成每个客户最多一条待办。
 * 每个客户：按日期倒序；最新一行必须在 ADS_RULE_STALE_DAYS 天内（拿 YYYY-MM-DD 跟 now 的 UTC 日期比）
 * 且 payload.dataCompleteness 不是 'partial'，否则跳过。
 * 候选 = 最新一行里 ruleHits 且有 findingKey 的，保留 shouldRemindToday(streakFor(key, rows), 0, now) 为真的。
 * 顺序：D10 → D2 → D11，组内保持原顺序。
 */
export function buildAdsRuleFindingItems(
  rows: readonly GrowthStateRow[],
  now: Date,
  nameOf: (id: string) => string,
): ManualItem[] {
  const items: ManualItem[] = []
  for (const [clientId, clientRows] of groupByClient(rows)) {
    const newest = clientRows[0]
    if (!newest || !isUsableNewest(newest, now)) continue

    const candidates = orderCandidates(pmRuleHits(newest).filter((f) => findingKey(f) !== null))
    // daysSinceLatest 恒传 0：候选只取最新一行，新鲜度由 ADS_RULE_STALE_DAYS 单独卡（巡察记录的日期本来就比今天晚一天）。
    const kept = candidates.filter((f) => {
      const key = findingKey(f)
      if (key === null) return false
      const streak = streakFor(key, clientRows)
      return streak >= ADS_RULE_MIN_STREAK && shouldRemindToday(streak - ADS_RULE_MIN_STREAK + 1, 0, now)
    })

    if (kept.length > 0) {
      items.push({
        kind: 'ads_rule_finding',
        client_id: clientId,
        client_name: nameOf(clientId),
        what: `${kept.length} 件广告的事需要你看一眼：${kept[0].title}`,
        how: buildHow(kept),
        href: adsHealthHref(clientId),
      })
    }

    const gap = configGapItem(clientId, clientRows, now, nameOf)
    if (gap) items.push(gap)
  }
  return items
}

/** IO：读最近 ADS_RULE_LOOKBACK_DAYS 天的 ads_growth_states（client_id, date, payload），生成待办。DB 出错就抛（调用方 .catch）。 */
export async function pushAdsRuleFindingItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - ADS_RULE_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const { data, error } = await supabase
    .from('ads_growth_states')
    .select('client_id, date, payload')
    .gte('date', since)
    .order('date', { ascending: false })
  if (error) throw new Error(`ads_growth_states 读取失败：${error.message}`)

  const rows = (data ?? []) as GrowthStateRow[]
  items.push(...buildAdsRuleFindingItems(rows, now, nameOf))
}
