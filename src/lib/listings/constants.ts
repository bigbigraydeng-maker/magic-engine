/**
 * 房子(listing)的共享枚举 —— 前端下拉 + 后端校验共用这一份。
 *
 * 为什么要有这个文件:三处取值(房型 / 价格档 / 状态)在数据库里是 CHECK 约束,
 * 在前端是下拉选项,在后端是写入校验。三处各写一遍字符串字面量 = 迟早漂移,
 * 而漂移的表现是「前端能选、后端放行、数据库 500」这种最难查的错。
 *
 * 跟 lib/crm/pipeline.ts 同样的纪律,保持纯净:不 import supabase、不碰运行时
 * 环境,client / server 都能安全引。
 *
 * slug 是稳定英文(数据库存的就是它,永不改),label 是中文(只给人看,可以改)。
 *
 * ⚠️ 加新值必须三处同步(CLAUDE.md enum 硬约束):
 *   ① 数据库 CHECK 约束(要 PM 拍板才能动库)
 *   ② 这个文件的 as const 数组 + LABEL 记录
 *   ③ 确认所有读 LABEL 的地方走的是 xxxLabel() 兜底函数,不是直接下标
 * 反过来:数据库先加了值而这里没跟上时,xxxLabel() 显示原始 slug 而不是崩掉。
 */

// ── 房型 ──────────────────────────────────────────────────────────────────────

export const PROPERTY_TYPES = [
  'house',
  'apartment',
  'townhouse',
  'section',
  'new_build',
  'other',
] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

export function isPropertyType(v: unknown): v is PropertyType {
  return typeof v === 'string' && (PROPERTY_TYPES as readonly string[]).includes(v)
}

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  house:     '独立屋',
  apartment: '公寓',
  townhouse: '联排',
  section:   '地皮',
  new_build: '新建房',
  other:     '其他',
}

// ── 价格档 ────────────────────────────────────────────────────────────────────

/**
 * 存档位不存具体数字 —— NZ 很多房子 price by negotiation,真实要价直到成交
 * 都不公开,存一个编出来的数字比存档位更糟(见 migration 注释)。
 */
export const PRICE_BANDS = [
  'under_1m',
  '1m_1_5m',
  '1_5m_2m',
  '2m_3m',
  '3m_plus',
  'undisclosed',
] as const
export type PriceBand = (typeof PRICE_BANDS)[number]

export function isPriceBand(v: unknown): v is PriceBand {
  return typeof v === 'string' && (PRICE_BANDS as readonly string[]).includes(v)
}

export const PRICE_BAND_LABEL: Record<PriceBand, string> = {
  under_1m:    '100 万以下',
  '1m_1_5m':   '100–150 万',
  '1_5m_2m':   '150–200 万',
  '2m_3m':     '200–300 万',
  '3m_plus':   '300 万以上',
  undisclosed: '未公开价格',
}

// ── 状态 ──────────────────────────────────────────────────────────────────────

export const LISTING_STATUSES = [
  'prospect',
  'live',
  'under_offer',
  'sold',
  'withdrawn',
] as const
export type ListingStatus = (typeof LISTING_STATUSES)[number]

export function isListingStatus(v: unknown): v is ListingStatus {
  return typeof v === 'string' && (LISTING_STATUSES as readonly string[]).includes(v)
}

/** 数据库默认值,新建表单的初始选中项。 */
export const DEFAULT_LISTING_STATUS: ListingStatus = 'prospect'

export interface ListingStatusMeta {
  label: string
  /** 一句话说清这一档是什么意思,运营不用猜。 */
  hint: string
  /** UI 上色:在卖的暖、成交的正向、撤下的中性偏冷。 */
  tone: 'prospect' | 'live' | 'offer' | 'sold' | 'withdrawn'
}

export const LISTING_STATUS_META: Record<ListingStatus, ListingStatusMeta> = {
  prospect: {
    label: '还在谈',
    hint:  '还没拿到委托、没上市',
    tone:  'prospect',
  },
  live: {
    label: '在卖',
    hint:  '已经上市,正在推广',
    tone:  'live',
  },
  under_offer: {
    label: '有出价',
    hint:  '有条件出价中,还没最终成交',
    tone:  'offer',
  },
  sold: {
    label: '已成交',
    hint:  '卖掉了',
    tone:  'sold',
  },
  withdrawn: {
    // 这一档不能删也不能藏 —— 只看「已成交」会把「投了钱但没卖掉」的房子
    // 从分母里抹掉,学出来的结论会全线偏乐观(见 migration 注释)。
    label: '已撤下',
    hint:  '没卖掉 / 换中介撤下来了',
    tone:  'withdrawn',
  },
}

// ── 兜底取 label ──────────────────────────────────────────────────────────────
//
// 一律走这三个函数,不要直接 LABEL[value] 下标 —— 数据库先加了新值而前端还没
// 跟上时,下标拿到 undefined 会在页面上渲染成空白(或直接抛)。这里退回显示原始
// slug:难看,但看得见、不炸,而且一眼就知道该来补哪个枚举。

export function propertyTypeLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isPropertyType(v) ? PROPERTY_TYPE_LABEL[v] : v
}

export function priceBandLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isPriceBand(v) ? PRICE_BAND_LABEL[v] : v
}

export function listingStatusLabel(v: string | null | undefined): string {
  if (!v) return '—'
  return isListingStatus(v) ? LISTING_STATUS_META[v].label : v
}

export function listingStatusMeta(v: string | null | undefined): ListingStatusMeta {
  if (isListingStatus(v)) return LISTING_STATUS_META[v]
  return { label: v || '—', hint: '这个状态系统还不认识,请更新配置。', tone: 'withdrawn' }
}

/** 下拉选项(value + 中文 label),前端直接 map 成 <option>。 */
export const PROPERTY_TYPE_OPTIONS = PROPERTY_TYPES.map(v => ({
  value: v,
  label: PROPERTY_TYPE_LABEL[v],
}))

export const PRICE_BAND_OPTIONS = PRICE_BANDS.map(v => ({
  value: v,
  label: PRICE_BAND_LABEL[v],
}))

export const LISTING_STATUS_OPTIONS = LISTING_STATUSES.map(v => ({
  value: v,
  label: LISTING_STATUS_META[v].label,
  hint:  LISTING_STATUS_META[v].hint,
}))
