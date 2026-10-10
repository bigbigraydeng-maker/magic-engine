/**
 * 一本账（return ladder）· 纯计算模块（无 I/O、无当前时间）。
 *
 * 六个层级：1 花费 → 2 平台口径结果（表单留资 / 开聊）→ 3 有效咨询 → 4 成交（笔数）
 * → 5 成交金额 → 6 回报 = 成交金额 ÷ 广告费。
 *
 * 规矩：
 *  - 时间一律走 `accountDayKey`（账户当地日），绝不拿 ISO 时间戳字符串直接和 YYYY-MM-DD 比。
 *  - 不同币种**永不**相加；金额在最小单位（分）上算，只在最后一步换主单位。
 *  - 读不到的东西（时区、币种、成交周期、配置）一律「判不了」，不许用默认值糊过去。
 *  - 平台通用：本文件不出现任何客户 / 行业 / 广告平台的名字。
 */

import type { CoreMetric } from '../rules/core-metric'
import { accountDayKey } from '../account-timezone'
import type { ConfigSource } from '../config'
import { toMajorUnits } from '@/lib/conversions/money'

/** 一本账的窗口：评估日所在月 + 之前 2 个自然月。 */
export const LADDER_WINDOW_MONTHS = 3
/** 成交少于这个数不下回报结论。⚠️ 暂用值，待 PM 定，不是定论。 */
export const LADDER_MIN_DEALS_FOR_VERDICT = 5
/** 来源不明的成交占比高于这个数，回报写「判不了」。⚠️ 暂用值，待 PM 定 / 待验证，不是定论。 */
export const LADDER_MAX_UNKNOWN_SOURCE_SHARE = 0.5
/** 最新一天花费数据离评估日超过这么多天，就提醒「近 N 天没有新数据」（周报一周一看，所以取 7）。 */
export const LADDER_STALE_AFTER_DAYS = 7

export interface LadderSpendRow {
  adAccountId: string
  platform: string
  /** 账户当地日期 YYYY-MM-DD（库里的 insight_date 本身就是账户当地日） */
  insightDate: string
  spend: number | null
  leads: number | null
  messagingConversations: number | null
}

export interface LadderAccountFact { adAccountId: string; currency: string | null }

export type LadderOutcomeKind = 'purchase' | 'balance' | 'lead'

export interface LadderOutcomeRow {
  id: string
  contactId: string | null
  kind: LadderOutcomeKind
  amountMinor: number | null
  currency: string | null
  /** ISO timestamp (UTC instant) */
  occurredAt: string
  reviewStatus: 'pending_review' | 'approved' | 'rejected'
}

export interface LadderContactFact {
  id: string
  /** ISO timestamp (UTC instant) or null */
  firstSeenAt: string | null
  /** 联系人首次来源的渠道标记（原样，可空） */
  attrPlatform: string | null
}

export interface LadderInput {
  /** 评估日（账户当地、最后一个跑完的自然日）YYYY-MM-DD */
  asOfDate: string
  /** 用来把时间戳换成当地日期的时区；null = 读不到 */
  timezone: string | null
  /** 该客户名下广告账户一共有几个不同时区 */
  timezoneCount: number
  spendRows: readonly LadderSpendRow[]
  accounts: readonly LadderAccountFact[]
  /** 该客户全部未被拒绝的成交事实行（不限窗口，归月要用到窗口外的行） */
  outcomes: readonly LadderOutcomeRow[]
  contacts: readonly LadderContactFact[]
  /** 成交周期（天）；null = 没配置 → 回报判不了，不许用默认值 */
  salesCycleDays: number | null
  primaryResult: CoreMetric | null
  configSource: ConfigSource
  /** 花费行没读全（翻页到上限还没读完） */
  spendIncomplete: boolean
}

export type LevelStatus = 'has' | 'missing' | 'cannot_judge'

/** 花费：主单位，两位小数；currency null = 币种读不到 */
export interface SpendByCurrency { currency: string | null; amount: number }

/** 收入：最小单位整数（分）；currency 原样 */
export interface RevenueByCurrency { currency: string | null; amountMinor: number }

