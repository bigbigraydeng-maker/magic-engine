/**
 * 哪些经验可以"试一下"：按 lesson_key 前缀 + evidence.kind 筛选（不写死具体 key）。
 * 首批只开 Jon Loomer / Glenn Gabe 的专家候选；Common Thread Collective 暂无合适样例，不开。
 */
import { EXPERT_ROSTER } from '@/lib/agent-learning/expert-roster'

export const TRIAL_SOURCE_KEYS = ['jon-loomer', 'glenn-gabe'] as const

export type TrialSampleKind = 'ad' | 'seo'

/** 返回该 key 对应的样例类型；不在名单里返回 null。 */
export function trialSampleKind(lessonKey: string): TrialSampleKind | null {
  for (const sourceKey of TRIAL_SOURCE_KEYS) {
    if (!lessonKey.startsWith(`expert-${sourceKey}-`)) continue
    const entry = EXPERT_ROSTER.find((e) => e.sourceKey === sourceKey)
    if (!entry) return null
    return entry.domain === 'seo' ? 'seo' : 'ad'
  }
  return null
}

/** key 前缀在名单内，且 evidence.kind 是专家候选。 */
export function isTrialEligible(lessonKey: string, evidence: Record<string, unknown> | null | undefined): boolean {
  return trialSampleKind(lessonKey) !== null && evidence?.kind === 'expert_rss_candidate'
}
