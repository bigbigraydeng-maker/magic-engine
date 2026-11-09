/**
 * 「自动发信」读接口 + 批次计划的共享类型。只放类型，不放任何逻辑。
 *
 * 契约来源：发信设计窗口的「读数据接口约定 v0」§1 / §2 / §8
 * （docs/specs/2026-11-10-me-auto-letters-read-contract-v0.md，在它的工作区）。
 * 两边——页面和读接口（138 号窗口）、发信引擎（发信设计窗口）——都对着这个文件写；
 * 改动先提交、请发信设计窗口审。
 *
 * 约定：
 *  - 日期都是新西兰日历日 `YYYY-MM-DD`（不带时区）。
 *  - 不返回任何邮箱；只给姓名。
 *  - 和契约的差别（都是只加不改，PR 里请发信设计窗口确认）：
 *    1) `RecipientStatus` 多一个 `'rehearsal'`：演练（彩排）没有真发，页面标「演练」，永远不算「已发」；
 *    2) `LetterCounts` / `LetterTiles` 多一个 `rehearsal` 计数（没有演练行就是 0）；
 *    3) `RecipientRow.displayName` 可以是 `null`（联系人没有名字）：页面自己写「（没有名字）」，服务器不编；
 *    4) `LetterAudience.monthsLeft` 为 `null` 表示「每周信」（最后一个月每周三那种）。
 */

/** 新西兰日历日，`YYYY-MM-DD`。 */
export type NzDate = string

// ─── 批次计划（planCountdownIssue）────────────────────────────────────────────

/**
 * 批次计划的输入事实：一张「有效 + 已付定金」订单对应一行
 * （收件人口径与 src/lib/crm/sales-progress/deposited-seats.ts 一致）。
 * 同一个人同一个团可以有多张订单，计划函数会合并。
 */
export interface BookingFact {
  contactId: string
  displayName: string | null
  /** 同一个团 = 同一个 tourId + 同一个出发日。 */
  tourId: string
  tourName: string
  departOn: NzDate
  /** 订单人数；订单没填 → null。 */
  seats: number | null
}

/** 离出发还有几个月（6、5、…、1）；最后一个月每周三一封 → `'weekly'`。 */
export type MonthsLeft = number | 'weekly'

export interface PlannedRecipient {
  contactId: string
  displayName: string | null
  /** 这个人在这个团的座位合计；任何一张订单没填人数 → null（宁可显示「—」也不猜）。 */
  seats: number | null
}

/** 某一天、某一个团的一封信（同团的人收同一封）。 */
export interface PlannedLetter {
  /** 不透明、稳定的信编号（同一封信前后不变）；读接口和发信引擎都用它。 */
  letterKey: string
  sendDate: NzDate
  tourId: string
  tourName: string
  departOn: NzDate
  monthsLeft: MonthsLeft
  recipients: PlannedRecipient[]
}

// ─── 接口 A：列表 GET /api/clients/[id]/crm/auto-letters ──────────────────────

/** 草稿 / 等你放行 / 已发（对应设计稿的状态图例）。 */
export type LetterStatus = 'draft' | 'awaiting_release' | 'sent'

export type LetterChannel = 'me' | 'mailchimp'

export interface LetterAudience {
  tourName: string
  departOn: NzDate
  /** `null` = 每周信。 */
  monthsLeft: number | null
}

export interface LetterCounts {
  recipients: number
  /** 没发之前 sent / blocked / failed 都是 null（页面显示「—」）。 */
  sent: number | null
  blocked: number | null
  failed: number | null
  /** 演练行条数（没有真发），没有就是 0。 */
  rehearsal: number
}

export interface LetterRow {
  /** 不透明；详情接口用。页面不要解析它。 */
  letterKey: string
  sendDate: NzDate
  audience: LetterAudience
  /** `null` = 信还没写。 */
  subject: string | null
  status: LetterStatus
  channel: LetterChannel
  counts: LetterCounts
}

export interface NextBatch {
  sendDate: NzDate
  /** 「周三」。 */
  weekdayLabel: string
  letterCount: number
  /** 去重后的人数。 */
  recipientCount: number
  phase: LetterStatus
}

export interface AutoLettersList {
  /** ISO 时间，服务器时间。 */
  generatedAt: string
  nextBatch: NextBatch | null
  /** 面板「交了定金就自动发的信」。 */
  depositLetters: LetterRow[]
  /** 面板「按期发送的信」：最近两批。 */
  scheduledLetters: LetterRow[]
  /** 「共 N 个不同的信」。 */
  totalDistinctLetters: number
}

// ─── 接口 B：详情 GET /api/clients/[id]/crm/auto-letters/[letterKey] ──────────

export type RecipientStatus = 'pending' | 'sent' | 'blocked' | 'failed' | 'rehearsal'

export interface RecipientRow {
  /** 点姓名 → 打开客人资料页。 */
  contactId: string
  /** 只给姓名，不给邮箱；联系人没有名字 → null。 */
  displayName: string | null
  seats: number | null
  status: RecipientStatus
  /** 人话，服务器翻译好；页面直接显示，不要自己翻原因码。 */
  reasonText: string | null
  /** `null` = 这类信不记录（ME 自己发的信）。 */
  opened: boolean | null
  clicked: boolean | null
}

export interface LetterTiles {
  recipients: number
  sent: number | null
  blocked: number | null
  failed: number | null
  rehearsal: number
}

export interface LetterDetailRow extends LetterRow {
  /** 预览行；没有 → null。 */
  previewText: string | null
  /** 正文，含 `{{first_name}}` 占位符；信还没写 → null。 */
  bodyText: string | null
  /** 页面用它代入 `{{first_name}}` 显示（服务器给，页面不要自己编）。 */
  sampleFirstName: string
}

export interface AutoLetterDetail {
  letter: LetterDetailRow
  tiles: LetterTiles
  /** 只有走 Mailchimp 的信有；ME 自己发的信为 `null`。 */
  mailchimpSummary: { opened: number; clicked: number } | null
  /** 一批最多几十位，不分页。 */
  recipients: RecipientRow[]
}

/** 错误响应（401 / 403 / 404 / 503）：人话。 */
export interface AutoLettersError {
  error: string
}
