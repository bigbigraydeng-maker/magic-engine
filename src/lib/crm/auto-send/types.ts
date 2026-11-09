/**
 * 「自动发信」只读页面的数据形状（view model）。
 *
 * 这是页面自己要的形状，不是数据库的形状：页面只认这里的类型，数据从哪来由「读数据适配器」
 * （见 ./adapter.ts）去接。接口没来之前适配器是「还没接通」，员工点「看示例」才用合成数据
 * （./demo-data.ts）；接口来了只换适配器，页面不用改。
 *
 * 平台通用：这里没有任何客户、行业、团名的字样。「这类信叫什么、按什么节奏发」这些话
 * 全部由数据带进来（LetterSection.title / note、LetterSummary.audienceLabel），页面代码里不写死。
 */

/** 一封信现在走到哪一步。 */
export type LetterStatus =
  | 'not_enabled' //       还没开通：这类信的自动发送还没打开
  | 'planned' //           计划中：排期有了，信还没写
  | 'draft' //             草稿：稿子已经在 ME 里，但还没提交给 PM 放行
  | 'awaiting_release' //  等你放行：已经提交，等 PM 点头
  | 'sent' //              已发出

/** 一位收件人这封信的结果。`rehearsal` = 演练：系统彩排了一遍，没有真的发，永远不算「已发」。 */
export type RecipientStatus = 'sent' | 'blocked' | 'failed' | 'rehearsal' | 'pending'

/** 列表里的一行：一封信（某个发信日 × 某组客人 × 某个阶段的那一版）。 */
export interface LetterSummary {
  letterId: string
  /** 日历日期 YYYY-MM-DD（客户自己的时区）。null = 没有固定发信日（事情发生才发）。 */
  sendDate: string | null
  /** 没有固定发信日时「发信日」那一列显示的话，例如「报名确认后」；可以不给。 */
  whenLabel?: string | null
  /** 「对象」那一列，例如「甲组 · 第 3 封」，由数据那边算好。 */
  audienceLabel: string
  /** 标题；还没写 → null。 */
  title: string | null
  status: LetterStatus
  recipientCount: number
  /** 真发出去的人数（不含演练）；还没发 → null。 */
  sentCount: number | null
  blockedCount: number | null
  failedCount: number | null
  /** 演练行条数（彩排，没有真的发）。 */
  rehearsalCount: number
}

/** 列表里的一个面板（一类信）。标题、说明、脚注都由数据带进来。 */
export interface LetterSection {
  key: string
  /** trigger = 事情发生才发（没有固定发信日）；scheduled = 按日期排期发。 */
  kind: 'trigger' | 'scheduled'
  title: string
  /** 标题后面括号里的话，例如发信节奏；没有就 null。 */
  note: string | null
  /** 面板底部的一行小字；没有就 null。 */
  footnote: string | null
  letters: LetterSummary[]
}

/** 「下一批」卡片。 */
export interface NextBatch {
  sendDate: string
  letterCount: number
  recipientCount: number
  status: LetterStatus
}

export interface AutoSendOverview {
  nextBatch: NextBatch | null
  sections: LetterSection[]
}

/** 信的正文，已经切成块；页面不解析任何标记语言。 */
export interface BodyBlock {
  kind: 'heading' | 'paragraph' | 'bullet'
  text: string
}

export interface LetterContent {
  title: string | null
  /** 预览行：标题下面那行灰色小字。 */
  previewText: string | null
  body: BodyBlock[]
  /** 正文里的名字已经换成了这个示例名字（读接口给的）；页面提示「每位客人收到的是自己的名字」。没有就不提示。 */
  sampleFirstName?: string | null
}

/** 「打开」这一列怎么显示：走 Mailchimp 的信有每位客人的记录，ME 自己发的信只有总数。 */
export type OpenInfo =
  | { kind: 'per_recipient'; openedPeople: number; clickedPeople: number }
  | { kind: 'totals_only'; opens: number; clicks: number }
  | { kind: 'none' }

export interface RecipientRow {
  contactId: string
  /** 只显示姓名，不显示邮箱。 */
  displayName: string | null
  /** 座位数来自订单；订单没填 → null，页面显示「—」。 */
  seats: number | null
  status: RecipientStatus
  /** 已经翻成大白话的原因（读接口给的）；有它就直接显示，不再看 reasonCode。 */
  reasonText?: string | null
  /** 对应「最近发送」REASON_LABELS 的 key；页面把它翻成大白话。 */
  reasonCode: string | null
  /** 补充说明（已经是大白话）；没有就 null。 */
  reasonDetail: string | null
  /** 仅 per_recipient 的信有。 */
  engagement: 'opened' | 'clicked' | null
}

export interface LetterDetail {
  summary: LetterSummary
  /** 信的内容还没登记 → null。 */
  content: LetterContent | null
  recipients: RecipientRow[]
  openInfo: OpenInfo
}
