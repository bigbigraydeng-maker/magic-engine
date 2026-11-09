/**
 * 旅游业：「这封信在问事」的正面证据词表（行业剧本，不是客户特供）。
 *
 * 命中任一词 → 确定性硬否决：模型再说「不是咨询」也不筛（宁可漏筛，不错筛真客人）。
 * 按语言分组；词表只会让更多人留在名单里，所以加词永远是安全方向。
 * 设计稿 §5.1 第 6 条。
 */

export const TRAVEL_ENQUIRY_TERMS: Readonly<Record<string, readonly string[]>> = {
  // 只收「在问事」的强信号。故意不收 tour / depart / book / transfer / travelling 这类泛词：
  // 推销信、群发信里到处都是，收了会让筛选形同虚设（干跑会逐词报命中数，需要时再加）。
  en: [
    'quote',
    'quotation',
    'price',
    'pricing',
    'how much',
    'cost',
    'itinerary',
    'availability',
    'booking',
    'pax',
    'passengers',
    // 已经有钱的往来（付款 / 定金 / 收据 / 订好的机票）：这不是陌生来信，永远不筛。
    // 2026-10-21 干跑金标准里，一封「确认已收到你的付款和航班」的信被模型判成系统通知，补上。
    'paid',
    'payment',
    'deposit',
    'receipt',
    'booked',
    'flight',
    'bank transfer',
  ],
  zh: ['付款', '已付', '定金', '收据', '机票', '报价', '价格', '多少钱', '行程', '空位', '订位', '预订', '人数', '团费'],
}

/** 把词表摊平成小写数组。 */
export function flattenEnquiryTerms(terms: Readonly<Record<string, readonly string[]>> = TRAVEL_ENQUIRY_TERMS): string[] {
  return Object.values(terms).flatMap((list) => list.map((t) => t.toLowerCase()))
}
