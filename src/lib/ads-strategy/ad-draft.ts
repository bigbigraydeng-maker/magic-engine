/**
 * 广告草案 —— ME 想发的那条广告，在它变成真钱之前的样子。
 *
 * ── 为什么草案是一个独立的类型，而不是直接调 Meta ─────────────────────────
 * 因为「发广告」这件事在 ME 里被拆成三步，中间那步必须有个东西可以被检查：
 *   1. ME 起草            ← 本文件
 *   2. 建成**暂停**状态 → 回读 → 过闸门     ← publisher + launch-readback
 *   3. 人看完买家会读到的每一句，点头才开    ← 审批页
 *
 * 第 2 步不能省成「建之前先检查草案」：Meta 自动加的东西（问候语、自动放宽
 * 人群、自动挂相似人群）在传参时**根本不存在**，只有建完回读才看得见。
 * 2026-08-04 得罪 Boris / Richard / Jude 那次，根因就是这一步不存在。
 *
 * ── 一个草案 = 一个打法 ──────────────────────────────────────────────────
 * 打法名不是标签，是**约束**：选了 `lead_form_harvest` 就必须给表单 id，
 * 选了 `thruplay_pool_build` 就必须给视频。校验在 `validateDraft`，
 * 不合规的草案连建都建不出来。
 */

import type { PlayKey } from './play-vocabulary'

/** 目前 ME 会发的两种广告。要加第三种，先在 PLAY_CATALOG 里有对应打法。 */
export type DraftKind = 'lead_form' | 'video_thruplay'

/** 打法 → 这个草案要走哪套 Meta 参数。两边必须对得上，别各自加。 */
export const DRAFT_PLAY: Readonly<Record<DraftKind, PlayKey>> = {
  lead_form: 'lead_form_harvest',
  video_thruplay: 'thruplay_pool_build',
}

/**
 * 受众模式 —— 决定 Meta 的 Advantage+ 受众扩展开不开（`ad-publisher.ts` 的
 * `audienceAutomationFor` 按它出参）。
 *
 *   cold          冷启动获客：没有名单可投，让 Advantage+ 广泛定向配合 Meta
 *                 系统自动优化找人（Andromeda 打法），不许锁死。
 *   warm_retarget 再营销：受众名单是唯一投放依据，必须锁死 —— 关掉
 *                 Advantage+ 和名单外扩展，否则名单形同虚设（2026-08-04
 *                 事故：见 `launch-readback.ts` 的 `retargeting_advantage_audience`）。
 *
 * `roles.ts` 的角色判定只在广告组**包含了再营销类受众**时才看 advantage_audience
 * 这个字段（见该文件 `retargetingIds.length > 0` 分支）；下面两种冷启动打法都
 * 不带包含受众，所以把它们的 advantage_audience 改成 1 不会影响诊断层判定。
 */
export type AudienceMode = 'cold' | 'warm_retarget'

/** 打法 → 受众模式。目前两种打法都是冷启动；加 `warm_retarget` 打法时在这里登记。 */
export const DRAFT_AUDIENCE_MODE: Readonly<Record<DraftKind, AudienceMode>> = {
  lead_form: 'cold',
  video_thruplay: 'cold',
}

export interface AdDraftCreative {
  /** 广告名 —— 只给内部人看。 */
  name: string
  /** 正文。买家读到的第一句话在这里。 */
  primaryText: string
  /** 大标题（Meta 的 headline）。 */
  headline: string
  /** 描述。给不出就不给，别塞占位文字。 */
  description?: string
  /**
   * 素材。表单广告给图，视频广告给视频。
   * 已经上传到 Meta 的 id —— 上传是另一步（ads_creative_upload_*），不在这里做。
   */
  imageHash?: string
  videoId?: string
  /** 视频封面。Meta 建视频广告时必给，没有就用视频首帧（由 publisher 处理）。 */
  thumbnailUrl?: string
}

export interface AdDraft {
  kind: DraftKind
  clientId: string
  /** 广告系列名 —— 会出现在 Meta 后台，写人看得懂的。 */
  campaignName: string
  adSetName: string
  /** 每天多少钱，**整数、客户账户的货币单位**（NZD/AUD 元，不是分）。 */
  dailyBudget: number
  /** 跑几天。到期自动停 —— 不设终点的广告没人会记得去关。 */
  durationDays: number
  /** 投放地区。空数组会被 `validateDraft` 拒掉：投给全世界不是一个决定。 */
  geoCountries: string[]
  /** 具体到城市/区（Meta 的 geo key）。给不出就只按国家投。 */
  geoCityKeys?: string[]
  /** 年龄下限/上限。 */
  ageMin?: number
  ageMax?: number
  /** 表单广告必给：Meta 的即时表单 id。 */
  leadFormId?: string
  /** 落地页 —— 表单广告的隐私政策/后续跳转用。 */
  linkUrl?: string
  /** 广告主页 id。 */
  pageId: string
  /** 一个草案下可以有多条创意；**同一个组里语言必须一致**（闸门会查）。 */
  creatives: AdDraftCreative[]
}

