/**
 * 推广剧本（Promo Playbook）—— 行业 / 默认的阈值只以数据进入共享代码。
 *
 * 沿用广告剧本（src/lib/ads-strategy/playbooks）的做法：按 clients.industry 选，
 * 不认客户名 / 客户 ID；行业为空或不在表里 → default。
 *
 * 目前**只有 default**，且每个值都标 evidence = 'unvalidated_default'（占位，不是任何
 * 行业或客户的已验证经验）。没有证据之前不替任何行业写数字——旅游只有一个客户的经验，
 * 按"候选参考"对待，不当已验证定论套用（CLAUDE.md 对行业手册的要求）。
 */

export type PromoEvidence = 'unvalidated_default' | 'single_client' | 'multi_client'

export interface PromoPlaybook {
  readonly key: string
  /** 取数多久算过期：超过按「未核实」（灰）处理，不能把旧数据判绿。 */
  readonly factFreshnessDays: number
  /** 广告数据最近几天平台还会回补，对账时排除或标「未稳定」。 */
  readonly insightsUnstableDays: number
  /** 目标期过了多少天之前，不对结果判落后（结果有滞后，不报假警）。 */
  readonly resultMaturityDays: number
  /** 每日计划往后至少排了几天才算「节奏已排」。 */
  readonly cadenceCoverageMinDays: number
  /** 实际 / 计划 低于这个比例算「落后」（花费、内容条数共用）。 */
  readonly behindBelowRatio: number
  /** 实际花费 / 计划花费 高于这个比例算「超」。 */
  readonly spendOverRatio: number
  /**
   * 排期表：每周 N 条内容落在星期几（ISO 星期，周一=1…周日=7）。键是每周条数 1–7。
   * 只是「均匀摊开」的默认摆法，不是任何行业的发布时间经验。
   */
  readonly scheduleWeekdays: Readonly<Record<number, readonly number[]>>
  /** 快拍相对帖子错开几天（让一天不要全撞在一起）。 */
  readonly storyWeekdayShift: number
  /** 短视频只落在这些星期（默认工作日；周末高峰的行业以后在行业剧本里改）。排期表按「周一起算」分组，这一点目前是默认假设。 */
  readonly reelWeekdays: readonly number[]
  /** 排期表防护：展开后最多多少件、所有阶段合计最多多少天、最多多少个步骤。 */
  readonly scheduleMaxItems: number
  readonly scheduleMaxSpanDays: number
  readonly scheduleMaxSteps: number
  /** 广告起草：建议日预算取「预算余量」的几成（占位默认值，没有任何行业或客户的验证）。 */
  readonly draftBudgetShareOfHeadroom: number
  /** 广告起草：最多建议几个素材。 */
  readonly draftMaxCreatives: number
  readonly evidence: PromoEvidence
}

export const DEFAULT_PROMO_PLAYBOOK: PromoPlaybook = {
  key: 'default',
  factFreshnessDays: 7,
  insightsUnstableDays: 1,
  resultMaturityDays: 7,
  cadenceCoverageMinDays: 7,
  behindBelowRatio: 0.8,
  spendOverRatio: 1.2,
  scheduleWeekdays: {
    1: [3],
    2: [2, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5, 6],
    7: [1, 2, 3, 4, 5, 6, 7],
  },
  storyWeekdayShift: 1,
  reelWeekdays: [1, 2, 3, 4, 5],
  scheduleMaxItems: 1000,
  scheduleMaxSpanDays: 800,
  scheduleMaxSteps: 200,
  draftBudgetShareOfHeadroom: 0.5,
  draftMaxCreatives: 3,
  evidence: 'unvalidated_default',
}

/** 目前没有行业专属剧本；有证据后在这里加，不改调用方。 */
const BY_KEY = new Map<string, PromoPlaybook>([[DEFAULT_PROMO_PLAYBOOK.key, DEFAULT_PROMO_PLAYBOOK]])

function normaliseIndustry(industry: string): string {
  return industry.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function resolvePromoPlaybook(industry: string | null | undefined): PromoPlaybook {
  if (!industry) return DEFAULT_PROMO_PLAYBOOK
  return BY_KEY.get(normaliseIndustry(industry)) ?? DEFAULT_PROMO_PLAYBOOK
}
