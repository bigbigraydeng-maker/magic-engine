/**
 * 巡检广告级结论（D2/D10）的共享门槛：PM 今日待办和客户侧 Magic Bridge 报告共用一份——给客户看的门槛不能比给 PM 看的松（2026-09-26 子牙/魏征）。
 */

/** 最新一行巡察记录超过这么多天 → 巡察自己停了，这里不拿旧结论说事 */
export const ADS_RULE_STALE_DAYS = 3
/** 同一件事两次命中之间隔几天以内还算「连着」（周五周六待办不跑、巡察偶尔缺一天） */
export const ADS_RULE_STREAK_GAP_DAYS = 3
/** 连着这么多次巡察都命中才进待办：只命中一天的多半是波动（2026-09-26 回放：一次单日误报） */
export const ADS_RULE_MIN_STREAK = 2

export const ADS_RULE_CODES: ReadonlySet<string> = new Set(['D2', 'D10', 'D11'])

/** 只给 PM 今日待办用：在客户侧共享的 ADS_RULE_CODES 之外加 D3（花钱没结果，内部提醒，不进客户报告）。 */
export const PM_ADS_RULE_CODES: ReadonlySet<string> = new Set([...ADS_RULE_CODES, 'D3'])
export interface RuleFinding {
  code: string
  status: string
  title: string
  units?: Array<{ level: string; id: string; name: string | null; adAccountId?: string }>
  reasons?: string[]
  checkBack?: { after: string; condition: string; fallback: string }
  notComparableReason?: string
  manualTask?: { what: string; how: string; href: string | null }
  clientVisible?: boolean
  evidence?: Record<string, string | number | boolean | null>
}

export interface GrowthStateRow {
  client_id: string
  date: string // YYYY-MM-DD
  payload: {
    dataCompleteness?: string
    problems?: RuleFinding[]
    adLevelCoverage?: Array<{ adAccountId: string; ran: boolean; reason: string; adsChecked: number }>
  } | null
}

/**
 * 连续命中计数用的钥匙。有广告单位 → `${code}:${广告 id}`；D11（受众池断供，没有广告单位）→ `D11:${evidence.audience_id}`；
 * 其它 → null。不对所有码退回「第一个单位」：单位顺序会变，而且两个池子共用一个组时会撞钥匙（2026-09-27 子牙/魏征）。
 */
export function findingKey(f: RuleFinding): string | null {
  const ad = f.units?.find((u) => u.level === 'ad')
  if (ad) return `${f.code}:${ad.id}`
  // D3 命中在广告组层（没有广告单位）
  if (f.code === 'D3') {
    const adset = f.units?.find((u) => u.level === 'adset')
    return adset ? `D3:${adset.id}` : null
  }
  if (f.code === 'D11' && typeof f.evidence?.audience_id === 'string') return `D11:${f.evidence.audience_id}`
  return null
}

/** 一行 payload.problems 里 status 为 'hit' 的 D2/D10（payload/problems 缺失时为空）。 */
export function ruleHits(row: GrowthStateRow): RuleFinding[] {
  return hitsIn(row, ADS_RULE_CODES)
}

/** PM 待办版：多一个 D3。客户侧不要用这个。 */
export function pmRuleHits(row: GrowthStateRow): RuleFinding[] {
  return hitsIn(row, PM_ADS_RULE_CODES)
}

function hitsIn(row: GrowthStateRow, codes: ReadonlySet<string>): RuleFinding[] {
  const problems = row.payload?.problems
  if (!problems) return []
  return problems.filter((p) => codes.has(p.code) && p.status === 'hit')
}

/** 两个 YYYY-MM-DD 之间差几天（UTC 零点起算，四舍五入）。 */
export function dayGap(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * 这个 key 连着命中几天，从该客户最新一行往回数。
 * `rowsNewestFirst` 是**一个客户**按日期倒序的行。逐行看：命中就 +1，
 * 前提是跟上一个计入的命中日期之间不超过 ADS_RULE_STREAK_GAP_DAYS 天；
 * 一旦超过就停。没命中的行直接断连（隔一天命中一次不算连着）。
 */
export function streakFor(key: string, rowsNewestFirst: readonly GrowthStateRow[]): number {
  let streak = 0
  let lastHitDate: string | null = null
  for (const row of rowsNewestFirst) {
    const hit = pmRuleHits(row).some((f) => findingKey(f) === key)
    if (!hit) break
    if (lastHitDate !== null && dayGap(row.date, lastHitDate) > ADS_RULE_STREAK_GAP_DAYS) break
    streak += 1
    lastHitDate = row.date
  }
  return streak
}

/** 这个 notComparableReason 连着出现几次，从该客户最新一行往回数（同 streakFor 的断连规则）。 */
export function streakForReason(reason: string, rowsNewestFirst: readonly GrowthStateRow[]): number {
  let streak = 0
  let lastHitDate: string | null = null
  for (const row of rowsNewestFirst) {
    const hit = (row.payload?.problems ?? []).some((p) => p.notComparableReason === reason)
    if (!hit) break
    if (lastHitDate !== null && dayGap(row.date, lastHitDate) > ADS_RULE_STREAK_GAP_DAYS) break
    streak += 1
    lastHitDate = row.date
  }
  return streak
}

/** 最新一行是否够新、且不是 partial。 */
export function isUsableNewest(newest: GrowthStateRow, now: Date): boolean {
  if (newest.payload?.dataCompleteness === 'partial') return false
  const today = now.toISOString().slice(0, 10)
  return dayGap(newest.date, today) <= ADS_RULE_STALE_DAYS
}
