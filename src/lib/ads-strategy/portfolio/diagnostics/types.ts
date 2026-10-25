/**
 * 广告只读诊断 · 类型契约（ads IMPACT 阶段 1，设计 §3.3 + §14 M4–M9）。
 *
 * 🔴 全部只读：诊断只产出结论与证据，不产出任何对 Meta 的写入、不产出预算处方。
 * 🔴 每条结论带证据与样本量；判不了就是 not_comparable，并写明为什么判不了。
 * 🔴 平台共享：不许出现客户名、客户 ID、行业判断；数字门槛是平台默认参数（见 thresholds.ts）。
 *
 * D2（素材疲劳）、D10（点进去之后差了）是广告级规则（d2-d10-ad-rules.ts，设计 docs/specs/2026-09-26-ads-ad-level-rules-d2-d10-design.md）。
 * D6（行业先验）本阶段不实现，只保留代码位。
 */

import type { EntitySnapshotRow } from '../snapshot'
import type { Confidence, FunnelRole } from '../roles'
import type { OutcomeConfig } from '../outcome-ladder'

/**
 * D* = 问题（诊断，"哪里不对"）· O* = 机会（"哪里还有空间"，spec 2026-09-24 §3 G3）。
 * 两者形状完全相同、走同一条日报和看板管道；区别只在 code 前缀和 clientVisible 默认值。
 */
export type DiagnosisCode =
  | 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7' | 'D8' | 'D9' | 'D10' | 'D11'
  | 'O1' | 'O2' | 'O3' | 'O4'
export type DiagnosisStatus = 'hit' | 'not_comparable'

export type NotComparableReason =
  | 'no_hourly_data'
  | 'night_trough'
  | 'scheduled_delivery'
  | 'report_lag'
  | 'target_cost_not_configured'
  | 'outcome_not_configured'
  | 'primary_result_unknown'
  | 'primary_not_attributable'
  | 'audience_below_floor'
  | 'audience_too_new'
  | 'page_audience_unverifiable'
  | 'no_video_creatives'
  | 'missing_data'
  | 'cbo_internal'
  | 'shared_account'
  | 'below_min_sample'
  | 'single_unit'
  | 'insufficient_days'   // 窗口内可用天数不够，判不了趋势
  | 'no_awareness_spend'  // 没有破冰花费，漏斗缺位这条无从谈起
  | 'recently_changed'    // 基线期内本广告/广告组/系列改过设置或整组断投，自身前后比不可信（§13 学习期）
  | 'client_page_unknown' // 客户没登记 Facebook 主页，分不清账户里哪些广告是这个客户的
  | 'capture_stale'       // 广告层快照最近一轮没抓全或太旧，归属核实不到（区别于 client_page_unknown：客户是登记了主页的，是数据管线的问题）

export interface DiagnosisUnit {
  level: 'account' | 'campaign' | 'adset' | 'ad'
  id: string
  name: string | null
  adAccountId: string
  role?: FunnelRole
  roleConfidence?: Confidence
}

/** 样本量：数字必须跟它的样本量一起出现（「$27.83 · 基于 1 次对话」）。 */
export interface SampleSize {
  label: string
  value: number
}

/** 下发给人的任务三件套（D7 用；D 系列只读，发现授权/数据问题不自动修）。 */
export interface ManualTask {
  what: string
  how: string
  href: string | null
}

export interface Diagnosis {
  code: DiagnosisCode
  status: DiagnosisStatus
  /** 内部日报用的一句话（中文、人话） */
  title: string
  units: DiagnosisUnit[]
  evidence: Record<string, string | number | boolean | null>
  sample: SampleSize[]
  reasons: string[]
  notComparableReason?: NotComparableReason
  /** §14 C6：D1、D3 未来可给客户看（须带处理状态）；D7、D8 永不进客户版。阶段 1 只发内部。 */
  clientVisible: boolean
  /** 自动暂停消费端只处理 !== false 的 D3 命中；false = 只提醒（类似人群 / 流量组）。缺省 = 原行为。 */
  autoPauseEligible?: boolean
  manualTask?: ManualTask
  /**
   * 给人的回头检查约定（D2/D10）：什么时候回来看、看什么、不成就退回什么。
   * 🔴 没有任何程序会在到期时回头检查——这是写给人的，不是闭环；也不叫 stopLoss，
   *    免得跟真正执行降预算/暂停的 `ads-strategy/stop-loss.ts` 混淆。
   */
  checkBack?: CheckBack
}

export interface CheckBack {
  /** 人话时点，如「7 天后（约 2026-10-03）」 */
  after: string
  /** 到时看什么、什么算不成 */
  condition: string
  /** 不成就做什么 */
  fallback: string
}

/** ad_daily_insights 一行（诊断需要的列）。 */
export interface DailyRow {
  level: 'campaign' | 'adset' | 'ad'
  entity_id: string
  parent_id: string | null
  insight_date: string
  spend: number
  impressions: number
  reach: number | null
  clicks: number
  leads: number
  messaging_conversations: number
  video_thruplays: number | null
  actions: ReadonlyArray<{ action_type: string; value: string }> | null
  /** 系列层才有、且只有最新一天有值的 7 天去重频次（D2 分型用）；其它层/其它天为 null 或缺省 */
  frequency_7d?: number | null
}

/** 一次设置变更（从快照 capture_reason = changed / kernel_post 抽出来，D2/D10 的「最近改过」闸用）。 */
export interface SettingChange {
  level: 'account' | 'campaign' | 'adset' | 'ad' | 'audience'
  entity_id: string
  captured_at: string
}

/** 某个受众某次抓取时的人数下限（Meta 显示值，按百取整；≤1000 = 显示下限，判不了）。 */
export interface AudienceCountPoint {
  entity_id: string
  captured_at: string
  audience_count_lower: number | null
}

