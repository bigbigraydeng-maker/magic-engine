/**
 * 广告开投前「追踪与环境就绪」检查 —— 共享类型（平台通用）。
 *
 * 设计稿：docs/specs/2026-10-19-ads-tracking-preflight-workflow.md
 *
 * 🔴 平台通用：本目录除 client-config.ts 之外的任何文件都不许出现客户名 / 客户 ID /
 *    像素编号 / 域名。客户差异只进 client-config.ts（L4 客户配置），
 *    由 tracking-client-config 契约测试守住。
 * 🔴 只读：本模块不写 Meta、GA4、官网，不发布、不扣费。回执里 no_publish 恒为 true。
 *    绿灯只是「该做的检查都过了」，不是发布 / 扣费授权。
 * 🔴 灰（没读到 / 没证据）永不等于绿，也不等于 0。
 */

import type { Light } from '@/lib/marketing-plan/promo/gates'

/** 开投前的 10 道门。词表封闭：promo/gates.ts 的 GATE_KEYS 直接把它们并进去。 */
export const PREFLIGHT_GATE_KEYS = [
  'tracking.account_dataset_aligned',
  'tracking.pixel_alive',
  'tracking.lead_event_seen',
  'tracking.lead_event_quality',
  'tracking.ga4_events',
  'tracking.landing_ok',
  'tracking.lead_reaches_crm',
  'tracking.capi_ready',
  'env.token_and_crons',
  'env.account_billing',
] as const
export type PreflightGateKey = (typeof PREFLIGHT_GATE_KEYS)[number]

/** 开投后读回的两道门（不进推广计划的批准清单，只进回执和待办）。 */
export const POST_GATE_KEYS = ['post.t1h', 'post.t24h'] as const
export type PostLaunchGateKey = (typeof POST_GATE_KEYS)[number]

export type TrackingGateKey = PreflightGateKey | PostLaunchGateKey

/** 硬门：红或灰 = 不该开投。软门：只提醒。开投后读回的两道门不阻挡任何事（已经开投了）。 */
export const HARD_GATE: Readonly<Record<TrackingGateKey, boolean>> = {
  'tracking.account_dataset_aligned': true,
  'tracking.pixel_alive': true,
  'tracking.lead_event_seen': true,
  'tracking.lead_event_quality': false,
  'tracking.ga4_events': false,
  'tracking.landing_ok': true,
  'tracking.lead_reaches_crm': true,
  'tracking.capi_ready': false,
  'env.token_and_crons': true,
  'env.account_billing': true,
  'post.t1h': false,
  'post.t24h': false,
}

export type EvidenceValue = string | number | boolean | null | readonly (string | number)[]

/** 回执里的一道门。evidence 是读到的事实，给开发核对；绝不放令牌 / 密钥 / 环境变量的值。 */
export interface TrackingGateReceipt {
  key: TrackingGateKey
  status: Light
  /** 一句中文：现在是什么状态 */
  reason: string
  /** 一句中文：不是绿的时候，具体怎么办（开发不用再问第二遍） */
  how: string
  evidence: Record<string, EvidenceValue>
  /** 取数时间（ISO）；没有 = null */
  as_of: string | null
  hard: boolean
  /** 这个客户不适用本项：不计入 overall，也不阻挡开投，也不进推广计划看板。 */
  na?: true
}

/** 回执里随带的待办条目：今日待办直接据此下发，不重算（沿用 WatchReceiptItem 的做法）。 */
export interface TrackingReceiptItem {
  client_id: string
  gate_key: TrackingGateKey
  hard: boolean
  what: string
  how: string
  href: string
}

export type TrackingReadSource = 'meta' | 'ga4' | 'landing' | 'env' | 'crm' | 'insights' | 'budget'

export interface TrackingReadError {
  source: TrackingReadSource
  /** 已清洗（不含令牌、不超过 160 字）的错误文案 */
  error: string
}

export type TrackingTrigger = 'cron' | 'requested' | 'postlaunch'
export type TrackingPhase = 'preflight' | 'post_t1h' | 'post_t24h'

/** 一个客户一次检查的回执。 */
export interface TrackingClientReceipt {
  request_id: string
  client_id: string
  checked_at: string
  trigger: TrackingTrigger
  phase: TrackingPhase
  /** 开投后读回才有：开投时刻（ISO）；开投前的回执是 null */
  launched_at: string | null
  /** 所有「适用」的门里最差的灯；没有适用的门 = gray */
  overall: Light
  /** 没有一道适用的硬门是红或灰。注意：这只是前置条件，不是开投授权。 */
  preconditions_met: boolean
  gates: TrackingGateReceipt[]
  items: TrackingReceiptItem[]
  read_errors: TrackingReadError[]
  no_publish: true
}