export type ReturnBlocker =
  | 'earlier_level_missing' | 'spend_incomplete' | 'currency_unknown' | 'currency_mismatch' | 'cycle_not_configured'
  | 'no_mature_month' | 'no_spend_in_mature_months' | 'too_few_deals' | 'unknown_source_share_too_high'

export type LadderNote = 'config_unreadable' | 'timezone_unknown' | 'multiple_timezones' | 'spend_incomplete' | 'spend_stale'

export type MonthMaturity = 'mature' | 'immature' | 'not_configured'

export interface LadderMonth {
  /** YYYY-MM —— 线索进来的月份 */
  month: string
  spend: SpendByCurrency[]
  qualified: number
  deals: number
  maturity: MonthMaturity
}

export interface ReturnLadder {
  window: { from: string; to: string }
  /** 从第 1 级起连续「has」的最高一级；0 = 连花费都没有 */
  reachedLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6
  spend: {
    status: LevelStatus; byCurrency: SpendByCurrency[]; daysWithData: number; accountCount: number; platforms: string[]
    latestDate: string | null
    /** 最新一天花费数据离评估日几天；没有数据 = null */
    daysSinceLatest: number | null
  }
  results: { status: LevelStatus; leads: number | null; conversations: number | null; primary: CoreMetric | null; latestDate: string | null }
  /** fromPaid + otherSource + unknownSource = count。otherSource = 有来源标记、但不是这个客户花过钱的渠道 */
  qualified: { status: LevelStatus; count: number; fromPaid: number; otherSource: number; unknownSource: number; pendingReview: number; latestDate: string | null }
  deals: { status: LevelStatus; count: number; fromPaid: number; otherSource: number; unknownSource: number; unplacedMonth: number; leadInBeforeWindow: number; pendingReview: number; latestDate: string | null }
  revenue: { status: LevelStatus; firstPayment: RevenueByCurrency[]; withBalance: RevenueByCurrency[]; latestDate: string | null }
  returnOnSpend: {
    status: 'has' | 'cannot_judge'
    blockers: ReturnBlocker[]
    /**
     * 回报倍数 = 收入 ÷ 广告费；只在 status='has' 时非 null。
     * 分子只算「已走完成交周期的月份里、来源标记是付费渠道」的成交 —— 范围比第 5 级窄。
     */
    firstPaymentBasis: number | null
    withBalanceBasis: number | null
    withBalanceBasisWithoutLargest: number | null
    /** 进了分子的成交单数 */
    dealCount: number
    /** 同范围内来源不明、没进分子的成交单数 */
    unknownSourceDeals: number
    matureMonths: string[]
    immatureMonths: string[]
  }
  months: LadderMonth[]
  notes: LadderNote[]
}

// ---------------------------------------------------------------------------
// 日期工具（纯字符串 / UTC 日历运算）
// ---------------------------------------------------------------------------

/** 把 YYYY-MM-DD 转成 UTC 零点，只用于日历加减。 */
function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

