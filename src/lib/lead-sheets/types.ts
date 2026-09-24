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

/**
 * 「同一个输出目标」的唯一口径 —— 同一张表的同一个 tab。
 *
 * 🔴 **只能有这一份。** `config.ts` 用它判「这两条路线要不要比结构」，`sync.ts` 用它判
 *    「这两条路线要不要共用判重键集合」。两处口径一旦不一致，就会出现 config 认为
 *    「不是同一张表、不用比结构」而 sync 认为「是同一张表、共用键」的组合 ——
 *    拿 A 的尺子量 B 的行，正是 `describeLayoutMismatch` 存在的唯一理由所防的
 *    静默丢线索。而这种不一致**不会有任何测试红**：两边各自的单测都会过。
 */
export function destinationKey(target: { spreadsheetId: string; tabName: string }): string {
  return `${target.spreadsheetId}\u0000${target.tabName}`
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
  /**
   * 机器键所在的列（0 起）。这一列非空时判重只看它，人怎么编辑其它列都不影响。
   * 表里老行没有这一列（是空的）时自动退回 `dedupColumns`。
   */
  dedupIdColumn: number | null
  /**
   * 表头签名：目标表格第一行应该长什么样，逐格比对。null = 不检查。
   *
   * 🔴 防的是「人工排表头排错」。配置说 13 列就写 13 格，没人比对过表头 ——
   *    有人在表中间插一列，之后每一行都错位（电话写进邮箱列、员工的跟进记录被
   *    推走），而回执全绿、日报绿、一条待办都不出。这张表是销售直接看的。
   */
  headerRow: readonly string[] | null
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
  /**
   * 路线的人话名字（配置里的 `label`）。
   *
   * 🔴 给人工待办用的。所有表单汇总进一张表之后，`tabName` 就是个 `Untitled` ——
   *    待办里写「线索写不进『Untitled』」等于没说（铁律 3 下半：要让人不用问第二遍）。
   */
  label: string | null
  spreadsheetId: string
  tabName: string
  /** 分到这条路线的线索数（已过 backfill_since）。 */
  matched: number
  /** 表里已经有了、这次跳过的。 */
  alreadyPresent: number
  /**
   * 拼不出判重身份、这次**没写也没算已存在**的条数。
   *
   * 🔴 单独一个数字，不是塞进 `blankedFields` 了事 —— 那个字段会被去重成一个词，
   *    丢掉条数也丢掉是哪几条。这些是**真的没进销售手里**的线索，必须能被人看见。
   */
  skippedNoIdentity: number
  /** 上面那些线索的 lead id，好直接回查。 */
  skippedLeadIds: string[]
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
  /**
   * 阻断性错误：本轮该客户一行都没写。`pushLeadSheetItems` 把它当「同步失败」下发。
   */
  error: string | null
  /**
   * 非阻断性问题：分流和写表照常成功，只是某个辅助诊断数字这轮不准（例如
   * `countLeadsBefore` 查询失败）。**不能**塞进 `error` —— 那会让新线索明明已经
   * 写进表了，还被 `pushLeadSheetItems` 报成「这轮没能写进 Google 表格」。
   */
  warning: string | null
}
