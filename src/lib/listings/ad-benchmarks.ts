/**
 * 「我们自己投过的，实际跑出来是什么样」—— 摆给人看的参考数据。
 *
 * 🔴 这个模块存在的理由是一次真实的判断错误(2026-08-01)
 * ------------------------------------------------------
 * 2/30 Kiteroa 的档案出来后，有人拿实测数据去质疑 AI 的卖点排序，证据是：
 *   ·「英文学区版每次对话 $27.83，全场最贵」 → 换算过去是 **1 次对话**
 *   ·「即可入住点击率最高」                   → 换算过去是 **2 次对话**
 * 一两次对话不是证据。PM 当场纠正：这套房主要卖的就是学区，AI 判断是对的，
 * 现有的几个样本不能当决策依据。而「同类房源攒够 6 套才算规律」这条闸
 * (pattern-promotion.ts)早就定好了，是拿数据的人自己违反了它。
 *
 * 所以本模块的三条纪律，写死在类型和函数里，不是靠自觉：
 *
 *   ① **只显示，不改排序**。实测数据永远不参与 angle_ranking / buyer_segments
 *      的计算。applyAdReferenceToDraft() 就是这条纪律的物理位置：它把参考数据
 *      挂在旁边，一个字都不动判断栏。
 *   ② **每个数字必须跟样本量同框**。不许出现孤零零的「每次对话 $27.83」，
 *      只有 formatCostWithSample() 一个出口，它永远把「基于 N 次对话」缝在
 *      数字后面；N 为 0 时直接说「没有数据」，不给成本数。
 *   ③ **够不够格叫「规律」由 pattern-promotion.ts 判**，本模块不另立阈值。
 *
 * 纯函数：不 import supabase、不读环境变量。取数在 ad-benchmark-queries.ts。
 */

import {
  classifyPattern,
  PATTERN_MIN_CONFIRMED_LISTINGS,
  type PatternTier,
} from './pattern-promotion'

// ── 输入：ad_daily_insights 里我们用得上的那几列 ──────────────────────────────

/**
 * 一条「某条广告某一天」的实测行。
 *
 * 数字列写成 `number | string | null`，因为 Postgres 的 numeric 经 supabase-js
 * 回来是字符串 —— 在这里收口，别让每个调用方各自 Number() 一遍。
 */