/** UTC 日历加减天数，返回 YYYY-MM-DD。 */
function addDays(day: string, days: number): string {
  const d = parseDay(day)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 该月最后一天 YYYY-MM-DD。 */
function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  // 下个月 0 号 = 本月最后一天。
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

/** 月份字符串加减，返回 YYYY-MM。 */
function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

/** 时间戳 → 账户当地日 YYYY-MM-DD。 */
function localDay(timezone: string | null, iso: string): string {
  return accountDayKey(timezone, new Date(iso))
}

/** 窗口：评估日所在月 + 之前 2 个自然月。 */
export function ladderWindow(asOfDate: string): { from: string; to: string; months: string[] } {
  const month = asOfDate.slice(0, 7)
  const months: string[] = []
  for (let i = LADDER_WINDOW_MONTHS - 1; i >= 0; i--) months.push(addMonths(month, -i))
  const first = months[0] ?? month
  return { from: `${first}-01`, to: asOfDate, months }
}

/** 该月是否已经跑完（最后一天 + 成交周期 <= 评估日）。 */
export function monthMaturity(month: string, asOfDate: string, salesCycleDays: number | null): MonthMaturity {
  if (salesCycleDays === null) return 'not_configured'
  const ready = addDays(lastDayOfMonth(month), salesCycleDays)
  return ready <= asOfDate ? 'mature' : 'immature'
}

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

/** 币种排序：非空按字母序，null 排最后。 */
function compareCurrency(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

/** 两位小数取整（花费主单位）。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 按币种累加，丢掉 0 值，排序。 */
function groupSpend(rows: readonly { currency: string | null; amount: number }[]): SpendByCurrency[] {
  const map = new Map<string | null, number>()
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.amount)
  const out: SpendByCurrency[] = []
  for (const [currency, amount] of map) {
    const rounded = round2(amount)
    if (rounded !== 0) out.push({ currency, amount: rounded })
  }
  return out.sort((a, b) => compareCurrency(a.currency, b.currency))
}

/** 按币种累加（最小单位），丢掉 0 值，排序。 */
function groupRevenue(rows: readonly { currency: string | null; amountMinor: number }[]): RevenueByCurrency[] {
  const map = new Map<string | null, number>()
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.amountMinor)
  const out: RevenueByCurrency[] = []
  for (const [currency, amountMinor] of map) {
    if (amountMinor !== 0) out.push({ currency, amountMinor })
  }
  return out.sort((a, b) => compareCurrency(a.currency, b.currency))
}

/** 最大日期字符串，空数组 → null。 */
function maxDay(days: readonly string[]): string | null {
  if (days.length === 0) return null
  return days.reduce((a, b) => (a >= b ? a : b))
}

// ---------------------------------------------------------------------------
// 第 1 级：花费
// ---------------------------------------------------------------------------

interface SpendLevel {
  status: LevelStatus
  byCurrency: SpendByCurrency[]
  daysWithData: number
  accountCount: number
  platforms: string[]
  latestDate: string | null
  daysSinceLatest: number | null
  /** 窗口内花费 > 0 的平台集合，供「来源是否付费」判定 */
  paidPlatforms: Set<string>
  /** 窗口内花费行（已过滤） */
  rows: LadderSpendRow[]
}

function computeSpendLevel(input: LadderInput, window: { from: string; to: string }): SpendLevel {
  const rows = input.spendRows.filter(r => r.insightDate >= window.from && r.insightDate <= window.to)
  const currencyOf = new Map<string, string | null>()
  for (const a of input.accounts) currencyOf.set(a.adAccountId, a.currency)

  const byCurrency = groupSpend(rows.map(r => ({
    currency: currencyOf.get(r.adAccountId) ?? null,
    amount: r.spend ?? 0,
  })))

  const paid = rows.filter(r => (r.spend ?? 0) > 0)
  const days = new Set(paid.map(r => r.insightDate))
  const accounts = new Set(paid.map(r => r.adAccountId))
  const platforms = Array.from(new Set(paid.map(r => r.platform))).sort()

  const latestDate = maxDay(rows.map(r => r.insightDate))
  const status: LevelStatus = input.spendIncomplete
    ? 'cannot_judge'
    : byCurrency.length > 0 ? 'has' : 'missing'

  return {
    status,
    byCurrency,
    daysWithData: days.size,
    accountCount: accounts.size,
    platforms,
    latestDate,
    daysSinceLatest: latestDate === null ? null : Math.round((parseDay(input.asOfDate).getTime() - parseDay(latestDate).getTime()) / 86_400_000),
    paidPlatforms: new Set(paid.map(r => r.platform)),
    rows,
  }
}

// ---------------------------------------------------------------------------
// 第 2 级：平台口径结果
// ---------------------------------------------------------------------------

interface ResultsLevel {
  status: LevelStatus
  leads: number | null
  conversations: number | null
  primary: CoreMetric | null
  latestDate: string | null
}