/** cron_run_logs.summary 里写的整轮回执（沿用 WatchReceipt 的形状：request_id / checked_at / status / error / no_publish）。 */
export interface TrackingRunReceipt {
  request_id: string
  checked_at: string
  status: 'ok' | 'partial' | 'not_configured'
  error: string | null
  no_publish: true
  trigger: TrackingTrigger
  clients: TrackingClientReceipt[]
}

// ─── 客户配置（L4）──────────────────────────────────────────────────────────

export interface LandingTarget {
  /** 给人看的名字，例如「落地页 A」 */
  label: string
  /** 广告最终落地地址（带 UTM）。只探 site_url 同主机的地址。 */
  url: string
}

/**
 * 一条人工盘点出来、接口读不到的已知问题。到期自动失效，逼着重新核对，不会永远挂着。
 * 作用：把对应的门从绿压到黄，并把说明写进原因里。红 / 灰 / 黄不受影响，只追加说明。
 */
export interface KnownIssue {
  gate: TrackingGateKey
  note: string
  /** 绿灯被压成黄灯时显示的「怎么办」；不写就用兜底说法 */
  how?: string
  /** YYYY-MM-DD：哪天盘点出来的 */
  observed_on: string
  /** YYYY-MM-DD：这天（含）之后不再生效 */
  expires_on: string
}

/**
 * 开投后读回的「自动补排」窗口（和落地页一样，是每次开投一份的配置）。
 * 窗口里每小时看一眼官方账户有没有开始花钱，花了就自己补排 T+1h / T+24h 读回，不靠人记得发事件。
 */
export interface LaunchWatchConfig {
  /**
   * 开始「守着」的那天（YYYY-MM-DD，按下面的时区算日期）。开投日没定的时候，这里写今天、天数配得足够长，
   * 别让窗口在真正开投前过期；T+1h / T+24h 和 96 小时的盯盘从「第一次见到本次系列有花费」起算，不看这里的日期。
   */
  from: string
  /** 窗口一共几天（含 from 当天）。开投日未定时配长一点 */
  days: number
  /** 广告账户的时区（IANA 名字） */
  timezone: string
  /**
   * 本次投放的广告系列编号（至少一个）。花费、点击这些数只按这几个系列算，
   * 不是整个官方账户——账户里别的系列早就在花钱，按账户算会把「开投」误判在窗口第一天。
   */
  campaign_ids: readonly string[]
  /**
   * 第二条认广告系列的办法：名字里同时含有这些关键词（全部含有）。和编号任意一条对上就算本次投放。
   * 为什么要有：用接口建出来的系列先躺在未发布草稿里，发布之后编号会不会变没法事先验证；名字不会跟着变。
   */
  campaign_name_contains?: readonly string[]
  /**
   * 预计开投日（YYYY-MM-DD，账户时区）。设了、且已过这一天 24 小时、盯盘一直找不到本次系列，才会出开发待办；
   * 没设（开投日未定）就只在盯盘回执里记灰（series_found=false），不出待办。
   */
  expected_launch_on?: string
}

/**
 * 按目标盯盘的系列类型：awareness = 播放量；whatsapp = 点广告进 WhatsApp 聊天
 * （「ME 有没有收到」比对的就是 WhatsApp 会话；以后有 Messenger 等再加新类型，不混用）。
 */
export type ObjectiveWatchKind = 'awareness' | 'whatsapp'

/** 按目标盯盘的一个广告系列（只读，不动广告）。 */
export interface ObjectiveWatchSeries {
  /** Meta 广告系列编号 */
  campaign_id: string
  kind: ObjectiveWatchKind
  /** 待办 / 回执里给人看的名字，例如「播放量系列」 */
  label: string
  /** 播放量系列：同一个人平均看到几次算黄灯 / 红灯（严格大于）；不配 = 3 / 4 */
  frequency_yellow?: number
  frequency_red?: number
}

/**
 * 按目标盯盘（每小时盯盘函数的第二件事，和 launch_watch 互相独立）：
 * 播放量系列看完整播放 / 触达 / 频次，聊天系列看开始聊天数 / 单个成本 / ME 有没有收到；
 * 所有系列都盯「改动后一直没花钱」。系列停了就自动不盯。
 */
