/**
 * 首批专家名册（Ray 2026-10-26 批准 3 位，代码常量，不建表）。
 * 「为什么可信」是一句话理由（Ray 2026-10-26 已确认）；扩名册须另经 Ray 批准。
 * 名册只放数据，不放任何客户信息。
 */

import type { ExpertDomain } from '@/lib/agent-learning/contracts'

export interface RosterEntry {
  sourceKey: string
  expert: string
  domain: ExpertDomain
  feedUrl: string
}

export const EXPERT_ROSTER: readonly RosterEntry[] = [
  {
    // 可信理由：Meta 广告领域公认的一线实操博主，长期按平台改版逐条测试并公开结论。
    sourceKey: 'jon-loomer',
    expert: 'Jon Loomer',
    domain: 'paid_social',
    feedUrl: 'https://www.jonloomer.com/feed/',
  },
  {
    // 可信理由：长期追踪并复盘 Google 核心算法更新对真实站点的影响，文章带前后数据。
    sourceKey: 'glenn-gabe',
    expert: 'Glenn Gabe',
    domain: 'seo',
    feedUrl: 'https://www.gsqi.com/marketing-blog/feed/',
  },
  {
    // 可信理由：专做电商 DTC 付费投放的代理机构，博客文章来自其管理的真实账户经验。
    sourceKey: 'common-thread-collective',
    expert: 'Common Thread Collective',
    domain: 'paid_social',
    feedUrl: 'https://commonthreadco.com/blogs/coachs-corner.atom',
  },
]

/** 候选规则的建议有效期（天）：平台打法过时快，SEO 慢一些 */
const VALID_DAYS: Record<ExpertDomain, number> = {
  paid_social: 90,
  facebook_organic: 90,
  geo: 90,
  ai_skills: 90,
  sem: 120,
  seo: 180,
}

/** 从内容发布日起算建议有效期，返回 ISO；发布日缺失或不合法就从 now 起算 */
export function suggestedValidUntil(domain: ExpertDomain, publishedAt: string | null, now: Date): string {
  const parsed = publishedAt === null ? Number.NaN : Date.parse(publishedAt)
  const base = Number.isFinite(parsed) ? parsed : now.getTime()
  return new Date(base + VALID_DAYS[domain] * 86_400_000).toISOString()
}
