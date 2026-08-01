/**
 * 房子档案的提示词。
 *
 * 两条设计原则,别在改文案时顺手破坏:
 *
 * 1. **可选值清单是从 brief-constants 生成的,不是手抄的。** 手抄一次,加枚举时
 *    就会漏改一处,然后模型继续吐旧词、被 schema 挡掉、人看到一次莫名其妙的失败。
 *
 * 2. **「查不到」是一个正经答案。** 提示词里反复要求宁可进 gaps 也不许估 ——
 *    ME 为编数字出过两次事故(CTS 编行程 / Oztop 编搜索量)。地产的中位价是中介
 *    会拿去跟卖家谈的数,编一个的杀伤力比空着大得多。schema 那层还有硬闸门兜底,
 *    但让模型一开始就不编,比事后拒绝便宜。
 */

import {
  BUYER_SEGMENTS,
  LISTING_ANGLES,
  LISTING_HESITATIONS,
  BRIEF_SOURCE_KINDS,
} from './brief-constants'
import {
  formatCostWithSample,
  formatSpendWithSample,
  benchmarkConfidenceLabel,
  type AdReferenceBlock,
  type AdReferenceGroup,
} from './ad-benchmarks'
import type { ListingRow } from './queries'

export const LISTING_BRIEF_SYSTEM_PROMPT = `You are a residential real-estate marketing analyst working for a NZ/AU agency back office.

Your job: read a property listing page (already fetched for you) plus current public market data, and produce a structured brief that the agency will use to plan advertising and content.

## Non-negotiable rules

1. NEVER invent a number. Median price, YoY change, rental yield, comparable sale prices — every single one must come from a source you actually saw (the listing page, or a page you found via web search). If you cannot find it, leave it out and add a plain-English line to "gaps" saying what is missing. A missing number is a correct answer. A plausible-looking made-up number is a serious failure that can end up in a conversation with a vendor.
2. NEVER invent operational details about the property (school zone, completion date, parking, body corp) — only state what the listing page or a cited source says. Anything you are reasoning towards rather than reading must be marked as inferred in "sources".
3. Every meaningful field must appear in "sources" with kind = "cited" (you saw it, give the url), "inferred" (your judgement, no direct source) or "missing" (you looked and could not find it).
4. If one listing page describes SEVERAL different unit configurations (e.g. "units 3 & 11 are 108m2" and "units 5/7/9 are 139.7m2 with study and internal garage"), you MUST split them into separate entries in "unit_variants". Do not flatten them into one. Different configurations attract different buyers, and collapsing them makes the whole brief useless for targeting.
5. Use ONLY the enum values listed below. Do not invent new ones. If nothing fits, leave the array shorter and explain in "gaps".
6. If the message includes a section called "Our own past ad results", it is REFERENCE ONLY. You MUST NOT let it change "angle_ranking" or "buyer_segments". Rank the angles on what this property actually is — location, configuration, school zone, price method, the vendor's wording — exactly as you would if that section were absent. Those numbers come from a handful of conversations; a cheaper cost-per-conversation on one ad is noise, not evidence. Treating it as evidence is a known, already-committed mistake we are deliberately preventing here. Do not mention those numbers in "rationale" either.

## Output

Return ONLY a JSON object, no prose, no markdown fences. Shape:

{
  "buyer_segments": [<enum>],
  "angle_ranking": [{"angle": <enum>, "rank": 1, "rationale": "why this ranks here"}],
  "hesitations": [<enum>],
  "unit_variants": [{"label": "Unit 5", "size_sqm": 139.7, "config": "3 bed + study + internal garage", "target_segments": [<enum>]}],
  "market_snapshot": {
    "median_price": {"value": 950000, "source": "https://..."} | null,
    "yoy_change_pct": {"value": -3.2, "source": "https://..."} | null,
    "rental_yield": {"value": 4.1, "source": "https://..."} | null,
    "area_avg_yield": {"value": 3.8, "source": "https://..."} | null,
    "comparables": [{"address": "12 Example Rd", "price": 910000, "sold_on": "2026-05", "source": "https://..."}]
  },
  "facts": {
    "price_method": "Price by negotiation" | null,
    "completion_status": "completed" | "under construction" | null,
    "school_zone": "..." | null,
    "nearby": ["..."],
    "vendor_motivation": "..." | null
  },
  "gaps": ["what you could not find, in plain English"],
  "sources": [{"field": "market_snapshot.median_price", "kind": <enum>, "url": "https://..." | null, "note": "..." | null}]
}

Rules on the JSON itself:
- "rank" starts at 1 (1 = the angle to lead with) and each angle appears at most once.
- A "market_snapshot" entry with a number but no source is INVALID and will be rejected outright — omit it and use "gaps" instead.
- A "sources" entry with kind "cited" MUST carry a url.
- Write "rationale", "gaps" and "note" in Simplified Chinese (the operators reading this are Chinese-speaking). Keep everything else — enum values, addresses, urls — exactly as specified.`

/** 可选值清单:从常量生成,加枚举时自动跟上。 */
export function buildEnumReference(): string {
  return [
    `buyer_segments / target_segments / actual_segments: ${BUYER_SEGMENTS.join(' | ')}`,
    `angle_ranking[].angle: ${LISTING_ANGLES.join(' | ')}`,
    `hesitations: ${LISTING_HESITATIONS.join(' | ')}`,
    `sources[].kind: ${BRIEF_SOURCE_KINDS.join(' | ')}`,
  ].join('\n')
}

