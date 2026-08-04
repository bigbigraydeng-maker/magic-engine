/**
 * 「几套房才算一条规律」—— 一条单套经验什么时候可以升格成能拿去指导下一套的规律。
 *
 * 为什么需要一道明确的闸：卖掉一套房、回填一次结论，很容易就写成
 * 「200 万档 × 这个区 × 联排，投资客这条线最灵」。**一套房只是一件事，不是一条规律。**
 * 规律会被拿去决定下一套房的广告怎么投、卖点怎么排，靠一两套样本升上去的
 * 「规律」比没有规律更贵 —— 它看起来有依据，实际上是噪音。
 *
 * 本文件只放**常量 + 判定**（PM 2026-08-01 拍板）。真正的聚合升级流程（去库里
 * 数同类房源、算连续打脸、写回 listing_briefs）下一批做 —— 数字和判定先钉死，
 * 免得聚合那批人各写各的阈值。
 *
 * 纯函数：不 import supabase、不读环境变量，client / server 都能安全引。
 */

// ── 规则二 · 几套房才算一条规律（PM 2026-08-01 拍板）───────────────────────

/**
 * 同类房源（同价格档 × 同区 × 同房型）累计确认过这么多套，才谈得上「规律」。
 *
 * PM 2026-08-01 拍板 6 套。低于这个数的结论一律只是「这一套是这样」。
 */
export const PATTERN_MIN_CONFIRMED_LISTINGS = 6

/**
 * 那 6 套里至少要来自这么多个**不同的客户**（中介 / 开发商），否则只算
 * 「这个客户的规律」，不能当成通用规律往别的客户身上套。
 *
 * 我建议、PM 认可。理由：同一个中介的 6 套房共享的是他本人的话术、他的挂牌
 * 习惯、他的老客户池 —— 那是「他的打法有效」，不是「这类房子就该这么投」。
 */
export const PATTERN_MIN_DISTINCT_CLIENTS = 2

/**
 * 连续这么多套的回填结论是「跟当初想的相反」，规律自动降级回「待验证」。
 *
 * 我建议、PM 认可。规律一旦升上去就没人再质疑它，市场转向时它会继续指挥投放；
 * 连续打脸是最便宜的自我纠正信号，所以做成自动的，不等人想起来去改。
 */
export const PATTERN_DEMOTION_STREAK = 3

/**
 * 规律的三档。
 *   unverified      待验证 —— 样本还不够，或者刚被连续打脸打回来
 *   client_pattern  这个客户的规律 —— 样本够了，但全来自同一个客户
 *   general_pattern 规律 —— 样本够、且跨客户
 */
export const PATTERN_TIERS = ['unverified', 'client_pattern', 'general_pattern'] as const
export type PatternTier = (typeof PATTERN_TIERS)[number]

export function isPatternTier(v: unknown): v is PatternTier {
  return typeof v === 'string' && (PATTERN_TIERS as readonly string[]).includes(v)
}

export const PATTERN_TIER_LABEL: Record<PatternTier, string> = {
  unverified: '待验证',
  client_pattern: '这个客户的规律',
  general_pattern: '规律',
}

/** 兜底取 label：库里出现还不认识的档时显示原始 slug，而不是渲染成空白。 */
export function patternTierLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isPatternTier(v) ? PATTERN_TIER_LABEL[v] : v
}

/** 判定一条候选规律要用的全部证据。 */
export interface PatternEvidence {
  /** 同类房源里已经回填过结论的套数。 */
  confirmedListings: number
  /** 这些套分别属于几个不同的客户。 */
  distinctClients: number
  /** 最近**连续**几套的回填结论是「跟当初想的相反」（listing_briefs 的 reversed）。 */
  consecutiveReversals: number
}

export interface PatternVerdict {
  tier: PatternTier
  /** 「基于 N 套实测」—— 规律必须带出处，UI 上跟结论同框显示，不许只显示结论。 */
  provenance: string
  /** true = 这次是被连续打脸打回「待验证」的，不是样本还不够。 */
  demoted: boolean
}

/**
 * 一条候选规律现在算哪一档。
 *
 * 顺序要紧：**先看有没有被连续打脸**。样本攒够 6 套的规律照样会被市场推翻，
 * 这时它的样本数只会更大，如果先判样本数就永远降不下来。
 */
export function classifyPattern(evidence: PatternEvidence): PatternVerdict {
  const listings = Math.max(0, evidence.confirmedListings)
  const clients = Math.max(0, evidence.distinctClients)
  const reversals = Math.max(0, evidence.consecutiveReversals)

  if (reversals >= PATTERN_DEMOTION_STREAK) {
    return {
      tier: 'unverified',
      provenance: `基于 ${listings} 套实测，最近 ${reversals} 套连续跟当初判断相反，已打回待验证`,
      demoted: true,
    }
  }

  if (listings < PATTERN_MIN_CONFIRMED_LISTINGS) {
    const short = PATTERN_MIN_CONFIRMED_LISTINGS - listings
    return {
      tier: 'unverified',
      provenance: `基于 ${listings} 套实测（还差 ${short} 套才算规律）`,
      demoted: false,
    }
  }

  if (clients < PATTERN_MIN_DISTINCT_CLIENTS) {
    return {
      tier: 'client_pattern',
      provenance: `基于 ${listings} 套实测，但全来自同一个客户，只当这个客户的规律`,
      demoted: false,
    }
  }

  return {
    tier: 'general_pattern',
    provenance: `基于 ${listings} 套实测，来自 ${clients} 个客户`,
    demoted: false,
  }
}