export interface ObjectiveWatchConfig {
  series: readonly ObjectiveWatchSeries[]
  /** 改动后一直没花钱：多少小时黄灯 / 红灯；不配 = 6 / 24 */
  zero_spend_yellow_hours?: number
  zero_spend_red_hours?: number
}

export interface TrackingClientConfig {
  /** Meta 官方广告账户，带 act_ 前缀 */
  ad_account_id: string
  /** 官网首页（落地页探测只允许这个主机及其 www / 非 www 变体） */
  site_url: string
  landing_targets: LandingTarget[]
  /** Meta 里算「留资」的事件名，默认 ['Lead'] */
  lead_event_names?: string[]
  /** GA4 里算「留资」的事件名，全部要在近 7 天收到才算绿 */
  ga4_lead_events: string[]
  /** 官网表单线索应该进 CRM 吗？false = 该客户没有官网表单，本项不适用 */
  web_form_to_crm: boolean
  /** 计划日预算（最小货币单位，例如分）；null = 没配置 */
  planned_daily_budget_cents: number | null
  /** 官方日上限（同上）；null = 没配置 */
  official_daily_cap_cents: number | null
  currency: string
  known_issues?: KnownIssue[]
  /** 开投后读回的自动补排窗口；不配 = 不自动补排（只能人手发事件） */
  launch_watch?: LaunchWatchConfig
  /** 按目标盯盘的系列清单；不配 = 不盯 */
  objective_watch?: ObjectiveWatchConfig
}

// ─── 事实（各个读取器的输出，也是判定函数的输入）──────────────────────────────

/** 某个数据集的事实。events_* 为 null = 事件统计没读到（不是 0）。 */
export interface MetaDatasetFact {
  id: string
  name: string | null
  /** 最后触发时间（ISO）；null = 从没触发过 / 没读到 */
  last_fired_at: string | null
  events_24h: Record<string, number> | null
  events_7d: Record<string, number> | null
  /** 事件匹配质量（0–10）：事件名 → 分数；null = 没读到 */
  match_quality: Record<string, number> | null
}

export interface MetaAccountFact {
  /** Meta account_status：1 = ACTIVE */
  status: number | null
  disable_reason: number | null
  /** 有没有付款方式；null = 没读到 */
  has_funding_source: boolean | null
  /** 账户花费上限（最小货币单位）；0 或 null = 没设上限 */
  spend_cap_minor: number | null
  amount_spent_minor: number | null
  currency: string | null
}

export interface MetaFacts {
  /** 官方账户的数据集列表读到了吗 */
  read: boolean
  as_of: string
  /** 官方账户名下的全部数据集编号 */
  account_dataset_ids: string[]
  datasets: MetaDatasetFact[]
  account: MetaAccountFact | null
}

export interface LandingProbeFact {
  label: string
  url: string
  /** 最终响应的状态码；null = 没连上 */
  http_status: number | null
  final_url: string | null
  redirects: number
  /** 请求地址里的 UTM 在跳转之后还在不在；null = 请求地址本身没有 UTM */
  utm_preserved: boolean | null
  /** 页面 HTML 里找到的 Meta 像素编号（noscript 图片和 fbq init 两种写法都认） */
  pixel_ids: string[]
  error: string | null
}

export interface LandingFacts {
  probes: LandingProbeFact[]
  as_of: string
}

export interface Ga4Facts {
  read: boolean
  error: string | null
  /** 近 7 天各事件名的次数；没读到时为空对象 */
  events_7d: Record<string, number>
  as_of: string
}

export interface CrmFacts {
  read: boolean
  error: string | null
  web_form_touchpoints_7d: number
  latest_web_form_at: string | null
  /**
   * 本次拿来认「广告落地页」的页面路径（来自落地页配置，已规范化）。
   * 没有这一项 = 没按页面分类（客户没配落地页 / 老回执）：任何官网表单线索都算数。
   */
  ad_landing_paths?: readonly string[]
  /** 近 7 天里来源页就是广告落地页的官网表单线索条数（按读回来的最近 200 条算）；没分类 / 没读到 = 没有这一项 */
  ad_landing_form_touchpoints_7d?: number
  /** 其中最近一条的时间；一条都没有 / 时间读不出来 = null */
  latest_ad_landing_form_at?: string | null
  as_of: string
}

export interface CronJobFact {
  job: string
  max_age_hours: number
  last_finished_at: string | null
  last_status: string | null
}