export interface BriefPromptInput {
  listing: ListingRow
  /** 房源页正文(Jina 读回来的 markdown)。没有就是 null —— 提示词会明说没有。 */
  pageMarkdown: string | null
  pageUrl: string | null
  /** 客户所在市场,给 web search 和文案口径用。 */
  country: 'AU' | 'NZ'
  city: string | null
  /**
   * 我们自己投放的实测。**参考材料**,不是判断依据 —— 提示词里会连同禁令一起给。
   * 没有就是 null(这一整段不出现)。
   */
  adReference?: AdReferenceBlock | null
}

/** 一组实测写成人能读、也让模型看得见样本量的一行。 */
function describeGroup(label: string, group: AdReferenceGroup | null): string {
  if (!group) return `- ${label}: 没有数据`
  const mixed = group.mixed_with_other_listings
    ? '（这是整个广告账户的合计，里面还混着同账户的其他房源，拆不开）'
    : ''
  return [
    `- ${label}:`,
    `  · 每次对话多少钱: ${formatCostWithSample(group)}`,
    `  · 一共花了: ${formatSpendWithSample(group)}`,
    `  · 样本覆盖: ${group.sample.listings} 套房源 / ${group.sample.clients} 个客户账户${mixed}`,
  ].join('\n')
}

/**
 * 「我们自己投过什么」这一段。
 *
 * 🔴 禁令跟数字**贴在一起**,不是丢在系统提示词里就算数:模型读到数字的那一刻
 *    就在推理了,禁令离得越远越不管用。同理每个数字后面直接缝着样本量 ——
 *    不给样本量,模型会像人一样把 1 次对话当成结论(这正是本功能要防的那次错误)。
 */
export function describeAdReference(block: AdReferenceBlock | null): string {
  if (!block) return ''
  const lines = [
    '## Our own past ad results (REFERENCE ONLY — must not change your ranking)',
    '',
    '🔴 Read rule 6 again before you use anything below. These numbers describe how our own ads have',
    'performed. They are NOT evidence about which angle this property should lead with, because the',
    'sample sizes are tiny and the numbers are NOT broken down by angle at all.',
    '',
    describeGroup('这套房所属客户的账户', block.own),
    describeGroup('同类房源（同价格档 × 同区 × 同房型）', block.peers),
    '',
    `- 这份实测的成色: ${benchmarkConfidenceLabel(block.pattern)}`,
    '',
    '限制（这些数字不能拿来干什么）:',
    ...block.limitations.map(l => `  · ${l}`),
    '',
    'Rank the angles as if this section did not exist. Do not cite these numbers in "rationale".',
  ]
  return lines.join('\n')
}

/** 房子本身在 ME 里已知的事实。这些是**确定的**,不要让模型再去推一遍。 */
function describeListing(l: ListingRow): string {
  const bits = [
    `Address: ${l.address_line}`,
    l.suburb ? `Suburb: ${l.suburb}` : null,
    l.city ? `City: ${l.city}` : null,
    l.property_type ? `Property type (agency's own classification): ${l.property_type}` : null,
    l.bedrooms != null ? `Bedrooms recorded by the agency: ${l.bedrooms}` : null,
    l.price_band ? `Price band recorded by the agency: ${l.price_band}` : null,
    `Sale status: ${l.status}`,
    l.listed_on ? `Listed on: ${l.listed_on}` : null,
    l.vendor_notes ? `Agency's internal notes: ${l.vendor_notes}` : null,
  ].filter(Boolean)
  return bits.join('\n')
}

export function buildBriefUserMessage(input: BriefPromptInput): string {
  const { listing, pageMarkdown, pageUrl, country, city } = input
  const referenceBlock = describeAdReference(input.adReference ?? null)

  const marketLine = city
    ? `The market is ${city}, ${country}. Use ${country} sources and ${country} conventions.`
    : `The market is ${country}. Use ${country} sources and ${country} conventions.`

  const pageBlock = pageMarkdown
    ? `## Listing page (fetched from ${pageUrl})\n\nTreat this as the primary factual source. Anything stated here can be cited with the url above.\n\n${pageMarkdown}`
    : `## Listing page\n\nNot provided. You have no listing page text this time — rely on the agency facts above, mark everything you cannot verify as "missing", and put the shortfall in "gaps". Do NOT fill the blanks with plausible guesses.`

  return `${marketLine}

## What the agency already knows about this property

${describeListing(listing)}

${pageBlock}
${referenceBlock ? `\n${referenceBlock}\n` : ''}
## Allowed enum values (use these exact strings, nothing else)

${buildEnumReference()}

## Task

1. Extract the hard facts from the listing page (price method, configuration(s), school zone, what is nearby, anything the vendor's own wording reveals about motivation).
2. If the page describes more than one unit configuration, split them into separate "unit_variants" entries.
3. Search the web for current market data for this suburb: median sale price, year-on-year change, rental yield, and the area's average yield. Cite every number. If a number is not findable, omit it and say so in "gaps".
4. Decide which buyer segments this property realistically attracts, rank the selling angles, and list what those buyers will hesitate over. Base this on the property itself. If "Our own past ad results" was included above, it must NOT move a single angle up or down.
5. Fill "sources" so every meaningful field is marked cited / inferred / missing.

Return the JSON object only.`
}
