/**
 * Agent Learning 契约层：只放类型、常量与纯数据形状。
 * 铁律：本文件不 import supabase / inngest / 任何 SDK，也不导出函数，
 * 这样 L4（看板）、L5（纯函数）、L6（蒸馏）都可以只依赖它。
 */

/** 6 个平台支柱 key，取值固定，不含任何客户或行业语义 */
export const LEARNING_PILLARS = ['ads', 'seo', 'social', 'reputation', 'ai_visibility', 'competitor'] as const

/** 支柱类型：由 LEARNING_PILLARS 推导，避免两处各写一遍 */
export type LearningPillar = (typeof LEARNING_PILLARS)[number]

/** 专家名册的 6 个领域，只作数据取值，不得在共享代码里按行业分支 */
export const EXPERT_DOMAINS = ['seo', 'sem', 'facebook_organic', 'paid_social', 'geo', 'ai_skills'] as const

/** 专家领域类型：由 EXPERT_DOMAINS 推导 */
export type ExpertDomain = (typeof EXPERT_DOMAINS)[number]

/** 失败原因分类：写入与调用方都按这几个 code 分支，不靠字符串猜 */
export type ResultErrorCode = 'db_error' | 'validation' | 'gate_blocked' | 'not_found' | 'conflict'

/** 所有写入函数的统一返回：不许吞错，不许返回 null 表示失败 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code: ResultErrorCode }

/** 蒸馏规则的来源卡：专家、链接、发布日期、领域、原文引用（≤2 行）；视频给时间戳 */
export interface SourceCard {
  expert: string
  url: string
  publishedAt: string
  domain: ExpertDomain
  quote: string
  videoTimestampSec: number | null
}

/** 一条蒸馏出的候选规则；作者给的数字只进 authorClaims，不进 rule */
export interface DistilledRule {
  rule: string
  rationale: string
  sourceCard: SourceCard
  authorClaims: Array<{ text: string; kind: 'number' | 'result' }>
}

/** 内存里的一条抓取结果；text 只在内存里，绝不写库 */
export interface RawItem {
  externalRef: string
  title: string
  publishedAt: string | null
  text: string
}
