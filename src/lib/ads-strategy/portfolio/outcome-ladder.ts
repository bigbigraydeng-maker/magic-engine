/**
 * 结果阶梯（ads IMPACT 阶段 1，设计 §3.2 + §14 M2 / M3）。
 *
 *   触达 → 完播 → 互动 → 私信开聊 → 私信聊到第3句 → 留资 → 合格询盘 → 成交
 *
 * 客户选「领先结果」（每天能数）和「主结果」（真生意），存在客户配置里（L4，入库 + 设置界面）。
 *
 * 🔴 主结果必须能归到具体广告单位（M2）。归不到 → 该单位主结果 = UNKNOWN（value=null），
 *    **不算自然流量、不回填**，禁止基于它出 D5 与任何预算处方。
 * 🔴 口径（2026-09-14 子牙复审澄清）：Meta 按广告单位直报的计数（私信开聊、聊到第 3 句、表单留资）
 *    本身就归在广告单位上，可以用；要等 #1299（Meta 企业验证）通过、私信 Webhook 真正收到来源才能归属的，
 *    是「合格询盘 / 成交」这类要把私信或 CRM 结果连回广告的级别——在那之前一律 UNKNOWN。
 * 🔴 网站转化优化（OFFSITE_CONVERSIONS）的单位，如果当天没有标准留资动作，只有自定义像素事件，
 *    留资数是 UNKNOWN 而不是 0（魏征复审：NAL 3PL 组有一天只有 fb_pixel_custom=1）。
 * 🔴 开场白识别等临时归属标「启发式」（M3），只可人工统计实验，禁止进 D5 与预算处方。
 *
 * 纯函数、平台共享：行业默认阶梯（物流/旅游/地产/电商各选哪两级）是剧本数据，不在这里。
 */

export const OUTCOME_STEPS = [
  'reach',
  'video_complete',
  'engagement',
  'messaging_started',
  'messaging_depth_3',
  'lead',
  'qualified_enquiry',
  'deal',
] as const
export type OutcomeStep = (typeof OUTCOME_STEPS)[number]

export const OUTCOME_STEP_LABEL: Readonly<Record<OutcomeStep, string>> = {
  reach: '触达',
  video_complete: '完播（ThruPlay）',
  engagement: '互动',
  messaging_started: '私信开聊',
  messaging_depth_3: '私信聊到第 3 句',
  lead: '留资（表单）',
  qualified_enquiry: '合格询盘',
  deal: '成交',
}

/**
 * 归属方式。只有前两种能进 D5 / 预算处方（`isAttributableForBudget`）。
 *   platform_reported —— Meta 按广告单位直接报（actions / 视频字段）
 *   webhook_referral  —— 私信 Webhook 的 entry_referral 带广告 id（#1640），需 #1299 通过才有生产流量
 *   heuristic         —— 开场白识别之类的临时推断（M3：禁止进 D5）
 *   none              —— 归不上 = UNKNOWN
 */
export type AttributionMethod = 'platform_reported' | 'webhook_referral' | 'heuristic' | 'none'

export interface OutcomeConfig {
  leading: OutcomeStep | null
  primary: OutcomeStep | null
  /** 客户目标单次主结果成本（账户币种主单位，如 NZ$25）。未配置 = null → D3 not_comparable，不回落行业默认。 */
  targetCostPerPrimary: number | null
  /** D5 每个预算单位主结果最低数（样本量闸）。 */
  minPrimaryPerUnit: number
}

export const DEFAULT_MIN_PRIMARY_PER_UNIT = 5

/** 未配置时的状态：两级都 UNKNOWN，不猜。 */
export function emptyOutcomeConfig(): OutcomeConfig {
  return { leading: null, primary: null, targetCostPerPrimary: null, minPrimaryPerUnit: DEFAULT_MIN_PRIMARY_PER_UNIT }
}

export function isOutcomeStep(v: unknown): v is OutcomeStep {
  return typeof v === 'string' && (OUTCOME_STEPS as readonly string[]).includes(v)
}

/** Meta actions 里对应各级的 action_type（按优先级，取第一个出现的，**不相加**）。 */
const ACTION_TYPES: Partial<Record<OutcomeStep, readonly string[]>> = {
  engagement: ['post_engagement'],
  messaging_started: ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'],
  messaging_depth_3: ['onsite_conversion.messaging_user_depth_3_message_send'],
  lead: ['lead', 'onsite_conversion.lead_grouped'],
}

export interface InsightForOutcome {
  reach: number | null
  video_thruplays: number | null
  actions: ReadonlyArray<{ action_type: string; value: string }> | null
}

export interface OutcomeCount {
  step: OutcomeStep
  /** null = UNKNOWN（归不上 / 没数据），不是 0 */
  value: number | null
  attribution: AttributionMethod
  note?: string
}

/**
 * 某广告单位某天在某一级结果上的数量。
 * `messagingReferralAvailable`：私信 Webhook 是否真的在收生产来源（#1299 通过前一律 false）。
 */
export function countOutcome(
  step: OutcomeStep,
  row: InsightForOutcome,
  opts: { messagingReferralAvailable: boolean; optimizationGoal?: string | null } = { messagingReferralAvailable: false },
): OutcomeCount {
  if (step === 'reach') {
    return { step, value: row.reach, attribution: row.reach === null ? 'none' : 'platform_reported' }
  }
  if (step === 'video_complete') {
    return { step, value: row.video_thruplays, attribution: row.video_thruplays === null ? 'none' : 'platform_reported' }
  }
  if (step === 'qualified_enquiry' || step === 'deal') {
    return {
      step,
      value: null,
      attribution: 'none',
      note: opts.messagingReferralAvailable
        ? '合格询盘/成交需要把 CRM 结果按广告 id 连回来，阶段 1 未接'
        : '系统还分不清哪条私信、哪笔成交是哪条广告带来的（在等 Meta 企业验证通过）',
    }
  }
  const types = ACTION_TYPES[step] ?? []
  if (row.actions === null) return { step, value: null, attribution: 'none', note: '这一行没有原始 actions' }
  for (const t of types) {
    const hit = row.actions.find(a => a.action_type === t)
    if (hit) {
      const n = Number(hit.value)
      return { step, value: Number.isFinite(n) ? n : null, attribution: 'platform_reported' }
    }
  }
  if (step === 'lead' && opts.optimizationGoal === 'OFFSITE_CONVERSIONS' && row.actions.some(a => a.action_type.startsWith('offsite_conversion.'))) {
    return { step, value: null, attribution: 'none', note: '网站转化优化，当天只有自定义像素事件、没有标准留资动作，映射不上' }
  }
  return { step, value: 0, attribution: 'platform_reported' }
}

/** M2 / M3：只有平台直报与 Webhook 来源的主结果能进 D5 与预算处方。 */
export function isAttributableForBudget(count: OutcomeCount): boolean {
  return count.value !== null && (count.attribution === 'platform_reported' || count.attribution === 'webhook_referral')
}