/** 每天最多敢自动花多少 —— 超过这个数不是 ME 该自己决定的事。 */
export const MAX_AUTO_DAILY_BUDGET = 50

/** 一次最多跑多久 —— 再长的投放应该是续，不是一次性下注。 */
export const MAX_DURATION_DAYS = 30

export interface DraftProblem {
  field: string
  message: string
}

/**
 * 草案能不能拿去建。
 *
 * 这里**只查 ME 自己能确定的事**（缺字段、超预算、打法和参数对不上）。
 * 买家会看到什么、Meta 会自动加什么，一律等建完回读 —— 那些在这里查不出来。
 */
export function validateDraft(d: AdDraft): DraftProblem[] {
  const p: DraftProblem[] = []

  if (!d.clientId) p.push({ field: 'clientId', message: '没说是哪个客户' })
  if (!d.pageId) p.push({ field: 'pageId', message: '没说用哪个主页发' })

  if (!Number.isFinite(d.dailyBudget) || d.dailyBudget <= 0) {
    p.push({ field: 'dailyBudget', message: '每天预算必须是大于 0 的数' })
  } else if (d.dailyBudget > MAX_AUTO_DAILY_BUDGET) {
    p.push({
      field: 'dailyBudget',
      message: `每天 ${d.dailyBudget} 超过自动发布上限 ${MAX_AUTO_DAILY_BUDGET} —— 这个量级要人自己决定`,
    })
  }

  if (!Number.isInteger(d.durationDays) || d.durationDays <= 0) {
    p.push({ field: 'durationDays', message: '必须说跑几天 —— 不设终点的广告没人会记得关' })
  } else if (d.durationDays > MAX_DURATION_DAYS) {
    p.push({ field: 'durationDays', message: `一次最多 ${MAX_DURATION_DAYS} 天` })
  }

  if (!d.geoCountries || d.geoCountries.length === 0) {
    p.push({ field: 'geoCountries', message: '没说投给哪里 —— 投给全世界不是一个决定，是漏了一步' })
  }

  if (d.creatives.length === 0) {
    p.push({ field: 'creatives', message: '一条广告文案都没有' })
  }
  d.creatives.forEach((c, i) => {
    if (!c.primaryText.trim()) p.push({ field: `creatives[${i}].primaryText`, message: '正文是空的' })
    if (!c.headline.trim()) p.push({ field: `creatives[${i}].headline`, message: '标题是空的' })
    if (d.kind === 'video_thruplay' && !c.videoId) {
      p.push({ field: `creatives[${i}].videoId`, message: '视频广告没给视频' })
    }
    if (d.kind === 'lead_form' && !c.imageHash && !c.videoId) {
      p.push({ field: `creatives[${i}].imageHash`, message: '表单广告没给图也没给视频' })
    }
  })

  if (d.kind === 'lead_form' && !d.leadFormId) {
    p.push({ field: 'leadFormId', message: '留资广告没挂表单 —— 那它收不到任何联系方式' })
  }

  if (d.ageMin !== undefined && d.ageMin < 18) {
    p.push({ field: 'ageMin', message: 'Meta 不允许投给 18 岁以下' })
  }
  if (d.ageMin !== undefined && d.ageMax !== undefined && d.ageMin > d.ageMax) {
    p.push({ field: 'ageMax', message: '年龄下限比上限还大' })
  }

  return p
}

/** Meta 的 objective / optimization_goal / destination_type 三件套，按草案类型定死。 */
export interface MetaObjectiveTriplet {
  objective: string
  optimizationGoal: string
  billingEvent: string
  destinationType?: string
}

/**
 * 打法 → Meta 参数。
 *
 * 写死不给调：这三个字段配错就是「名字叫留资、实际在买曝光」那类问题，
 * 而它在数据上看起来完全正常（2026-08-04 「暖池重定向」实测就是这么坏的）。
 */
export function metaTripletFor(kind: DraftKind): MetaObjectiveTriplet {
  if (kind === 'lead_form') {
    return {
      objective: 'OUTCOME_LEADS',
      optimizationGoal: 'LEAD_GENERATION',
      billingEvent: 'IMPRESSIONS',
      destinationType: 'ON_AD', // 表单开在广告里，不把人带去私信
    }
  }
  return {
    objective: 'OUTCOME_AWARENESS',
    optimizationGoal: 'THRUPLAY',
    billingEvent: 'IMPRESSIONS',
    destinationType: 'ON_VIDEO',
  }
}

/** 一句话说清这条广告在做什么 —— 审批页第一行。 */
export function describeDraft(d: AdDraft): string {
  const total = d.dailyBudget * d.durationDays
  const what =
    d.kind === 'lead_form'
      ? '收联系方式（填表单）'
      : '养受众（让人看完视频，之后可以再投给他们）'
  return `${what}，每天 $${d.dailyBudget}、跑 ${d.durationDays} 天，最多花 $${total}`
}
