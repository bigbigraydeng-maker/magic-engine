/**
 * 日历到期事项每日核对（第一步：只读）的共用类型。
 * 设计稿：docs/specs/2026-10-08-calendar-closure-audit-as-code.md
 *
 * 日历描述是外部可写数据——这里的所有解析结果都是「候选」，进入核对前必须过白名单。
 */

export const CALENDAR_CLOSURE_JOB = 'calendar-closure-audit'
export const CALENDAR_CLOSURE_DUE_EVENT = 'calendar_closure/audit.due'
export const PM_CALENDAR_ID = 'hello@magicengine.cloud'
export const CALENDAR_TIMEZONE = 'Pacific/Auckland'
/** 只看开始日在 [今天-14天, 今天]（新西兰日期）内的事件 */
export const WINDOW_DAYS = 14
/** 超过 WINDOW_DAYS 的旧事项不再逐条核对，但最多回看这么多天，只数个数，不许悄悄消失 */
export const STALE_LOOKBACK_DAYS = 60
/** 每次最多核对多少条，其余顺延 */
export const MAX_EVENTS_PER_RUN = 30

/** 台账卡 id：日期前缀 + 小写字母数字连字符。不合格一律当作没有 ledger-id。 */
export const LEDGER_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,80}$/

export interface CalendarEvent {
  id: string
  title: string
  description: string
  /** 开始日，新西兰日期 YYYY-MM-DD */
  startNz: string
  htmlLink: string
  /** Google 返回的 etag / updated，试跑时用来证明不是缓存 */
  etag: string | null
  updated: string | null
}

export type ProbeName = 'cron_run_ok' | 'todo_item_present' | 'ledger_card_status'
export const PROBE_NAMES: readonly ProbeName[] = ['cron_run_ok', 'todo_item_present', 'ledger_card_status']

export interface ParsedProbe {
  name: ProbeName
  /** 已通过格式校验的 key=value；值只允许字母数字 _ - . : */
  params: Record<string, string>
}

export interface ParsedDescription {
  /** 通过 LEDGER_ID_PATTERN 的唯一 ledger-id；缺失、不合格或出现多个时为 null */
  ledgerId: string | null
  /** 通过白名单的唯一 probe 行；缺失、不合格或出现多个时为 null */
  probe: ParsedProbe | null
  /** 描述里出现多个 ledger-id 或多个 probe 行 */
  ambiguous: boolean
  /** 人话原因，给回执和待办用 */
  reason: string | null
}

/**
 * passed_needs_human_confirm：核对通过，但第一步从不叫 verified（设计稿 §10-7）
 * failed：取数成功，结果不符合预期
 * not_yet：取数成功，但数据还没产生/时间没到
 * unreadable：取数出错或没执行——永远不是通过
 */
export type ProbeOutcome = 'passed_needs_human_confirm' | 'failed' | 'not_yet' | 'unreadable'

export interface ProbeResult {
  outcome: ProbeOutcome
  fact: string
  /** ISO 时间，这次取数发生的真实时刻 */
  fetchedAt: string
  /** 样本量（行数/条数）；不适用时 null */
  sample: number | null
}

/**
 * closed：卡已 verified（或事件标题已打 ✅/❌/作废），不出待办
 * covered：台账栏当天实际会在 PM 五类车道出同一张卡的待办，不重复
 * auto：有合格 probe，机器核对
 * human：有 ledger-id 且卡存在，但没有可用 probe，要人核
 * no_ledger：没有/不合格/歧义的 ledger-id，或卡不存在
 */
export type EventTier = 'closed' | 'covered' | 'auto' | 'human' | 'no_ledger'

export interface EventDecision {
  eventId: string
  title: string
  htmlLink: string
  dueNz: string
  /** 今天（新西兰）减 dueNz 的整天数，≥ 0 */
  overdueDays: number
  tier: EventTier
  ledgerId: string | null
  probe: ParsedProbe | null
  /** closed/covered/no_ledger 的人话原因 */
  reason: string | null
}

export type EventResultKind =
  | 'closed'
  | 'covered'
  | 'probe_passed'
  | 'probe_failed'
  | 'not_yet'
  | 'probe_unreadable'
  | 'needs_human'
  | 'no_ledger'

export interface EventResult extends EventDecision {
  kind: EventResultKind
  /** 一句话事实（带数字/样本量）；没有则 null */
  fact: string | null
  fetchedAt: string | null
  sample: number | null
}

export interface ClassifyOutput {
  decisions: EventDecision[]
  /** 超过 MAX_EVENTS_PER_RUN 被顺延的条数 */
  deferred: number
  /** 窗口内、到期（≤今天）的事件总数（含已 closed） */
  candidates: number
  /** 超过 WINDOW_DAYS 天（至 STALE_LOOKBACK_DAYS 天）仍没闭环的旧事项个数，只计数 */
  staleOpen: number
}

/** 写进 cron_run_logs.summary 的回执 */
export interface AuditReceipt {
  job: typeof CALENDAR_CLOSURE_JOB
  request_id: string
  status: 'ok' | 'calendar_unreadable' | 'ledger_unreadable'
  dry_run: boolean
  /** 本次 live 读日历还是用夹具（夹具永远不算通过） */
  source: 'live' | 'fixture'
  today_nz: string
  /** 演练时用了 today_override（仅 dry_run 允许）；响应永远 not_evidence */
  today_overridden: boolean
  not_evidence: boolean
  calendar_id: string
  candidates: number
  processed: number
  deferred: number
  /** 超过 14 天仍没闭环的旧事项个数（只计数，不逐条核对） */
  stale_open: number
  results: EventResult[]
  /** 读日历/读台账失败的原因（status 不是 ok 时必填） */
  error: string | null
  /** 读到的事件里最新的 etag/updated，用于证明不是缓存 */
  read_proof: { etag: string | null; updated: string | null } | null
  no_publish: true
  writes_enabled: false
  created_at: string
}