export interface AdInsightRow {
  entity_id: string
  insight_date: string
  spend: number | string | null
  impressions: number | string | null
  clicks: number | string | null
  leads: number | string | null
  messaging_conversations: number | string | null
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── 输出 ──────────────────────────────────────────────────────────────────────

/**
 * 样本量。**跟数字同一个对象**，不许分开传 —— 分开传就一定会有人只渲染数字。
 *
 * conversations 是分母:一次「真的有人举手」(表单 lead 或私信对话)。
 * ads / days 说明这个分母是从多宽的面上来的;listings / clients 说明它覆盖几套房、几个账户。
 */
export interface AdSampleSize {
  conversations: number
  ads: number
  days: number
  listings: number
  clients: number
}

/**
 * 粒度。目前只有一档 —— 广告和具体某套房之间**没有**结构化对应关系
 * (ad_daily_insights 没有 listing 维度、campaign_briefs.listing_id 至今 0 行有值、
 * ad_creative_links 至今 0 行)，所以能可靠拿到的只有「整个广告账户」。
 * 将来建广告时把 listing 记下来了，这里再加 'listing'。
 */
export type AdBenchmarkGranularity = 'client_account'

export interface AdReferenceGroup {
  scope: 'this_client' | 'similar_listings'
  granularity: AdBenchmarkGranularity
  spend: number
  conversations: number
  impressions: number
  clicks: number
  /** 每次对话多少钱。没有对话时是 null —— 不是 0，也不是「花的钱」。 */
  cost_per_conversation: number | null
  sample: AdSampleSize
  /** true = 这些账户里还挂着别的房源，这笔钱拆不到单套房上。 */
  mixed_with_other_listings: boolean
}

export interface AdReferenceSimilarity {
  price_band: string | null
  suburb: string | null
  property_type: string | null
  /** 三个维度缺任何一个就判不了「同类」—— 判不了要说出来，不许拿两个维度凑。 */
  resolvable: boolean
}

export interface AdReferencePattern {
  tier: PatternTier
  provenance: string
  min_listings: number
  confirmed_listings: number
  distinct_clients: number
  consecutive_reversals: number
  /** true = 这次是被连续打脸打回「待验证」的，不是样本还不够。 */
  demoted: boolean
}

/** 存进 listing_briefs.ad_reference 的那一整块。 */
export interface AdReferenceBlock {
  generated_at: string
  similarity: AdReferenceSimilarity
  own: AdReferenceGroup | null
  peers: AdReferenceGroup | null
  pattern: AdReferencePattern
  /** 人话写的限制。UI 必须原样显示 —— 限制不显示就等于没有限制。 */
  limitations: string[]
}

// ── 汇总 ──────────────────────────────────────────────────────────────────────

/** 把一批实测行压成一组数字 + 它的样本量。纯累加，不做任何判断。 */
export function summariseInsights(rows: AdInsightRow[]): {
  spend: number
  conversations: number
  impressions: number
  clicks: number
  ads: number
  days: number
} {
  const ads = new Set<string>()
  const days = new Set<string>()
  let spend = 0
  let conversations = 0
  let impressions = 0
  let clicks = 0

  for (const r of rows) {
    ads.add(r.entity_id)
    days.add(r.insight_date)
    spend += num(r.spend)
    impressions += num(r.impressions)
    clicks += num(r.clicks)
    // 表单 lead 和私信对话都算「有人举手了」。地产这条线目前跑的是私信目标，
    // 未来换成表单目标时分母含义仍要不变。
    // 用 max 而不是 +：Lead Form 广告如果开了 Messenger 自动回复，Meta 会
    // 把同一个人算成一个 lead + 一个 messaging_conversation（CTS 2026-09-06
    // 事故），简单相加 2× 双算。见 meta/client.ts parseDailyMetrics 的说明。
    conversations += Math.max(num(r.leads), num(r.messaging_conversations))
  }

  return { spend, conversations, impressions, clicks, ads: ads.size, days: days.size }
}

export interface BuildGroupInput {
  scope: AdReferenceGroup['scope']
  rows: AdInsightRow[]
  /** 这一组覆盖几套房源。 */
  listings: number
  /** 这一组来自几个客户账户。 */
  clients: number
  /** 这些账户下一共挂着几套房源(> listings 说明钱拆不开)。 */
  listingsInAccounts: number
}

/**
 * 一组实测。**没有花过一分钱就返回 null** —— 一组全 0 的数字摆在页面上，
 * 人只会以为「投了但没效果」，而事实是根本没投过。这两件事不能长一个样。
 */
export function buildGroup(input: BuildGroupInput): AdReferenceGroup | null {
  const t = summariseInsights(input.rows)
  if (t.spend <= 0 && t.conversations === 0) return null

  return {
    scope: input.scope,
    granularity: 'client_account',
    spend: round2(t.spend),
    conversations: t.conversations,
    impressions: t.impressions,
    clicks: t.clicks,
    cost_per_conversation: t.conversations > 0 ? round2(t.spend / t.conversations) : null,
    sample: {
      conversations: t.conversations,
      ads: t.ads,
      days: t.days,
      listings: input.listings,
      clients: input.clients,
    },
    mixed_with_other_listings: input.listingsInAccounts > input.listings,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── 整块 ──────────────────────────────────────────────────────────────────────

export interface BuildAdReferenceInput {
  similarity: Omit<AdReferenceSimilarity, 'resolvable'>
  own: BuildGroupInput | null
  peers: BuildGroupInput | null
  /** 同类房源里已经回填过结论的套数 / 来自几个客户 / 最近连续几套打脸。 */
  evidence: { confirmedListings: number; distinctClients: number; consecutiveReversals: number }
  now?: Date
}

/**
 * 组装摆给人看的那一整块。
 *
 * 这里**不做**任何「所以应该主打哪条」的推断 —— 那是 AI 按房子本质排的，
 * 本块只负责把实测摆在旁边。见文件头纪律 ①。
 */
export function buildAdReference(input: BuildAdReferenceInput): AdReferenceBlock {
  const { price_band, suburb, property_type } = input.similarity
  const resolvable = Boolean(price_band && suburb && property_type)

  const own = input.own ? buildGroup(input.own) : null
  const peers = resolvable && input.peers ? buildGroup(input.peers) : null
  const verdict = classifyPattern(input.evidence)

  return {
    generated_at: (input.now ?? new Date()).toISOString(),
    similarity: { price_band, suburb, property_type, resolvable },
    own,
    peers,
    pattern: {
      tier: verdict.tier,
      provenance: verdict.provenance,
      min_listings: PATTERN_MIN_CONFIRMED_LISTINGS,
      confirmed_listings: Math.max(0, input.evidence.confirmedListings),
      distinct_clients: Math.max(0, input.evidence.distinctClients),
      consecutive_reversals: Math.max(0, input.evidence.consecutiveReversals),
      demoted: verdict.demoted,
    },
    limitations: buildLimitations({ own, peers, resolvable }),
  }
}

/** 限制清单。每一条都是「这个数字不能拿来干什么」，用人话写。 */
function buildLimitations(ctx: {
  own: AdReferenceGroup | null
  peers: AdReferenceGroup | null
  resolvable: boolean
}): string[] {
  const out: string[] = [
    '这些是整体数字，不是按卖点角度拆开的。广告投的是哪条角度，目前只写在人手起的广告名里，没有结构化记录 —— 靠广告名去猜，猜出来的东西会被当成数据。',
  ]
  if (ctx.own?.mixed_with_other_listings || ctx.peers?.mixed_with_other_listings) {
    out.push('广告和具体某一套房之间目前没有记录对应关系，所以这里是整个广告账户的合计，里面还混着这个账户的其他房源，拆不开。')
  }
  if (!ctx.resolvable) {
    out.push('这套房的价格档 / 区 / 房型没填全，判不了「同类房源」，所以没有同类对照。')
  }
  if (!ctx.own && !ctx.peers) {
    out.push('目前没有可用的投放实测数据 —— 这不是「投了没效果」，是还没有投过或还没回流。')
  }
  return out
}

// ── 唯一的显示出口(纪律 ②)───────────────────────────────────────────────────

export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

/**
 * 每次对话多少钱 —— **永远带样本量**。
 *
 * 🔴 变异测试目标：把「· 基于 N 次对话」去掉、只返回成本数，
 *    `ad-benchmarks.test.ts` 里「成本数必须跟样本量同框」那一批必须变红。
 *
 * 对话数为 0 时不返回任何成本数字：那种情况下算出来的「每次多少钱」是除以 0，
 * 而摆一个孤零零的花费数在页面上，人会当成单价读。
 */
export function formatCostWithSample(group: AdReferenceGroup | null): string {
  if (!group) return '没有数据'
  if (group.sample.conversations === 0 || group.cost_per_conversation === null) {
    return '没有数据（还没有一次对话）'
  }
  return `${formatMoney(group.cost_per_conversation)} · 基于 ${group.sample.conversations} 次对话`
}

/** 花了多少钱 —— 同样带样本量(几条广告、几天)。 */
export function formatSpendWithSample(group: AdReferenceGroup | null): string {
  if (!group) return '没有数据'
  return `${formatMoney(group.spend)} · ${group.sample.ads} 条广告 / ${group.sample.days} 天`
}

/**
 * 这份实测到底算什么成色。
 *
 * 🔴 变异测试目标：把 PATTERN_MIN_CONFIRMED_LISTINGS 从 6 改成 1，
 *    「5 套仍然只是单轮观察」那条必须变红。阈值只有 pattern-promotion.ts
 *    一个来源，本文件不许另写一个数。
 */
export function benchmarkConfidenceLabel(pattern: AdReferencePattern): string {
  const n = pattern.confirmed_listings
  if (pattern.tier === 'general_pattern') {
    return `已攒够 ${n} 套同类房源、来自 ${pattern.distinct_clients} 个客户，可以当规律参考`
  }
  if (pattern.tier === 'client_pattern') {
    return `已攒够 ${n} 套同类房源，但全来自同一个客户，只当这个客户的规律`
  }
  if (pattern.demoted) {
    return `单轮观察，样本不足 —— 最近连续 ${pattern.consecutive_reversals} 套跟当初判断相反，已打回待验证`
  }
  return `单轮观察，样本不足（同类已回填 ${n} 套，攒够 ${pattern.min_listings} 套才谈得上规律）`
}

// ── 纪律 ①：参考数据挂旁边，绝不动判断栏 ─────────────────────────────────────

/**
 * 把参考数据挂到一份 draft 旁边。
 *
 * 🔴 这个函数的全部价值就是它**什么都没做**：content 原样带过去，
 *    angle_ranking / buyer_segments 一个字不改。
 *
 *    变异测试目标：在这里按 ad_reference 的成本高低重排 content.angle_ranking，
 *    `ad-benchmarks.test.ts` 里「实测数据不许改排序」那一批必须变红。
 *
 *    为什么把「不做事」写成一个函数而不是散在调用点：散着写就没有地方可以被测。
 *    这里是唯一的汇合点，也是唯一需要守住的地方。
 */
export function applyAdReferenceToDraft<T>(
  content: T,
  reference: AdReferenceBlock | null,
): { content: T; ad_reference: AdReferenceBlock | null } {
  return { content, ad_reference: reference }
}