/** 某天某小时（账户时区）某广告组的花费。不入库，只在 D1 预筛命中后按需拉。 */
export interface HourlyRow {
  adset_id: string | null
  campaign_id: string | null
  hour: number
  spend: number
}

export interface CaptureCoverage {
  level: string
  complete: boolean
  skipped_shared: boolean
  error: string | null
  captured_at: string
}

export interface AccountInput {
  adAccountId: string
  /** 同一账户登记给多个客户（§14 M9）→ 只做账户级诊断 */
  shared: boolean
  /** PM 在后台把这个账户标成「不在广告健康页显示」时为 true：只让「数据新鲜度」类诊断（D7 日数据停更/缺数据、D11 受众池断供）跳过它；钱相关的诊断一律照跑 */
  hiddenFromAdHealth?: boolean
  timezone: string | null
  currency: string | null
  /** 评估日结束时（账户时区）每个实体的最新设置，不含 disappeared 行 */
  snapshots: EntitySnapshotRow[]
  /** 近 28 天（含评估日）的日数据，campaign / adset 两级 */
  daily: DailyRow[]
  /** 按天（YYYY-MM-DD）给的小时花费；没拉 / 拉失败则缺该天 */
  hourly: Record<string, HourlyRow[]>
  hourlyError: string | null
  /** 最近一轮快照抓取情况（D7） */
  latestCaptures: CaptureCoverage[]
  /** 这个账户在 ad_daily_insights 里最后一天有数据的日期（D7） */
  lastInsightDate: string | null
  /**
   * 近 28 天广告层日数据（D2/D10）。单独放、不混进 `daily`，老诊断零影响。
   * 🔴 广告层 `parent_id` 是**广告系列** id，不是广告组 id——广告归哪个组只认快照 `adset_id`。
   * 缺省 = 没加载（共用账户 / 老 fixture）→ 广告级规则不跑。
   */
  adDaily?: DailyRow[]
  /** 近 35 天的设置变更（D2/D10「最近改过」闸）。缺省 = 没加载。 */
  settingChanges?: SettingChange[]
  /**
   * 近 35 天受众人数快照（D11 受众池断供用）：从已读的快照里抽 level='audience'、非「消失」行，不加查询。
   * 缺省 = 没加载 → D11 不跑。
   */
  audienceHistory?: AudienceCountPoint[]
  /**
   * 近 35 天出现过的广告（每条取最后一行非「消失」快照，含后来被归档/删除的）。
   * D11 算供血花费用：被归档的供血广告窗口内花过的钱也要算上（2026-09-27 魏征）。缺省 = 只看当前在的广告。
   */
  recentAds?: EntitySnapshotRow[]
  /**
   * 近 35 天每条广告挂过的每个创意主页（非「消失」行去重）。归属判定用（ownership.ts）：广告换过主页，
   * 只看最后一行会把前半段别家花的钱算给客户（2026-09-27 魏征）。缺省 = 只看当前快照 + recentAds。
   */
  adPageHistory?: AdPageSighting[]
}

export interface AdPageSighting {
  entity_id: string
  adset_id: string | null
  creative_page_id: string | null
}

export interface DiagnosisInput {
  clientId: string
  /** 评估日（账户时区的完整一天） */
  date: string
  evaluatedAt: string
  outcome: OutcomeConfig
  outcomeConfigured: boolean
  /** #1299 企业验证通过、私信 Webhook 真正收到来源之前一律 false（§14 M2） */
  messagingReferralAvailable: boolean
  /** 日报收件人（D7 查是否含客户邮箱） */
  digestRecipients: string[]
  /**
   * 客户登记的 Facebook 主页（`clients.facebook_page_id`）。广告级规则只判创意挂在这个主页上的广告——
   * 一个广告账户里可能投着别的客户的广告（登记表不一定反映）。
   * undefined = 没加载（老 fixture）→ 广告级规则整段不跑；null = 客户没登记 → 出 client_page_unknown。
   */
  clientPageId?: string | null
  accounts: AccountInput[]
}

export interface ExcludedEntity {
  adAccountId: string
  level: 'campaign' | 'adset' | 'account'
  id: string
  name: string | null
  /**
   * other_page / mixed_pages / page_unknown：按创意主页判不是（或确认不了是）这个客户的广告组/系列（ownership.ts）。
   * capture_stale：广告层快照最近一轮没抓全或太旧，归属核实不到，整个账户降级只做账户级（Codex 2026-09-27）。
   */
  reason: 'meta_experiment' | 'shared_account' | 'other_page' | 'mixed_pages' | 'page_unknown' | 'capture_stale'
  detail: string
}

/**
 * 广告级规则（D2/D10）在某个广告账户上到底跑没跑。给客户看的报告据此区分「检查过、没发现」和「根本没检查」——
 * 后者绝不能说成前者（2026-09-26 子牙/魏征 Magic Bridge 设计审）。
 */
export interface AdLevelCoverage {
  adAccountId: string
  ran: boolean
  /**
   * ok = 跑了；shared_account = 共用账户只做账户级；not_loaded = 没加载广告层数据；
   * client_page_unknown = 客户没登记主页；capture_stale = 广告层快照最近一轮没抓全/太旧，归属核实不到。
   */
  reason: 'ok' | 'shared_account' | 'not_loaded' | 'client_page_unknown' | 'capture_stale'
  /** 跑了时：进入规则的正在投放、挂客户主页、以点击/结果为目标的广告条数 */
  adsChecked: number
}

export interface DiagnosisRun {
  clientId: string
  date: string
  evaluatedAt: string
  diagnoses: Diagnosis[]
  excluded: ExcludedEntity[]
  adLevelCoverage?: AdLevelCoverage[]
}
