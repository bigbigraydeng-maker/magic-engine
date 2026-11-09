/**
 * 哪些经验可以"试一下"：首批推荐的专家候选，按 lesson_key 前缀 + evidence.kind 筛选，不写死具体 key。
 * 前缀决定用哪份固定样例（SEO 站点 / 广告）。
 */
export type TrialSampleId = 'seo' | 'ads'

const TRIAL_PREFIXES: Array<{ prefix: string; sample: TrialSampleId }> = [
  { prefix: 'expert-jon-loomer-', sample: 'ads' },
  { prefix: 'expert-glenn-gabe-', sample: 'seo' },
]

export const TRIAL_EVIDENCE_KIND = 'expert_rss_candidate'

/** 不合格返回 null */
export function trialSampleFor(lessonKey: string, evidenceKind: unknown): TrialSampleId | null {
  if (evidenceKind !== TRIAL_EVIDENCE_KIND) return null
  return TRIAL_PREFIXES.find((p) => lessonKey.startsWith(p.prefix))?.sample ?? null
}
