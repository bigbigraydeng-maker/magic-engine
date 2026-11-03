// 网站询盘表单新增两个问题的答案映射：
// 1. 出行时间窗口（travel window）
// 2. 每人预算区间（budget per person）
// 将自由文本选项标签映射为稳定代码，并可由代码渲染一行人类可读的句子。

export type TravelWindowCode = 'mar_may_2027' | 'jun_sep_2027' | 'oct_dec_2027' | 'not_sure'

export type BudgetBandCode = 'under_3000' | '3000_5000' | '5000_8000' | 'above_8000'

// 统一规范化：小写、将各种破折号（含两侧可选空格）替换为单个 '-'、折叠空白、去首尾空格。
function normalise(text: string | null | undefined): string {
  if (text === null || text === undefined) {
    return ''
  }
  return text
    .toLowerCase()
    .replace(/\s*[\u2013\u2014-]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// 出行时间窗口：仅做精确匹配，绝不做模糊/子串匹配。
export function travelWindowCode(text: string | null | undefined): TravelWindowCode | null {
  const normalised = normalise(text)
  switch (normalised) {
    case 'march-may 2027':
      return 'mar_may_2027'
    case 'june-september 2027':
      return 'jun_sep_2027'
    case 'october-december 2027':
      return 'oct_dec_2027'
    case 'not sure yet':
      return 'not_sure'
    default:
      return null
  }
}

// 预算区间：在规范化基础上额外移除 '$' 与 ',' 字符，再做精确匹配。
export function budgetBandCode(text: string | null | undefined): BudgetBandCode | null {
  const normalised = normalise(text).replace(/[$,\s]/g, '')
  switch (normalised) {
    case 'under3000':
      return 'under_3000'
    case '3000-5000':
      return '3000_5000'
    case '5000-8000':
      return '5000_8000'
    case 'above8000':
      return 'above_8000'
    default:
      return null
  }
}

export interface FormFactCodes {
  travelWindow?: string | null
  budgetBand?: string | null
}

const TRAVEL_WINDOW_TEXT: Record<TravelWindowCode, string> = {
  mar_may_2027: '预计 2027 年 3–5 月出发',
  jun_sep_2027: '预计 2027 年 6–9 月出发',
  oct_dec_2027: '预计 2027 年 10–12 月出发',
  not_sure: '出发时间还没定',
}

const BUDGET_BAND_TEXT: Record<BudgetBandCode, string> = {
  under_3000: '预算 3,000 以下/人',
  '3000_5000': '预算 3,000–5,000/人',
  '5000_8000': '预算 5,000–8,000/人',
  above_8000: '预算 8,000 以上/人',
}

function isTravelWindowCode(code: string): code is TravelWindowCode {
  return Object.prototype.hasOwnProperty.call(TRAVEL_WINDOW_TEXT, code)
}

function isBudgetBandCode(code: string): code is BudgetBandCode {
  return Object.prototype.hasOwnProperty.call(BUDGET_BAND_TEXT, code)
}

// 由代码渲染一行人类可读的句子；未知/缺失代码对应部分直接省略（绝不显示为 0 或占位符）。
export function formFactsLine(codes: FormFactCodes | null | undefined): string | null {
  if (codes === null || codes === undefined) {
    return null
  }

  const parts: string[] = []

  const travelWindow = codes.travelWindow
  if (typeof travelWindow === 'string' && isTravelWindowCode(travelWindow)) {
    parts.push(TRAVEL_WINDOW_TEXT[travelWindow])
  }

  const budgetBand = codes.budgetBand
  if (typeof budgetBand === 'string' && isBudgetBandCode(budgetBand)) {
    parts.push(BUDGET_BAND_TEXT[budgetBand])
  }

  if (parts.length === 0) {
    return null
  }

  return parts.join(' · ')
}

// ── Facebook 客资表单（meta_lead_form）的两个问题 ──
// 答案原样存在触点 `metadata.custom_answers`：键是问题原文转成的 slug，值是选项 slug
// （例：`when_are_you_hoping_to_travel?` → `first_half_next_year`）。官网表单走上面那套
// `form_travel_window / form_budget_band` 稳定代码，两套来源不同，所以单独映射。
// 2026-10-28 PM 发现抽屉里 Facebook 来的客人看不到预算和出发时间 —— 数据一直在库里，只是没人读。

const META_TRAVEL_TEXT: Record<string, string> = {
  next_1_2_months: '预计 1–2 个月内出发',
  around_christmas: '预计圣诞前后出发',
  first_half_next_year: '预计明年上半年出发',
  not_sure_exploring: '出发时间还没定（在了解）',
}

const META_BUDGET_TEXT: Record<string, string> = {
  around_3000: '预算约 NZD 3,000/人',
  '3000_5000': '预算 NZD 3,000–5,000/人',
  '5000_8000': '预算 NZD 5,000–8,000/人',
  budget_not_a_concern: '预算不是问题',
  not_sure_yet: '预算还没定',
}

/** 认不出的新选项不丢：把 slug 还原成可读的原话，宁可显示原话也不让答案消失。 */
function humaniseSlug(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

function metaAnswerLine(
  answers: Record<string, unknown>,
  keyHint: 'travel' | 'budget',
  known: Record<string, string>,
  unknownPrefix: string,
): string | null {
  for (const [key, raw] of Object.entries(answers)) {
    if (!key.toLowerCase().includes(keyHint) || typeof raw !== 'string' || !raw.trim()) continue
    const code = raw.trim().toLowerCase()
    if (Object.prototype.hasOwnProperty.call(known, code)) return known[code]
    return `${unknownPrefix}：${humaniseSlug(raw)}`
  }
  return null
}

/** 从 `metadata.custom_answers` 渲染一行「出发时间 · 预算」人话；两项都没有就返回 null。 */
export function metaFormFactsLine(customAnswers: unknown): string | null {
  if (typeof customAnswers !== 'object' || customAnswers === null || Array.isArray(customAnswers)) {
    return null
  }
  const answers = customAnswers as Record<string, unknown>
  const parts = [
    metaAnswerLine(answers, 'travel', META_TRAVEL_TEXT, '出发时间'),
    metaAnswerLine(answers, 'budget', META_BUDGET_TEXT, '预算'),
  ].filter((p): p is string => p !== null)
  return parts.length === 0 ? null : parts.join(' · ')
}
