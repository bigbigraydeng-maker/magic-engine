/**
 * 广告作战地图 S1 · 数据形状（只读页面，不建表、不加定时任务）。
 *
 * 设计稿：docs/specs/2026-10-16-ads-war-map-page-design-v0.1.md
 *
 * 🔴 三种「没有数」必须分开，不许渲染成 0：
 *    读不到（接口出错）· 还没有 / 过期了（今天没有这一行，或最新一行太旧）· 判不了（数据不全 / 人数是显示下限）。
 *    这里统一用 `Light = 'unknown'` + 一句话原因表达「判不了」；「读不到」由 API 返回 error 字段表达。
 * 🔴 「正常」只能在数据新、读得全的时候说；数据停了或不全，一律不许绿（魏征 2026-10-16 复审）。
 */

export type Light = 'green' | 'yellow' | 'red' | 'unknown'

// ── 输入（从库里读出来的原始行，已经去重到「每个实体一行」，并去掉「已消失」的实体）──

export interface AccountInput {
  adAccountId: string
  /** 账户在 Meta 里的名字（个人号会是一个人名）；读不到就是 null */
  name: string | null
  /** Meta account_status：1 = 正常，3 = 一般是欠款未结，其它见 Meta 文档；null = 读不到 */
  statusCode: number | null
  /** 这个状态是哪一轮快照读的（ISO）。太旧的状态不能说「正常」 */
  capturedAt: string | null
  /** 账户时区，池子按它划「哪一天」；null = 按 UTC（与 D11 一致） */
  timezoneName: string | null
}

export interface AudienceInput {
  id: string
  name: string | null
  adAccountId: string
  /** Meta 给的人数下限；null = 没读到；−1 = Meta 返回「取不到」；≤ 1000 是显示下限，不是真实人数 */
  countLower: number | null
  /** 这个人数是哪一轮快照读的（ISO） */
  capturedAt: string | null
  /** Meta audience_subtype，如 ENGAGEMENT / CUSTOM / LOOKALIKE */
  subtype: string | null
  /** 收人规则里的事件（判断是不是视频池要用） */
  ruleEvents: string[]
}

/** 一个池子在某一轮快照里的人数（用来看近 7 天长没长） */
export interface AudienceHistoryPoint {
  audienceId: string
  capturedAt: string
  countLower: number | null
}

export interface AdsetInput {
  id: string
  /** Meta effective_status。注意：账户欠款时它仍可能是 ACTIVE，不等于真在投 */
  effectiveStatus: string | null
  includedAudienceIds: string[]
}

export interface CampaignFrequencyInput {
  campaignId: string
  campaignName: string | null
  adAccountId: string
  /** 窗口（数据日往前 7 天）内的花费，账户币种主单位 */
  spend7d: number
  /** 窗口内最近一个非空的 7 天不重复频率；null = 没有 */
  frequency7d: number | null
}

export interface GrowthProblemInput {
  code: string
  title: string
  /** 怎么办（人话）；没有就是 null */
  how: string | null
}

export interface GrowthInput {
  /** 经营视图这一行是哪天写的（YYYY-MM-DD）。不是今天就是旧的 */
  date: string
  /** 目标标题；这条进度对的是哪个目标 */
  goalTitle: string | null
  /** 目标进度结论的一句话（例如「落后线性节奏 65.7%」） */
  paceReason: string | null
  problems: GrowthProblemInput[]
  opportunities: Array<{ code: string; title: string }>
}

export interface PlanPhaseInput {
  name: string
  /** YYYY-MM-DD */
  startDate: string
  endDate: string
}

export interface PlanInput {
  /** 计划还是草稿时，阶段日期只是「计划里写的日子」，不等于广告真的开了 */
  status: 'draft' | 'approved'
  phases: PlanPhaseInput[]
  /** 计划挂的目标标题；读不到 = null */
  goalTitle: string | null
}

export interface WarMapInput {
  /** 现在（ISO），用来算倒计时和「过期没有」；放进输入是为了测试可重放 */
  now: string
  accounts: AccountInput[]
  audiences: AudienceInput[]
  audienceHistory: AudienceHistoryPoint[]
  adsets: AdsetInput[]
  campaigns: CampaignFrequencyInput[]
  /** 数据日 = ad_daily_insights 里最新的 insight_date；取数时间 = 最新的 fetched_at */
  clocks: { dataDay: string | null; fetchedAt: string | null }
  /** null = 经营视图一行都没有 */
  growth: GrowthInput | null
  /** null = 没有推广计划 */
  plan: PlanInput | null
  /** 素材池里「已批准」的条数；null = 读不到素材池 */
  creativePoolApproved: number | null
}

// ── 输出（页面直接渲染）────────────────────────────────────────────────

export interface Headline {
  light: Light
  /** 一句大白话，PM 只看这三句 */
  sentence: string
}

export interface CountdownView {
  planStatus: 'draft' | 'approved' | null
  phaseName: string | null
  launchDate: string | null
  targetDate: string | null
  /** 距计划开投日几天；负数 = 已过；null = 没有计划 */
  daysToLaunch: number | null
  daysToTarget: number | null
}

export interface AccountView {
  adAccountId: string
  name: string
  statusCode: number | null
  capturedAt: string | null
  light: Light
  sentence: string
}

export type PoolTrend = 'growing' | 'flat' | 'shrinking' | 'unknown'

export interface PoolRow {
  id: string
  name: string
  accountName: string
  /** null = 判不了（没读到 / −1） */
  sizeLower: number | null
  sizeNote: string
  trend: PoolTrend
  trendNote: string
  /** 设置里有几个广告组把它当受众（账户欠款时不等于真在投） */
  usedByAdsets: number
  light: Light
}

export interface FrequencyRow {
  campaignId: string
  campaignName: string
  accountName: string
  frequency7d: number | null
  spend7d: number
  light: Light
  note: string
}

export type ActionSeverity = 'red' | 'yellow' | 'info'
/** pm = 要你本人做 · agent = 系统/我去查 · dev = 开发 */
export type ActionOwner = 'pm' | 'agent' | 'dev'

export interface ActionRow {
  key: string
  severity: ActionSeverity
  what: string
  how: string
  owner: ActionOwner
}

export interface GoalNote {
  title: string
  paceReason: string | null
  /** 只陈述事实：这条进度对的是哪个目标、当前计划挂的是哪个 */
  warning: string
}

export interface WarMapView {
  generatedAt: string
  countdown: CountdownView
  clocks: { dataDay: string | null; fetchedAt: string | null }
  accounts: AccountView[]
  pools: { headline: Headline; rows: PoolRow[]; hiddenCount: number }
  /** windowLabel：花费和频率对应的真实日期区间（数据日往前 7 天），如「10/4–10/10」 */
  frequency: { headline: Headline; rows: FrequencyRow[]; windowLabel: string | null }
  adjust: { headline: Headline; actions: ActionRow[] }
  goalNote: GoalNote | null
}
