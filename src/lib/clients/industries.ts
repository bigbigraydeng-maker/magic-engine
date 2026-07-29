/**
 * 客户行业受控词表 —— clients.industry 的写入侧唯一来源。
 *
 * 为什么要受控：`global_learned_lessons.industry` 用规范值（如 `real_estate`）
 * 标记「哪一行的经验」，取数时按值精确匹配（见 lib/memory/service.ts
 * > loadGlobalLessons）。历史上 clients.industry 是自由文本，出现过
 * `SPC/hybrid flooring wholesale (B2B trade)` 这类值 —— 永远匹配不上任何
 * 行业经验，等于这个客户白白读不到同行踩过的坑。
 *
 * 取数侧仍对旧的自由文本做大小写/空格归一（兼容存量），但**新写入一律走本词表**。
 */

export interface IndustryOption {
  /** 存进 clients.industry 的规范值，与 global_learned_lessons.industry 同一套写法 */
  value: string
  /** 后台下拉里给 FDE 看的中文标签 */
  label: string
}

export const INDUSTRY_OPTIONS: IndustryOption[] = [
  { value: 'real_estate',           label: '地产 · 楼盘 / 中介' },
  { value: 'construction',          label: '建筑 · 装修 / 建材施工' },
  { value: 'building_supplies',     label: '建材 · 地板 / 供应商' },
  { value: 'travel',                label: '旅游 · 旅行社 / 目的地' },
  { value: 'hospitality',           label: '餐饮 · 酒店 / 民宿' },
  { value: 'healthcare',            label: '医疗 · 诊所 / 理疗' },
  { value: 'education',             label: '教育 · 培训 / 学校' },
  { value: 'immigration',           label: '移民 · 留学中介' },
  { value: 'retail',                label: '零售 · 电商' },
  { value: 'professional_services', label: '专业服务 · 法律 / 财税 / 咨询' },
  { value: 'automotive',            label: '汽车 · 销售 / 维修' },
  { value: 'beauty',                label: '美业 · 美发 / 医美' },
  { value: 'other',                 label: '其他' },
]

const BY_VALUE = new Map(INDUSTRY_OPTIONS.map((o) => [o.value, o]))

/** 是否为词表内的规范值 */
export function isKnownIndustry(value: string): boolean {
  return BY_VALUE.has(value)
}

/**
 * 渲染用标签。词表外的存量自由文本原样返回 —— 后台要能看见它当前是什么，
 * 才知道该不该改（直接吞掉会让 FDE 以为没填过）。
 */
export function industryLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return BY_VALUE.get(value)?.label ?? value
}
