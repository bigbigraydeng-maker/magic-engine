/**
 * Industry Mapper — 把张骞 business.industry 自由文本数组映射到 benchmark 行业代码。
 *
 * 张骞输出：`industry: ["建材", "地板", "瓷砖"]`
 * 华佗需要：`industry_category: 'building_supplies'`
 *
 * 算法：关键词匹配字典 — 简单可解释，避免引入 embedding 复杂度。
 * 后续可换成 LLM 分类或向量相似度，但 v0 用字典足够。
 */

export interface IndustryMapEntry {
  category: string
  keywords: string[]    // 中英文 + 拼写变体
}

export const INDUSTRY_DICTIONARY: IndustryMapEntry[] = [
  {
    category: 'building_supplies',
    keywords: ['建材', '地板', '瓷砖', '木材', '装修材料', 'building supplies', 'flooring', 'tiles', 'timber', 'hardware'],
  },
  {
    category: 'tourism_operator',
    keywords: ['旅游', '观光', '游船', '导游', '景区', '旅行社', 'tourism', 'tour operator', 'travel', 'travel agency', 'sightseeing', 'cruise'],
  },
  {
    category: 'accounting_advisory',
    keywords: ['会计', '财务', '税务', '审计', 'accounting', 'bookkeeping', 'tax', 'cpa', 'advisory', 'financial planning'],
  },
  {
    category: 'legal_services',
    keywords: ['律师', '法律', '法务', '律所', 'legal', 'lawyer', 'solicitor', 'attorney', 'law firm', 'conveyancing'],
  },
  {
    category: 'dental_clinic',
    keywords: ['牙科', '牙医', '齿科', '种植牙', 'dental', 'dentist', 'orthodontic', 'implant'],
  },
  {
    category: 'real_estate_agency',
    keywords: ['房地产', '中介', '地产经纪', 'real estate', 'property', 'realty', 'realtor'],
  },
  {
    category: 'hospitality_restaurant',
    keywords: ['餐饮', '餐厅', '酒店', '咖啡', '烘焙', 'restaurant', 'cafe', 'hospitality', 'hotel', 'bakery', 'bar'],
  },
  {
    category: 'trades_plumbing_electrical',
    keywords: ['水电', '管道', '电工', '维修', '技工', 'plumbing', 'electrical', 'plumber', 'electrician', 'tradie', 'hvac'],
  },
  {
    category: 'fitness_studio',
    keywords: ['健身', '瑜伽', '私教', '体能', 'fitness', 'gym', 'yoga', 'pilates', 'crossfit', 'personal training'],
  },
  {
    category: 'ecommerce_d2c',
    keywords: ['电商', 'd2c', '在线零售', '直销品牌', 'ecommerce', 'e-commerce', 'online store', 'd2c', 'shopify'],
  },
]

/**
 * 把张骞输出的行业标签数组（中文为主）映射到一个 benchmark 行业代码。
 * 返回 null 表示没匹配到，调用方应使用通用 fallback 基准。
 */
export function mapIndustryToCategory(industryTags: string[]): string | null {
  if (!industryTags || industryTags.length === 0) return null

  // 拼起来小写匹配（处理多标签场景，如 ["建材", "地板"]）
  const haystack = industryTags.join(' ').toLowerCase()

  // 计算每个 category 的匹配关键词数，选最高的
  let bestCategory: string | null = null
  let bestHits = 0
  for (const entry of INDUSTRY_DICTIONARY) {
    const hits = entry.keywords.filter(kw => haystack.includes(kw.toLowerCase())).length
    if (hits > bestHits) {
      bestHits = hits
      bestCategory = entry.category
    }
  }

  return bestCategory
}

/**
 * 反向：给 category 返回人类可读的中文行业名（用于 prompt 和 UI）
 */
export function categoryToChineseName(category: string | null): string {
  const map: Record<string, string> = {
    building_supplies:            '建材/家装材料',
    tourism_operator:             '旅游运营商',
    accounting_advisory:          '会计与财务咨询',
    legal_services:               '法律服务',
    dental_clinic:                '牙科诊所',
    real_estate_agency:           '房地产中介',
    hospitality_restaurant:       '餐饮/酒店',
    trades_plumbing_electrical:   '水电/技工服务',
    fitness_studio:               '健身工作室',
    ecommerce_d2c:                'D2C 电商',
  }
  if (!category) return '通用 SMB（未匹配到具体行业）'
  return map[category] ?? category
}