function computeResultsLevel(input: LadderInput, spend: SpendLevel): ResultsLevel {
  const rows = spend.rows
  const primary = input.configSource !== 'fallback' ? input.primaryResult : null
  if (rows.length === 0) {
    return { status: 'missing', leads: null, conversations: null, primary, latestDate: spend.latestDate }
  }
  // 整列都读不到 = 不知道，不是 0。
  const sumKnown = (values: readonly (number | null)[]): number | null =>
    values.some(v => v !== null) ? values.reduce<number>((s, v) => s + (v ?? 0), 0) : null
  const leads = sumKnown(rows.map(r => r.leads))
  const conversations = sumKnown(rows.map(r => r.messagingConversations))
  const status: LevelStatus = input.spendIncomplete
    ? 'cannot_judge'
    : leads === null && conversations === null ? 'missing' : 'has'
  return { status, leads, conversations, primary, latestDate: spend.latestDate }
}

// ---------------------------------------------------------------------------
// 归月：一行成交 / 线索算到哪一天（线索进来的那天）
// ---------------------------------------------------------------------------

interface LeadInResolver {
  /** 联系人 → 最早一条 approved lead 的当地日 */
  earliestLeadDay: Map<string, string>
  /** 联系人 → firstSeenAt 当地日 */
  firstSeenDay: Map<string, string>
  /** 联系人 → 首次来源渠道标记 */
  attrPlatform: Map<string, string>
}

function buildLeadInResolver(input: LadderInput): LeadInResolver {
  const earliestLeadDay = new Map<string, string>()
  for (const o of input.outcomes) {
    if (o.kind !== 'lead' || o.reviewStatus !== 'approved' || o.contactId === null) continue
    const day = localDay(input.timezone, o.occurredAt)
    const prev = earliestLeadDay.get(o.contactId)
    if (prev === undefined || day < prev) earliestLeadDay.set(o.contactId, day)
  }
  const firstSeenDay = new Map<string, string>()
  const attrPlatform = new Map<string, string>()
  for (const c of input.contacts) {
    if (c.attrPlatform !== null) attrPlatform.set(c.id, c.attrPlatform)
    if (c.firstSeenAt !== null) firstSeenDay.set(c.id, localDay(input.timezone, c.firstSeenAt))
  }
  return { earliestLeadDay, firstSeenDay, attrPlatform }
}

/** 返回该行的归月日；null = 归不了月（unplaced）。 */
function leadInDay(row: LadderOutcomeRow, input: LadderInput, resolver: LeadInResolver): string | null {
  if (row.kind === 'lead') return localDay(input.timezone, row.occurredAt)
  if (row.contactId !== null) {
    const fromLead = resolver.earliestLeadDay.get(row.contactId)
    if (fromLead !== undefined) return fromLead
    const fromSeen = resolver.firstSeenDay.get(row.contactId)
    if (fromSeen !== undefined) return fromSeen
  }
  return null
}

type SourceKind = 'paid' | 'other' | 'unknown'

/**
 * 这一行的来源：
 *   paid    —— 联系人的来源标记属于「这个客户窗口内真花过钱的渠道」
 *   other   —— 有来源标记，但不是花过钱的渠道（明确不是广告带来的）
 *   unknown —— 没有联系人 / 没有来源标记
 */
function sourceOf(row: LadderOutcomeRow, resolver: LeadInResolver, paidPlatforms: Set<string>): SourceKind {
  if (row.contactId === null) return 'unknown'
  const platform = resolver.attrPlatform.get(row.contactId)
  if (platform === undefined) return 'unknown'
  return paidPlatforms.has(platform) ? 'paid' : 'other'
}

function countSources(rows: readonly LadderOutcomeRow[], resolver: LeadInResolver, paidPlatforms: Set<string>) {
  const kinds = rows.map(r => sourceOf(r, resolver, paidPlatforms))
  return {
    fromPaid: kinds.filter(k => k === 'paid').length,
    otherSource: kinds.filter(k => k === 'other').length,
    unknownSource: kinds.filter(k => k === 'unknown').length,
  }
}

// ---------------------------------------------------------------------------
// 第 3 级：有效咨询
// ---------------------------------------------------------------------------

interface QualifiedLevel {
  status: LevelStatus
  count: number
  fromPaid: number
  otherSource: number
  unknownSource: number
  pendingReview: number
  latestDate: string | null
  /** 计入的 lead 行（供 months 用） */
  counted: LadderOutcomeRow[]
}

