/**
 * 「线索 → 客户指定的 Google 表格」这条能力的类型定义（平台层，L3）。
 *
 * 这一层**不认识任何客户**：不知道 CTS 有几张表、哪一列放电话、"around_3000"
 * 该翻成什么。那些全是 `client_lead_sheet_routes` 里的数据。
 * 换个客户换个行业，改配置不改代码。
 */

/**
 * 一列能填什么。**这是配置能用的全部词汇** —— 加新词要改代码（有意为之：
 * 配置里写个拼错的字段名应该当场报错，不该静默写出一列空白）。
 */
export const LEAD_SHEET_FIELDS = [
  /** Meta 的 lead id。判重通常就靠它。 */
  'lead_id',
  /** 留资时间。`format: 'iso'` 出 UTC ISO 串；`format: 'local'` 按路线时区出 `YYYY-MM-DD HH:mm`。 */
  'occurred_at',
  'contact_name',
  'contact_email',
  'contact_phone',
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'form_id',
  'form_name',
  /** 'fb' / 'ig'。 */
  'platform',
  /** 自然贴文来的写 'true'/'false'，拿不到写空。 */
  'is_organic',
  /** 表单里某个问题的答案，问题名放 `key`。 */
  'answer',
  /** 固定文本，放 `value`。 */
  'literal',
  /** 留空 —— 人工维护的列（跟进记录之类）必须在这里占位，否则后面的列会错位。 */
  'blank',
] as const

export type LeadSheetField = (typeof LEAD_SHEET_FIELDS)[number]

export interface LeadSheetColumn {
  field: LeadSheetField
  /** `field: 'answer'` 时的问题名（Meta 的字段名，不是给人看的问题文案）。 */
  key?: string
  /** `field: 'literal'` 时的固定文本。 */
  value?: string
  /** 非空值前面加的前缀，例如 `l:` / `ag:` / `p:`。空值不加前缀。 */
  prefix?: string
  /** `occurred_at` 专用。 */
  format?: 'iso' | 'local'
  /** true = 把值丢进 `value_labels` 翻一次。查不到就**原样输出**，不留空、不瞎猜。 */
  mapped?: boolean
}

export interface LeadSheetRoute {
  routeKey: string
  label: string | null
  spreadsheetId: string
  tabName: string
  /** 空数组 = 兜底路线。 */
  matchAnyAnswerFields: readonly string[]
  priority: number
  columns: readonly LeadSheetColumn[]
  valueLabels: Readonly<Record<string, string>>
  dedupColumns: readonly number[]
  timezone: string
  backfillSince: string | null
  enabled: boolean
}

/** 一条线索在这一层长什么样。取数在 `leads.ts`，这里不关心它从哪张表来。 */
export interface LeadRecord {
  leadId: string
  /** ISO（UTC）。 */
  occurredAt: string
  name: string | null
  email: string | null
  phone: string | null
  adId: string | null
  adName: string | null
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  formId: string | null
  formName: string | null
  platform: string | null
  isOrganic: boolean | null
  /** 表单问答，key = Meta 字段名。 */
  answers: Readonly<Record<string, string>>
}

/** 一条路线跑完的机器可读回执。 */
export interface LeadSheetRouteReceipt {
  routeKey: string
  spreadsheetId: string
  tabName: string
  /** 分到这条路线的线索数（已过 backfill_since）。 */
  matched: number
  /** 表里已经有了、这次跳过的。 */
  alreadyPresent: number
  /** 真写进去的行数。 */
  appended: number
  /** 写进去的 lead id —— 出事时能直接回查是哪几条。 */
  appendedLeadIds: string[]
  /** 落在 backfill_since 之前、这次没碰的。数字不为 0 = 还有历史没补。 */
  outsideWindow: number
  /** 配置里没有对应中文的选项值 → 原样写进去了，这里点名，好补配置。 */
  unmappedValues: string[]
  /** 表里有、但没写全的列（例如广告组名字库里查不到）。 */
  blankedFields: string[]
  error: string | null
}

export interface LeadSheetClientReceipt {
  clientId: string
  clientName: string | null
  routes: LeadSheetRouteReceipt[]
  /** 一条路线都没匹配上的线索（配置里没兜底路线时才可能出现）。 */
  unrouted: number
  error: string | null
}
