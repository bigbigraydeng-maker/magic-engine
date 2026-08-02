/**
 * 按行业决定哪些功能对这个客户可见（2026-08-03）。
 *
 * PM 2026-08-03 原话：「中旅的 ME 后台不应该出现任何和地产有关的按钮和 page（现在是有的）」。
 *
 * 真实缺陷：`buildScopedAdminSections` 给**每一个客户**都挂上「房子」和「行程单」两个入口，
 * 于是旅行社后台有地产工具、建材客户后台有旅游行程单。客户看到跟自己毫不相干的功能，
 * 第一反应是「这系统不是给我做的」。
 *
 * 🔴 默认隐藏，不是默认显示。
 *    行业字段目前 15 个客户是空的、还有一批是自由文本（'Travel — Tour Operator'、
 *    'SPC/hybrid flooring wholesale (B2B trade)'）。默认显示的话，任何一个没填行业的
 *    客户都会看到全部行业专属功能 —— 正是现在这个 bug 的形态。
 *    认不出行业就一个都不给，代价是「去把行业填上」，而不是把地产按钮塞给旅行社。
 *
 * 不复用 huatuo/industry-mapper：那个字典是给对标基准分类用的，而且它按空格匹配
 * （`'real estate'`），而库里实际存的是 `'real_estate'`，下划线直接匹配不上。
 */

/** 行业专属功能。加新功能前先问：这东西对别的行业有意义吗？有就别加进来。 */
export type IndustryFeature = 'listings' | 'projects' | 'tailor_made'

/**
 * 归一化：下划线/连字符/多余空格统一，大小写拉平。
 * `'real_estate'`、`'Real Estate'`、`'Real — Estate'` 都要能认出来。
 */
export function normaliseIndustry(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .toLowerCase()
    .replace(/[_\-—–/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 每个功能认哪些行业关键词。中英文都要有 —— 库里两种都存在。 */
const REAL_ESTATE_KEYWORDS = [
  'real estate', 'realestate', 'property', 'realty', 'realtor', 'homes',
  '房地产', '地产', '中介', '楼盘',
]

const FEATURE_KEYWORDS: Record<IndustryFeature, string[]> = {
  // 「房子」= 中介手上在卖的每一套房
  listings: REAL_ESTATE_KEYWORDS,
  // 「楼盘」= 中介名下的开发项目,各带自己的 brief/策略/素材(PM 2026-08-03:
  // 这是 Magic Engine 海外地产版的独有工具,别的行业不该看到)
  projects: REAL_ESTATE_KEYWORDS,
  tailor_made: ['travel', 'tour', 'tourism', 'sightseeing', 'cruise', '旅游', '旅行', '观光', '行程'],
}

/**
 * 这个客户该不该看到这个功能。
 *
 * 行业为空 / 认不出 → **false**（见头注：默认隐藏）。
 */
export function hasIndustryFeature(
  industry: string | null | undefined,
  feature: IndustryFeature,
): boolean {
  const haystack = normaliseIndustry(industry)
  if (!haystack) return false
  return FEATURE_KEYWORDS[feature].some((kw) => haystack.includes(kw))
}

/** 一次拿到全部开关，省得每个调用方各判一遍。 */
export function industryFeatureFlags(industry: string | null | undefined): Record<IndustryFeature, boolean> {
  return {
    listings: hasIndustryFeature(industry, 'listings'),
    projects: hasIndustryFeature(industry, 'projects'),
    tailor_made: hasIndustryFeature(industry, 'tailor_made'),
  }
}