function computeQualifiedLevel(
  input: LadderInput,
  window: { from: string; to: string },
  resolver: LeadInResolver,
  paidPlatforms: Set<string>,
): QualifiedLevel {
  const counted: LadderOutcomeRow[] = []
  let pendingReview = 0
  const days: string[] = []

  for (const o of input.outcomes) {
    if (o.kind !== 'lead') continue
    const day = leadInDay(o, input, resolver)
    if (day === null || day < window.from || day > window.to) continue
    if (o.reviewStatus === 'approved') {
      counted.push(o)
      days.push(localDay(input.timezone, o.occurredAt))
    } else if (o.reviewStatus === 'pending_review') {
      pendingReview++
    }
  }

  const count = counted.length
  return {
    status: count > 0 ? 'has' : 'missing',
    count,
    ...countSources(counted, resolver, paidPlatforms),
    pendingReview,
    latestDate: maxDay(days),
    counted,
  }
}

// ---------------------------------------------------------------------------
// 第 4 级：成交
// ---------------------------------------------------------------------------

interface DealsLevel {
  status: LevelStatus
  count: number
  fromPaid: number
  otherSource: number
  unknownSource: number
  unplacedMonth: number
  leadInBeforeWindow: number
  pendingReview: number
  latestDate: string | null
  /** 计入的成交行（供第 5 级 / months 用） */
  counted: LadderOutcomeRow[]
  /** 计入的成交行 → 归月日 */
  countedDay: Map<string, string>
}

function computeDealsLevel(
  input: LadderInput,
  window: { from: string; to: string },
  resolver: LeadInResolver,
  paidPlatforms: Set<string>,
): DealsLevel {
  const counted: LadderOutcomeRow[] = []
  const countedDay = new Map<string, string>()
  const days: string[] = []
  let [unplacedMonth, leadInBeforeWindow, pendingReview] = [0, 0, 0]

  for (const o of input.outcomes) {
    if (o.kind !== 'purchase') continue
    const occurredDay = localDay(input.timezone, o.occurredAt)
    const inWindow = occurredDay >= window.from && occurredDay <= window.to

    if (o.reviewStatus === 'pending_review' && inWindow) pendingReview++
    if (o.reviewStatus !== 'approved') continue

    const day = leadInDay(o, input, resolver)
    if (day === null) {
      // 归不了月：只要钱是窗口内到的就算一单，但不进任何月份、不进回报。
      if (!inWindow) continue
      unplacedMonth++
    } else if (day < window.from) {
      if (inWindow) leadInBeforeWindow++
      continue
    } else if (day > window.to) {
      continue
    } else {
      countedDay.set(o.id, day)
    }

    counted.push(o)
    days.push(occurredDay)
  }

  const count = counted.length
  return {
    status: count > 0 ? 'has' : 'missing',
    count,
    ...countSources(counted, resolver, paidPlatforms),
    unplacedMonth,
    leadInBeforeWindow,
    pendingReview,
    latestDate: maxDay(days),
    counted,
    countedDay,
  }
}

// ---------------------------------------------------------------------------
// 第 5 级：成交金额
// ---------------------------------------------------------------------------

interface RevenueLevel {
  status: LevelStatus
  firstPayment: RevenueByCurrency[]
  withBalance: RevenueByCurrency[]
  latestDate: string | null
}

/**
 * 每笔已确认的尾款只挂到**一单**成交上：同一联系人名下、到账时间不晚于这笔尾款的最近一单。
 * 找不到这样的成交（尾款比哪一单都早）就不挂 —— 宁可少算，不把别的年份的尾款算进来，也不重复加。
 */