export interface EnvFacts {
  /** ME 回传（转化 API）目标像素：只比对，绝不写进回执 */
  capi_target: { status: 'configured' | 'not_configured' | 'unreadable'; pixel_id: string | null }
  /** 转化 API 只读探活（令牌有效吗、像素看得见吗）；null = 没跑成 */
  capi_preflight: {
    ok: boolean
    stage: string | null
    token_valid: boolean | null
    pixel_visible: boolean | null
  } | null
  /** 近 7 天回传条数：confirmed / in_doubt / failed；null = 没读到 */
  capi_events_7d: { confirmed: number; in_doubt: number; failed: number } | null
  /** 有没有解析出可用的 Meta 令牌（只记有没有，不记值） */
  meta_token_resolved: boolean
  jobs: CronJobFact[]
  as_of: string
}

/**
 * 客户另外登记的广告账户（不是本次核对的这一个）的事实。全部读自库里的快照，不调 Meta；
 * 完整账户编号不进回执，只留尾号。金额是最小货币单位（分）。
 */
export interface OtherAccountFact {
  /** 账户编号尾号 4 位 */
  tail: string
  /** 绑定表里的账户标签；没有 = null */
  label: string | null
  /** 绑定表里 hidden_from_ad_health = true：只管「广告健康页不显示」，不代表没有预算 */
  hidden: boolean
  /** 快照里的 Meta 账户状态码（1 正常、3 欠款…）；没读到 = null */
  account_status: number | null
  /** 快照里的账户币种（大写）；没读到 = null */
  currency: string | null
  /** 开着的系列个数（effective_status 在 DELIVERING_STATUSES 里、没被标成 disappeared） */
  open_campaign_count: number
  /** 开着的预算：日预算合计 / 终身预算个数 / 参与日预算合计的实体数；口径同 BudgetFacts 的 live_* */
  live_daily_budget_cents: number
  live_lifetime_budget_count: number
  live_entity_count: number
  /** 用的是哪一轮抓全的快照（ISO；账户、系列、广告组三个层级里最早的一轮） */
  snapshot_at: string
}

/**
 * 预算门要用的事实：库里的日预算上限 + Meta 现读的「在投」日预算合计。
 * 上限读库、在投预算读线上，客户配置里写死的数字只剩「跟库对一对」的作用（读不到也不能拿它顶替）。
 * 金额一律是 Meta / 库里的最小货币单位（分），不换算。
 */
export interface BudgetFacts {
  /** 库里的上限 和 Meta 的在投预算 两半都读到了吗（任何一半没读到 = false） */
  read: boolean
  /** 没读到的原因（已清洗，不含令牌）；两半都读到 = null */
  error: string | null
  as_of: string
  /** 库里该广告账户自己的日预算上限；没设 / 没读到 = null（不是 0） */
  account_cap_cents: number | null
  /** 库里该客户的日预算总上限；没设 / 没读到 = null（不是 0） */
  client_cap_cents: number | null
  /** 该客户在库里登记了几个 Meta 广告账户（多账户时不能拿客户总上限顶替账户上限）；没读到 = null */
  registered_account_count: number | null
  /** Meta 现读的在投日预算合计；没读到 = null（不是 0） */
  live_daily_budget_cents: number | null
  /** 在投、但用终身预算（折不出日预算）的个数；只在读到时有意义 */
  live_lifetime_budget_count: number
  /** 参与日预算合计的在投实体数（系列级预算的系列 + 不在这种系列下的广告组）；只在读到时有意义 */
  live_entity_count: number
  /** 其它登记账户的事实：[] = 只有这一个账户；null = 有其它账户但没读成功（判灯回到「只核对这一个账户」的黄） */
  other_accounts: readonly OtherAccountFact[] | null
  /** other_accounts 没读成功的原因（已清洗，不含令牌）；读成功或不需要读 = null */
  other_accounts_error: string | null
}

export interface JudgeInput {
  config: TrackingClientConfig
  now: Date
  meta: MetaFacts
  landing: LandingFacts
  ga4: Ga4Facts
  crm: CrmFacts
  env: EnvFacts
  budget: BudgetFacts
}

/** 开投后读回的事实（本次投放的广告系列的洞察，自开投时刻起）。 */
export interface PostLaunchFacts {
  read: boolean
  error: string | null
  as_of: string
  spend_cents: number
  link_clicks: number
  landing_page_views: number
  leads: number
}
