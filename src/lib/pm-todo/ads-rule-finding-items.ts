/**
 * 每日广告巡检的广告级规则（D2 素材疲劳 / D10 点进去之后差了）→ 下发到「需要你动手」。
 *
 * 只读：只读 `ads_growth_states`、生成待办；系统不会自动改广告。
 * 同一条广告同一个问题按 remind-cadence 节奏提醒（前 3 天每天、之后只周日），不天天刷屏。
 * 数据没拉全（partial）的那天不出 —— 趋势判断在缺数据日最容易假报。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { shouldRemindToday } from './remind-cadence'

export type AdsRuleFindingItemKind = 'ads_rule_finding'

/** 回看多少天的巡察记录来算「连着几天」 */
export const ADS_RULE_LOOKBACK_DAYS = 14
/** 最新一行巡察记录超过这么多天 → 巡察自己停了，这里不拿旧结论说事 */
export const ADS_RULE_STALE_DAYS = 3
/** 同一件事两次命中之间隔几天以内还算「连着」（周五周六待办不跑、巡察偶尔缺一天） */
export const ADS_RULE_STREAK_GAP_DAYS = 3
/** 一条待办的 how 里最多列几条 */
export const ADS_RULE_MAX_LISTED = 3

export const ADS_RULE_CODES: ReadonlySet<string> = new Set(['D2', 'D10'])

export interface RuleFinding {
  code: string
  status: string
  title: string
  units?: Array<{ level: string; id: string; name: string | null }>
  reasons?: string[]
  checkBack?: { after: string; condition: string; fallback: string }
}

export interface GrowthStateRow {
  client_id: string
  date: string // YYYY-MM-DD
  payload: { dataCompleteness?: string; problems?: RuleFinding[] } | null
}

export function adsHealthHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

/** `${code}:${ad unit id}`，取第一个 level 为 'ad' 的 unit；没有就 null。 */
export function findingKey(f: RuleFinding): string | null {
  const ad = f.units?.find((u) => u.level === 'ad')
  return ad ? `${f.code}:${ad.id}` : null
}

/** 一行 payload.problems 里 status 为 'hit' 的 D2/D10（payload/problems 缺失时为空）。 */
export function ruleHits(row: GrowthStateRow): RuleFinding[] {
  const problems = row.payload?.problems
  if (!problems) return []
  return problems.filter((p) => ADS_RULE_CODES.has(p.code) && p.status === 'hit')
}

/** 两个 YYYY-MM-DD 之间差几天（UTC 零点起算，四舍五入）。 */
function dayGap(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * 这个 key 连着命中几天，从该客户最新一行往回数。
 * `rowsNewestFirst` 是**一个客户**按日期倒序的行。逐行看：命中就 +1，
 * 前提是跟上一个计入的命中日期之间不超过 ADS_RULE_STREAK_GAP_DAYS 天；
 * 一旦超过就停。没命中的行直接跳过（它们本身不断连 —— 断连只看日期差）。
 */
export function streakFor(key: string, rowsNewestFirst: readonly GrowthStateRow[]): number {
  let streak = 0
  let lastHitDate: string | null = null
  for (const row of rowsNewestFirst) {
    const hit = ruleHits(row).some((f) => findingKey(f) === key)
    if (!hit) continue
    if (lastHitDate !== null && dayGap(row.date, lastHitDate) > ADS_RULE_STREAK_GAP_DAYS) break
    streak += 1
    lastHitDate = row.date
  }
  return streak
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

/** 最新一行是否够新、且不是 partial。 */
function isUsableNewest(newest: GrowthStateRow, now: Date): boolean {
  if (newest.payload?.dataCompleteness === 'partial') return false
  const today = now.toISOString().slice(0, 10)
  return dayGap(newest.date, today) <= ADS_RULE_STALE_DAYS
}

/** D10 在前、D2 在后，组内保持原顺序。 */
function orderCandidates(findings: readonly RuleFinding[]): RuleFinding[] {
  const rank = (f: RuleFinding): number => (f.code === 'D10' ? 0 : 1)
  return [...findings].sort((a, b) => rank(a) - rank(b))
}

function buildHow(kept: readonly RuleFinding[]): string {
  const listed = kept.slice(0, ADS_RULE_MAX_LISTED)
  const lines = listed.map((f) => `• ${f.title}。${stopLossText(f)}`)
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
 * 顺序：D10 在前、D2 在后，组内保持原顺序。
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

    const candidates = orderCandidates(ruleHits(newest).filter((f) => findingKey(f) !== null))
    const kept = candidates.filter((f) => {
      const key = findingKey(f)
      return key !== null && shouldRemindToday(streakFor(key, clientRows), 0, now)
    })
    if (kept.length === 0) continue

    items.push({
      kind: 'ads_rule_finding',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `${kept.length} 条广告需要你看一眼：${kept[0].title}`,
      how: buildHow(kept),
      href: adsHealthHref(clientId),
    })
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