function allocateBalances(input: LadderInput): Map<string, LadderOutcomeRow[]> {
  const purchases = input.outcomes.filter(o => o.kind === 'purchase' && o.reviewStatus === 'approved' && o.contactId !== null)
  const byDeal = new Map<string, LadderOutcomeRow[]>()
  for (const b of input.outcomes) {
    if (b.kind !== 'balance' || b.reviewStatus !== 'approved' || b.contactId === null) continue
    const at = Date.parse(b.occurredAt)
    let owner: LadderOutcomeRow | null = null
    for (const p of purchases) {
      if (p.contactId !== b.contactId || Date.parse(p.occurredAt) > at) continue
      if (owner === null || Date.parse(p.occurredAt) > Date.parse(owner.occurredAt)) owner = p
    }
    if (owner !== null) byDeal.set(owner.id, [...(byDeal.get(owner.id) ?? []), b])
  }
  return byDeal
}

function computeRevenueLevel(deals: DealsLevel, balances: Map<string, LadderOutcomeRow[]>): RevenueLevel {
  const amount = (o: LadderOutcomeRow) => ({ currency: o.currency, amountMinor: o.amountMinor ?? 0 })
  const first = deals.counted.map(amount)
  const tails = deals.counted.flatMap(d => (balances.get(d.id) ?? []).map(amount))
  return {
    status: deals.status === 'has' ? 'has' : 'missing',
    firstPayment: groupRevenue(first),
    withBalance: groupRevenue([...first, ...tails]),
    latestDate: deals.latestDate,
  }
}

// ---------------------------------------------------------------------------
// months
// ---------------------------------------------------------------------------

function computeMonths(
  input: LadderInput,
  window: { from: string; to: string; months: string[] },
  spend: SpendLevel,
  qualified: QualifiedLevel,
  deals: DealsLevel,
): LadderMonth[] {
  const currencyOf = new Map<string, string | null>()
  for (const a of input.accounts) currencyOf.set(a.adAccountId, a.currency)

  return window.months.map(month => {
    const monthRows = spend.rows.filter(r => r.insightDate.slice(0, 7) === month)
    const monthSpend = groupSpend(monthRows.map(r => ({
      currency: currencyOf.get(r.adAccountId) ?? null,
      amount: r.spend ?? 0,
    })))
    const qualifiedCount = qualified.counted
      .filter(o => localDay(input.timezone, o.occurredAt).slice(0, 7) === month).length
    const dealCount = deals.counted.filter(o => {
      const day = deals.countedDay.get(o.id)
      return day !== undefined && day.slice(0, 7) === month
    }).length
    return {
      month,
      spend: monthSpend,
      qualified: qualifiedCount,
      deals: dealCount,
      maturity: monthMaturity(month, input.asOfDate, input.salesCycleDays),
    }
  })
}

// ---------------------------------------------------------------------------
// 第 6 级：回报
// ---------------------------------------------------------------------------

interface ReturnLevel {
  status: 'has' | 'cannot_judge'
  blockers: ReturnBlocker[]
  firstPaymentBasis: number | null
  withBalanceBasis: number | null
  withBalanceBasisWithoutLargest: number | null
  dealCount: number
  unknownSourceDeals: number
  matureMonths: string[]
  immatureMonths: string[]
}

/** 已走完成交周期的那几个月里：花了多少、付费来源成了几单。回报只在这个范围里算。 */
interface MatureScope {
  matureMonths: string[]
  immatureMonths: string[]
  /** 进分子的：来源标记是付费渠道 */
  paidDeals: LadderOutcomeRow[]
  /** 来源不明、不进分子的单数 */
  unknownDeals: number
  spend: number
}

function matureScope(
  input: LadderInput, months: readonly string[], spend: SpendLevel, deals: DealsLevel, resolver: LeadInResolver,
): MatureScope {
  const maturityOf = (m: string) => monthMaturity(m, input.asOfDate, input.salesCycleDays)
  const matureMonths = months.filter(m => maturityOf(m) === 'mature')
  const inMature = (day: string | undefined) => day !== undefined && matureMonths.includes(day.slice(0, 7))
  // 归不了月的成交没有 countedDay，天然不进回报。
  const matureDeals = deals.counted.filter(o => inMature(deals.countedDay.get(o.id)))
  return {
    matureMonths,
    immatureMonths: months.filter(m => maturityOf(m) === 'immature'),
    paidDeals: matureDeals.filter(o => sourceOf(o, resolver, spend.paidPlatforms) === 'paid'),
    unknownDeals: matureDeals.filter(o => sourceOf(o, resolver, spend.paidPlatforms) === 'unknown').length,
    spend: spend.rows.filter(r => inMature(r.insightDate)).reduce((s, r) => s + (r.spend ?? 0), 0),
  }
}

