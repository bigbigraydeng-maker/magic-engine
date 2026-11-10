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
 *    5) 列表多三块（PM 11-10 要「按团看发没发、被拦几位、打没打开」）：`cadence`（脚注用的节奏）、
 *       `pastLetters`（已过发信日、发送记录或提案里有痕迹的信，发完的批次不再隔天消失）、
 *       `tourGroups`（按团汇总，见 `TourGroupRow`）；
 *    6) `LetterCounts` / `LetterTiles` 多一个可空的 `opened`（打开过的人数；这类信不记录就是 `null`），仅供参考；
 *    7) 状态多「没发出去」「结果不明」，`RecipientStatus` 多 `unknown`，`LetterCounts` / `LetterTiles` 多 `unknown`，
 *       `TourGroupRow` 多 `lettersUnknown`（口径见 `LetterStatus` 的注释）。
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

/**
 * 草稿 / 等你放行 / 已发（对应设计稿的状态图例）/ 没发出去 / 结果不明（后两个是 11-10 傍晚加的，口径是发信窗口按发信账本定的）。
 * 只对 ME 自己发的信；Mailchimp 的信仍只有已发 / 草稿。
 *  - `sent`：至少一位客人确认收到（账本状态 sent / delivered / delivery_delayed / complained）。
 *  - `not_sent`：放行了或已经有真实发送行，可是没有一位收到，而且所有行都已经落定
 *    （skipped / suppressed / failed / bounced）；或者放行了却一行都没有、发信日已过。
 *  - `unknown`：没有一位确认收到，但有结果不明的行（unknown_outcome）——信可能已经送到，别重发，不能显示成「没发出去」。
 *  - 还没落定的行（pending 排队中、可重试的 blocked）：这一批还在进行，仍是草稿。
 */
export type LetterStatus = 'draft' | 'awaiting_release' | 'sent' | 'not_sent' | 'unknown'

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
  /** 结果不明的人数（unknown_outcome，信可能已经送到），没有就是 0。 */
  unknown: number
  /**
   * 打开过的人数（只算真发出去的）。这类信不记录打开 → `null`（页面显示「—」）。
   * 仅供参考：苹果邮件等会提前加载图片，数字偏高；不要用它做任何自动决定。
   * 算法：真发出去的收件人里只要有一位 `opened` 不是 `null` 才给数（`opened === true` 的人数），否则 `null`。
   */
  opened: number | null
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

/**
 * 按团汇总的一行：一个团 × 一个出发日（和计划函数里「同一个团」一致）。出发日已过的团不列。
 * 「已发几封」只数真发出去的（演练不算）；「往后几封」按现在的订单和节奏算；前面错过的批次不补，也不算进去。
 */
export interface TourGroupRow {
  /** 不透明、稳定（同一个团前后不变）；页面只当 key 用，不要解析。 */
  groupKey: string
  tourName: string
  departOn: NzDate
  /** 这个团现在的收件人数（订单有效 + 定金已付，同一个人合并）。 */
  recipients: number
  /** 已发出去的信的封数（至少一位真发出去；演练不算）。 */
  lettersSent: number
  /** 往后还会发的信的封数（发信日 ≥ 今天、还没发出、也不是「没发出去」）。 */
  lettersAhead: number
  /**
   * 要人去看的「没发出去」的封数：状态是「没发出去」且有出错 / 被退回、或放行了却一行记录都没有（全是规则内跳过的不算），
   * 加上过了发信日、系统里有痕迹（提案或发送记录）却还是草稿 / 等你放行的（不含结果不明的）。
   */
  lettersOverdue: number
  /** 结果不明的信的封数（状态是「结果不明」：信可能已经送到，别重发）。 */
  lettersUnknown: number
  /** 最近一封已经发出去的信；还没发过 → `null`。 */
  lastSent: {
    letterKey: string
    sendDate: NzDate
    recipients: number
    sent: number
    blocked: number
    failed: number
    /** 结果不明的人数（信可能已经送到）；没有就 0。 */
    unknown: number
    /** 仅供参考；这类信不记录打开 → `null`。 */
    opened: number | null
  } | null
  /** 下一封（发信日 ≥ 今天且还没发出，最近的那封）；没有 → `null`。远期的信没读记录，按草稿算。 */
  next: { letterKey: string; sendDate: NzDate; status: LetterStatus } | null
  /** 这个团在 `pastLetters` ∪ `scheduledLetters` 里有行可看的信的编号，按发信日从早到晚；页面点开这个团时用。 */
  letterKeys: string[]
}

export interface AutoLettersList {
  /** ISO 时间，服务器时间。 */
  generatedAt: string
  nextBatch: NextBatch | null
  /** 面板「交了定金就自动发的信」。 */
  depositLetters: LetterRow[]
  /** 面板「按期发送的信」：从今天起的最近两批。 */
  scheduledLetters: LetterRow[]
  /**
   * 已经过了发信日、并且发送记录或提案（等你放行的或已放行的）里有痕迹的信（新的在前）。没有痕迹的历史批次不列
   * （系统上线前的批次日全是「该发没发」的噪音）。最多列最近 4 个批次日；没有就 `[]`。
   */
  pastLetters: LetterRow[]
  /** 按团汇总：每个（团 × 出发日）一行，按出发日从近到远；没有订单 → `[]`。 */
  tourGroups: TourGroupRow[]
  /** 「共 N 个不同的信」（从今天起往后的）。 */
  totalDistinctLetters: number
  /**
   * 页面脚注要写的那个数（「订的时候离出发超过 N 个月」的 N），取自这个客户用的节奏；
   * 没配节奏 → `null`（页面不写这句脚注）。
   */
  cadence: { firstMonth: number } | null
  /**
   * 给员工看的提醒（中文人话），例如「有 N 张已交定金的订单没有出发日，没排进任何一封信」。
   * 契约之外只加不改的字段；没有提醒就是空数组或不带这个字段。
   */
  notices?: string[]
}

// ─── 接口 B：详情 GET /api/clients/[id]/crm/auto-letters/[letterKey] ──────────

/** `unknown`：发出了但没拿到最终结果（unknown_outcome），信可能已经送到。 */
export type RecipientStatus = 'pending' | 'sent' | 'blocked' | 'failed' | 'rehearsal' | 'unknown'

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
  /** 同 `LetterCounts.unknown`。 */
  unknown: number
  /** 同 `LetterCounts.opened`。 */
  opened: number | null
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
