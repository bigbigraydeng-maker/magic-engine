import type { MarketIntelCategory, RawFeedItem } from './types'

/**
 * 三类广告平台分类（meta_ads / google_ads / tiktok_ads）需要跟"泛泛平台新闻"
 * 区分开——"Meta 财报""Meta 出 Mac app"提到平台名但跟广告无关，不该进来。
 * 其余分类（ai_startup / marketing / llm_news / chatgpt_ads / china_outbound）
 * 的信源本身就是话题已收窄的分类源（垂直媒体或 Google News 按主题预筛的查询
 * feed），走"来源即数"，不做二次过滤。
 *
 * v1（设计文档 §7.2）只用"完整产品名短语"白名单（"Meta Ads""TikTok Ads"…）。
 * 2026-09-03 实测（market_intel_items 生产数据）发现召回率过低：真实标题极少
 * 逐字写"Meta Ads""TikTok Ads"，导致 meta_ads / tiktok_ads 连续多天候选池零
 * 命中——Social Media Today 这种 Meta/TikTok 平台主力源 14 天 0 条入库，抓取
 * 成功但每条都被 matchCategory 判 null 丢弃。
 *
 * v2 对这三类广告分类改成两条命中路径（其余分类不受影响，照旧来源即数）：
 *   1. STRONG_PHRASES：本身无歧义的完整短语（"Ads Manager""Spark Ads"…），
 *      子串命中即归类；
 *   2. 平台词 + 广告词共现：标题/摘要里同时出现某个平台词（Meta/TikTok…）和某个
 *      广告语境词（ad/ads/advertising…）才归类——只提平台不谈广告的新闻
 *      （"Meta earnings"）不会命中，因为缺广告语境词。
 * 平台词和广告词都按"整词"匹配（词边界），避免 "metadata""added" 这类子串误伤。
 */

// 路径 1：无歧义完整短语，命中即归类（大小写不敏感，短语首尾按词边界匹配，
// 见 hasBoundedPhrase——否则 'IG Ads' 会子串误命中 "big ads"、'Ads Manager' 误命中
// "leads manager"）。'Reels ad'/'Reels ads' 放这里而不进平台词，是因为裸 "Reels"
// 会撞英文动词 reels（"Ad industry reels from…"），只在跟广告连写时才算数。
export const CATEGORY_STRONG_PHRASES: Partial<Record<MarketIntelCategory, string[]>> = {
  meta_ads: [
    'Meta Ads', 'Facebook Ads', 'Instagram Ads', 'Instagram advertising', 'IG Ads',
    'Ads Manager', 'Advantage+', 'Advantage Plus', 'Meta advertising', 'Facebook advertising',
    'Reels ads', 'Reels ad',
  ],
  google_ads: ['Google Ads', 'Performance Max', 'Smart Bidding', 'Google advertising', 'PPC'],
  tiktok_ads: ['TikTok Ads', 'TikTok for Business', 'TikTok advertising', 'Spark Ads', 'TikTok Shop ads'],
}

// 路径 2：平台词（整词） + 广告词（整词）共现。只给 meta_ads / tiktok_ads——
// 这两类真实标题极少含完整产品名短语；google_ads 靠 STRONG_PHRASES 里的
// "Google Ads"/"PPC" 已够用，不加 "Google" 这种泛平台词，以免把泛科技新闻灌进来。
// 平台词只收本身即专有名词的整词（Reels 是动词歧义词，已下放到 STRONG_PHRASES）。
const CATEGORY_PLATFORM_WORDS: Partial<Record<MarketIntelCategory, string[]>> = {
  meta_ads: ['Meta', 'Facebook', 'Instagram'],
  tiktok_ads: ['TikTok'],
}

// 广告语境词——出现任一个才算"这条在谈广告"。故意保守：只收无歧义的广告词，
// 不收 "campaign"（可能是选举/公关活动）这类会误伤的词。
const AD_CONTEXT_WORDS = ['ad', 'ads', 'advertising', 'advertiser', 'advertisers']

/** 完整短语子串命中，大小写不敏感。不是拆词匹配（"meta ads" 不会命中
 *  "Meta reports quarterly ads"）。留作原语义基元，分类判定用 hasBoundedPhrase。 */
export function hasPhrase(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase.toLowerCase())
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 整词命中（词边界，大小写不敏感）——"ad" 不会命中 "add"/"ads"/"adapt"/"read"，
 * "Meta" 不会命中 "metadata"/"metaverse"。用于平台词 / 广告词共现判定。
 */
export function hasWord(text: string, word: string): boolean {
  const re = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegExp(word)}([^a-zA-Z0-9]|$)`, 'i')
  return re.test(text)
}

/**
 * 短语命中，但首尾按词边界匹配（短语内部字符照原样）——用于 STRONG_PHRASES 判定。
 * 比 hasPhrase 多的边界保护：'IG Ads' 不会命中 "big ads"，'Ads Manager' 不会命中
 * "leads manager"；多词短语内部的空格照常按字面匹配（"TikTok for Business"）。
 */
export function hasBoundedPhrase(text: string, phrase: string): boolean {
  const re = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegExp(phrase)}([^a-zA-Z0-9]|$)`, 'i')
  return re.test(text)
}

/** 受控分类：需要短语 / 共现判定才算数；其余分类"来源即数"直接放行。 */
function isGatedCategory(category: MarketIntelCategory): boolean {
  return Boolean(CATEGORY_STRONG_PHRASES[category] || CATEGORY_PLATFORM_WORDS[category])
}

function itemMatchesCategory(item: RawFeedItem, category: MarketIntelCategory): boolean {
  if (!isGatedCategory(category)) return true // 无白名单的分类（ai_startup / marketing …）：来源即数

  const haystack = `${item.title} ${item.excerpt}`

  const strong = CATEGORY_STRONG_PHRASES[category]
  if (strong && strong.some((phrase) => hasBoundedPhrase(haystack, phrase))) return true

  const platforms = CATEGORY_PLATFORM_WORDS[category]
  if (
    platforms &&
    platforms.some((p) => hasWord(haystack, p)) &&
    AD_CONTEXT_WORDS.some((a) => hasWord(haystack, a))
  ) {
    return true
  }

  return false
}

/**
 * 按信源声明的候选分类逐个尝试，返回第一个命中的分类；全不命中返回 null
 * （该条目不入库，§7.2："不命中的条目不进入候选池"）。
 *
 * 受控分类（meta_ads / google_ads / tiktok_ads）优先于"来源即数"分类：像 Digiday
 * （声明 ['marketing', 'tiktok_ads']）这种混配信源，若严格按声明顺序匹配，无白名单
 * 的 marketing 会先吃掉所有条目，tiktok_ads 永远轮不到（2026-09-03 实测：Digiday
 * 45 条全落 marketing，tiktok_ads 零命中）。先试受控分类、miss 再落到来源即数分类，
 * 既让 tiktok_ads 有机会命中真正的 TikTok 广告新闻，非广告条目也能正常回落 marketing。
 * 组内保持声明顺序（例如同时声明 google_ads/meta_ads 时仍按声明先后决定归属）。
 */
export function matchCategory(
  item: RawFeedItem,
  sourceCategories: MarketIntelCategory[],
): MarketIntelCategory | null {
  const gated = sourceCategories.filter((c) => isGatedCategory(c))
  const openEnded = sourceCategories.filter((c) => !isGatedCategory(c))
  for (const category of [...gated, ...openEnded]) {
    if (itemMatchesCategory(item, category)) return category
  }
  return null
}