/** 主单位金额（分 → 主单位），币种读不到 / 不认识返回 null。 */
function majorOf(amountMinor: number, currency: string | null): number | null {
  if (currency === null) return null
  return toMajorUnits(amountMinor, currency)
}

/** 币种这一关：读不到 / 对不上都不许算回报。 */
function currencyBlockers(spend: SpendLevel, revenue: RevenueLevel): ReturnBlocker[] {
  const blockers: ReturnBlocker[] = []
  const spendCurrencies = spend.byCurrency.map(s => s.currency)
  const revenueCurrencies = revenue.withBalance.map(r => r.currency)
  const unconvertible = revenue.withBalance.some(r => majorOf(r.amountMinor, r.currency) === null)
  if (spendCurrencies.includes(null) || unconvertible) blockers.push('currency_unknown')

  const spendKnown = Array.from(new Set(spendCurrencies.filter((c): c is string => c !== null)))
  const revenueKnown = Array.from(new Set(revenueCurrencies.filter((c): c is string => c !== null)))
  const mismatch = spendKnown.length > 1 || revenueKnown.length > 1
    || (spendKnown.length === 1 && revenueKnown.length === 1 && spendKnown[0] !== revenueKnown[0])
  if (mismatch) blockers.push('currency_mismatch')
  return blockers
}

/** 收集所有适用的 blocker，顺序固定。 */
function collectBlockers(
  input: LadderInput, earlierLevelsComplete: boolean, spend: SpendLevel, revenue: RevenueLevel, scope: MatureScope,
): ReturnBlocker[] {
  const blockers: ReturnBlocker[] = []
  // 🔴 前五级有任何一级没数，第 6 级一律不出数 —— 否则会出现「只到第 2 级」却印着回报倍数。
  if (!earlierLevelsComplete) blockers.push('earlier_level_missing')
  if (input.spendIncomplete) blockers.push('spend_incomplete')
  blockers.push(...currencyBlockers(spend, revenue))
  if (input.salesCycleDays === null) blockers.push('cycle_not_configured')
  if (input.salesCycleDays !== null && scope.matureMonths.length === 0) blockers.push('no_mature_month')
  if (scope.matureMonths.length > 0 && scope.spend === 0) blockers.push('no_spend_in_mature_months')
  if (scope.matureMonths.length > 0 && scope.paidDeals.length < LADDER_MIN_DEALS_FOR_VERDICT) blockers.push('too_few_deals')
  const judged = scope.paidDeals.length + scope.unknownDeals
  if (judged > 0 && scope.unknownDeals / judged > LADDER_MAX_UNKNOWN_SOURCE_SHARE) blockers.push('unknown_source_share_too_high')
  return blockers
}

/** 一单的主单位金额（可含挂在这一单上的尾款）；币种读不到 → null。 */
function dealMajor(deal: LadderOutcomeRow, balances: Map<string, LadderOutcomeRow[]>, includeBalance: boolean): number | null {
  const rows = includeBalance ? [deal, ...(balances.get(deal.id) ?? [])] : [deal]
  let total = 0
  for (const r of rows) {
    const major = majorOf(r.amountMinor ?? 0, r.currency)
    if (major === null) return null
    total += major
  }
  return total
}

/** 多单合计；任何一单算不出就整体算不出。 */
function sumOrNull(values: readonly (number | null)[]): number | null {
  let total = 0
  for (const v of values) {
    if (v === null) return null
    total += v
  }
  return total
}

function computeReturnLevel(
  input: LadderInput, earlierLevelsComplete: boolean, scope: MatureScope,
  spend: SpendLevel, revenue: RevenueLevel, balances: Map<string, LadderOutcomeRow[]>,
): ReturnLevel {
  const blockers = collectBlockers(input, earlierLevelsComplete, spend, revenue, scope)
  const base = {
    blockers, dealCount: scope.paidDeals.length, unknownSourceDeals: scope.unknownDeals,
    matureMonths: scope.matureMonths, immatureMonths: scope.immatureMonths,
  }
  if (blockers.length > 0) {
    return { ...base, status: 'cannot_judge', firstPaymentBasis: null, withBalanceBasis: null, withBalanceBasisWithoutLargest: null }
  }

  const full = scope.paidDeals.map(d => dealMajor(d, balances, true))
  const fullTotal = sumOrNull(full)
  // 剔掉最大一单（按含尾款的金额比）再算一遍：一单大的就能把整个数撑起来，两个数必须一起给。
  const largest = full.reduce<number>((m, v) => (v !== null && v > m ? v : m), 0)
  const ratio = (numerator: number | null): number | null =>
    numerator === null || scope.spend === 0 ? null : round2(numerator / scope.spend)

  return {
    ...base,
    status: 'has',
    firstPaymentBasis: ratio(sumOrNull(scope.paidDeals.map(d => dealMajor(d, balances, false)))),
    withBalanceBasis: ratio(fullTotal),
    withBalanceBasisWithoutLargest: ratio(fullTotal === null ? null : fullTotal - largest),
  }
}

// ---------------------------------------------------------------------------
// reachedLevel / notes
// ---------------------------------------------------------------------------

function computeReachedLevel(
  spend: LevelStatus,
  results: LevelStatus,
  qualified: LevelStatus,
  deals: LevelStatus,
  revenue: LevelStatus,
  returnStatus: 'has' | 'cannot_judge',
): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const chain: LevelStatus[] = [spend, results, qualified, deals, revenue]
  let level = 0
  for (const s of chain) {
    if (s !== 'has') return level as 0 | 1 | 2 | 3 | 4 | 5
    level++
  }
  if (returnStatus === 'has') return 6
  return level as 0 | 1 | 2 | 3 | 4 | 5
}

function computeNotes(input: LadderInput, daysSinceLatest: number | null): LadderNote[] {
  const notes: LadderNote[] = []
  if (input.configSource === 'fallback') notes.push('config_unreadable')
  if (input.timezone === null) notes.push('timezone_unknown')
  if (input.timezoneCount > 1) notes.push('multiple_timezones')
  if (input.spendIncomplete) notes.push('spend_incomplete')
  if (daysSinceLatest !== null && daysSinceLatest > LADDER_STALE_AFTER_DAYS) notes.push('spend_stale')
  return notes
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function computeReturnLadder(input: LadderInput): ReturnLadder {
  const window = ladderWindow(input.asOfDate)
  const spend = computeSpendLevel(input, window)
  const results = computeResultsLevel(input, spend)
  const resolver = buildLeadInResolver(input)
  const qualified = computeQualifiedLevel(input, window, resolver, spend.paidPlatforms)
  const deals = computeDealsLevel(input, window, resolver, spend.paidPlatforms)
  const balances = allocateBalances(input)
  const revenue = computeRevenueLevel(deals, balances)
  const earlierLevelsComplete = [spend.status, results.status, qualified.status, deals.status, revenue.status].every(x => x === 'has')
  const scope = matureScope(input, window.months, spend, deals, resolver)
  const returnOnSpend = computeReturnLevel(input, earlierLevelsComplete, scope, spend, revenue, balances)
  const months = computeMonths(input, window, spend, qualified, deals)

  const { paidPlatforms: _paid, rows: _rows, ...spendOut } = spend
  const { counted: _leads, ...qualifiedOut } = qualified
  const { counted: _deals, countedDay: _days, ...dealsOut } = deals
  return {
    window: { from: window.from, to: window.to },
    reachedLevel: computeReachedLevel(
      spend.status, results.status, qualified.status, deals.status, revenue.status, returnOnSpend.status,
    ),
    spend: spendOut,
    results,
    qualified: qualifiedOut,
    deals: dealsOut,
    revenue,
    returnOnSpend,
    months,
    notes: computeNotes(input, spend.daysSinceLatest),
  }
}
