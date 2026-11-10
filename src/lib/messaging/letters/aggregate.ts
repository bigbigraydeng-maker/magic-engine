/**
 * 把「计划出来的信」和「登记 / 发送事实」拼成读接口的两种返回（列表、详情）。纯函数，不读数据库、不看现在几点
 * （「今天」从参数传进来）。读数据库的部分在 load.ts，它把表里的行整理成这里的输入。
 *
 * 状态怎么推（合同稿 §3；「已发」「没发出去」「结果不明」的口径 11-10 傍晚按发信账本定，发信窗口审过）：
 *  - ME 自己发的信：有未授权的提案 → 等你放行；至少一位真的收到了（账本状态 sent / delivered / delivery_delayed / complained）→ 已发；
 *    没有一位收到、但有结果不明的行（unknown_outcome）→ 结果不明（信可能已经送到，别重发，不能说成没发出去）；
 *    放行了或已经有真实发送行、没有一位收到、而且每一行都已落定（跳过 / 屏蔽 / 失败 / 退回）→ 没发出去；
 *    放行了却一行发送记录都没有、发信日已过 → 没发出去；
 *    其余（没放行的草稿、只有演练、还有排队中 / 可重试的行）→ 草稿（含「还没写」）。出错 / 被拦的数字照常显示。
 *  - 走 Mailchimp 的信：同样是至少一位真的收到了 → 已发，否则草稿（Mailchimp 的放行在 Mailchimp 里，不显示「等你放行」）。
 *  - 演练（彩排）行永远不算「已发」，单独计数。
 */

import { reasonTextFor } from './reasons'
import { weekdayLabelZh } from './dates'
import { needsAttention } from './attention'
import { buildTourGroups } from './groups'
import { pastLetterEntries, type LetterEntry } from './history'
import type {
  AutoLetterDetail,
  AutoLettersList,
  LetterChannel,
  LetterCounts,
  LetterDetailRow,
  LetterRow,
  LetterStatus,
  LetterTiles,
  NextBatch,
  NzDate,
  PlannedLetter,
  RecipientRow,
  RecipientStatus,
} from './types'

/** 页面代入 `{{first_name}}` 用的示例名字（服务器给，页面不要自己编）。 */
export const SAMPLE_FIRST_NAME = 'Alex'

/** 这一批已经发出去，但这个人当时不在名单里（引擎不补发）：不显示成「待发」，只说事实。 */
export const NOT_IN_BATCH_TEXT = '这一批发出时他不在名单里（不补发）'

/** 列表里「按期发送的信」只列最近几批。 */
export const SCHEDULED_BATCHES_SHOWN = 2

/** 已登记的信（来自 crm_email_templates）；没登记 → 整个对象为 null。 */
export interface RegistryEntry {
  subject: string | null
  previewText: string | null
  bodyText: string | null
}

/** 一位收件人这封信的结果（发送引擎 / Mailchimp 记录整理后的样子）。 */
export interface RecipientOutcome {
  contactId: string
  outcome: RecipientStatus
  /** 被拦 / 出错 / 结果不明的原因码；没有就 null。 */
  reasonCode: string | null
  /**
   * 这个结果是不是已经落定（不会再变）：收到了、规则内跳过、被屏蔽、发送失败、被退回都是；
   * 排队中、可重试的拦截（blocked）、结果不明都不是。演练行不参与判断。
   */
  settled: boolean
  /** 只有 Mailchimp 的信记；ME 自己发的信为 null。 */
  opened: boolean | null
  clicked: boolean | null
}

/** 一封信已经有的发送事实。没有任何事实 → 整个对象为 null。 */
export interface SendFacts {
  channel: LetterChannel
  /** 有未授权、未撤回的提案（等 PM 放行）。 */
  proposalPending: boolean
  /**
   * 有已授权、未撤回的提案（PM 已放行）。哪怕一行发送记录都没有也算「有痕迹」：
   * 放行了、过了发信日却一封都没发出去，正是要如实显示的「没发出去」（发信窗口 11-10 定）。
   * 撤回的提案不算痕迹——状态里没有「撤下了、没发」这一种可显示。
   */
  proposalApproved: boolean
  recipients: RecipientOutcome[]
}

export interface LetterFacts {
  registry: RegistryEntry | null
  sends: SendFacts | null
}

export function monthsLeftOf(letter: PlannedLetter): number | null {
  return letter.monthsLeft === 'weekly' ? null : letter.monthsLeft
}

function countOutcomes(recipients: readonly RecipientOutcome[]): Record<RecipientStatus, number> {
  const counts: Record<RecipientStatus, number> = { pending: 0, sent: 0, blocked: 0, failed: 0, rehearsal: 0, unknown: 0 }
  for (const r of recipients) counts[r.outcome] += 1
  return counts
}

/**
 * 打开过的人数：只看真发出去的收件人；这类信不记录打开（没有一位的 opened 不是 null）→ null，页面显示「—」。
 * 仅供参考：苹果邮件等会提前加载图片，数字偏高。
 */
function openedCountOf(sends: SendFacts): number | null {
  const real = sends.recipients.filter((r) => r.outcome === 'sent')
  if (!real.some((r) => r.opened !== null)) return null
  return real.filter((r) => r.opened === true).length
}

/**
 * 收件人数 = 计划里的人 + 发送记录里有、计划里已经没有的人（订单后来变了）——和详情里名单的行数一致，
 * 这样「已发 + 被拦 + 出错 + 演练」永远不会比收件人总数还多。
 */
function recipientTotal(planned: PlannedLetter, sends: SendFacts | null): number {
  if (sends === null) return planned.recipients.length
  const known = new Set(planned.recipients.map((p) => p.contactId))
  const ledgerOnly = new Set(sends.recipients.map((r) => r.contactId).filter((id) => !known.has(id)))
  return planned.recipients.length + ledgerOnly.size
}

function countsOf(planned: PlannedLetter, sends: SendFacts | null): LetterCounts {
  if (sends === null || sends.recipients.length === 0) {
    return { recipients: planned.recipients.length, sent: null, blocked: null, failed: null, rehearsal: 0, unknown: 0, opened: null }
  }
  const c = countOutcomes(sends.recipients)
  return {
    recipients: recipientTotal(planned, sends),
    sent: c.sent,
    blocked: c.blocked,
    failed: c.failed,
    rehearsal: c.rehearsal,
    unknown: c.unknown,
    opened: openedCountOf(sends),
  }
}

/** 判「没发出去」要用的时间：这封信的发信日和今天（没给就不判「发信日已过」那一条）。 */
export interface StatusClock {
  sendDate: NzDate
  today: NzDate
}

/**
 * 没有一位客人确认收到、也没有结果不明的行：
 *  - 有真实发送行（不含演练）：每一行都已经落定（规则内跳过 / 被屏蔽 / 发送失败 / 被退回）→ 没发出去；
 *    还有没落定的（排队中、可重试的拦截）→ 这一批还在进行，不是没发出去，发信日过了也一样；
 *  - 一行真实发送行都没有：放行了、发信日已过 → 没发出去（引擎没动）；没放行（草稿、只有演练）→ 不算。
 */
function nobodyGotIt(sends: SendFacts, clock: StatusClock | undefined): boolean {
  const real = sends.recipients.filter((r) => r.outcome !== 'rehearsal')
  if (real.length === 0) return sends.proposalApproved && clock !== undefined && clock.sendDate < clock.today
  return real.every((r) => r.settled)
}

export function deriveLetterStatus(sends: SendFacts | null, clock?: StatusClock): LetterStatus {
  if (sends === null) return 'draft'
  if (sends.channel === 'me' && sends.proposalPending) return 'awaiting_release'
  if (sends.recipients.some((r) => r.outcome === 'sent')) return 'sent'
  if (sends.channel === 'me') {
    if (sends.recipients.some((r) => r.outcome === 'unknown')) return 'unknown'
    if (nobodyGotIt(sends, clock)) return 'not_sent'
  }
  return 'draft'
}

export function buildLetterRow(planned: PlannedLetter, facts: LetterFacts | null, today?: NzDate): LetterRow {
  const sends = facts?.sends ?? null
  const clock = today === undefined ? undefined : { sendDate: planned.sendDate, today }
  return {
    letterKey: planned.letterKey,
    sendDate: planned.sendDate,
    audience: { tourName: planned.tourName, departOn: planned.departOn, monthsLeft: monthsLeftOf(planned) },
    subject: facts?.registry?.subject ?? null,
    status: deriveLetterStatus(sends, clock),
    channel: sends?.channel ?? 'me',
    counts: countsOf(planned, sends),
  }
}

/** 这一批（同一发信日）整体处在哪一步；有结果不明的最先提醒（别重发），其次是没发出去的。 */
function batchPhase(rows: readonly LetterRow[]): LetterStatus {
  if (rows.some((r) => r.status === 'unknown')) return 'unknown'
  if (rows.some(needsAttention)) return 'not_sent'
  if (rows.every((r) => r.status === 'sent' || r.status === 'not_sent')) return 'sent'
  if (rows.some((r) => r.status === 'awaiting_release')) return 'awaiting_release'
  return 'draft'
}

function nextBatchOf(rows: readonly LetterRow[], planned: readonly PlannedLetter[]): NextBatch | null {
  const first = rows[0]
  if (!first) return null
  const people = new Set<string>()
  for (const letter of planned) {
    if (letter.sendDate === first.sendDate) letter.recipients.forEach((r) => people.add(r.contactId))
  }
  return {
    sendDate: first.sendDate,
    weekdayLabel: weekdayLabelZh(first.sendDate) ?? '',
    letterCount: rows.length,
    recipientCount: people.size,
    phase: batchPhase(rows),
  }
}

/** buildList 自己算得出的部分；节奏（cadence）和提醒（notices）由 load.ts 补上。 */
export type ListCore = Omit<AutoLettersList, 'cadence' | 'notices'>

/**
 * 列表：`planned` 是回看窗口起的整份计划（已按发信日排好，含已经过去的批次日）；`factsByKey` 是已有的登记 / 发送事实
 * （按 letterKey）。
 *  - 「下一批」= 今天（含）起第一个有信的批次日；「按期发送的信」= 从今天起的最近几批；
 *  - 「已过发信日的信」= 发信日已过、系统里有痕迹的信（最近几个批次日，见 history.ts）；
 *  - 「按团汇总」= 每个还没出发的团一行（见 groups.ts）。
 */
export function buildList(
  planned: readonly PlannedLetter[],
  factsByKey: ReadonlyMap<string, LetterFacts>,
  today: NzDate,
  generatedAt: string,
): ListCore {
  const entries: LetterEntry[] = planned.map((letter) => {
    const facts = factsByKey.get(letter.letterKey) ?? null
    return { letter, row: buildLetterRow(letter, facts, today), traced: facts?.sends != null }
  })
  const upcoming = entries.filter((entry) => entry.letter.sendDate >= today)
  const batchDays = Array.from(new Set(upcoming.map((entry) => entry.letter.sendDate)))
  const shownDays = new Set(batchDays.slice(0, SCHEDULED_BATCHES_SHOWN))
  const scheduled = upcoming.filter((entry) => shownDays.has(entry.letter.sendDate))
  const nextDay = batchDays[0]
  const nextRows = nextDay === undefined ? [] : upcoming.filter((entry) => entry.letter.sendDate === nextDay).map((entry) => entry.row)
  const past = pastLetterEntries(entries, today)
  const displayed = new Set([...scheduled, ...past].map((entry) => entry.row.letterKey))
  return {
    generatedAt,
    nextBatch: nextBatchOf(nextRows, upcoming.map((entry) => entry.letter)),
    depositLetters: [],
    scheduledLetters: scheduled.map((entry) => entry.row),
    pastLetters: past.map((entry) => entry.row),
    tourGroups: buildTourGroups(entries, today, displayed),
    totalDistinctLetters: upcoming.length,
  }
}

function tilesOf(counts: LetterCounts): LetterTiles {
  return {
    recipients: counts.recipients,
    sent: counts.sent,
    blocked: counts.blocked,
    failed: counts.failed,
    rehearsal: counts.rehearsal,
    unknown: counts.unknown,
    opened: counts.opened,
  }
}

function compareNames(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.toLowerCase().localeCompare(b.toLowerCase())
}

function recipientRowFor(
  outcome: RecipientOutcome | undefined,
  person: { contactId: string; displayName: string | null; seats: number | null },
  notInBatch: boolean,
): RecipientRow {
  const status = outcome?.outcome ?? 'pending'
  // 被拦 / 出错 / 结果不明要说原因；收到了、但客人投诉过的也要说一句。
  const explain =
    status === 'blocked' || status === 'failed' || status === 'unknown' || (status === 'sent' && outcome?.reasonCode === 'complained')
  let reasonText: string | null = null
  if (explain) reasonText = reasonTextFor(outcome?.reasonCode)
  else if (outcome === undefined && notInBatch) reasonText = NOT_IN_BATCH_TEXT
  return {
    contactId: person.contactId,
    displayName: person.displayName,
    seats: person.seats,
    status,
    reasonText,
    opened: outcome?.opened ?? null,
    clicked: outcome?.clicked ?? null,
  }
}

/** 收件人：计划里的每一位 + 发送记录里有、计划里已经没有的人（订单后来变了）。 */
function recipientRows(planned: PlannedLetter, sends: SendFacts | null, notInBatch: boolean): RecipientRow[] {
  const outcomes = new Map((sends?.recipients ?? []).map((r) => [r.contactId, r] as const))
  const rows = planned.recipients.map((p) => recipientRowFor(outcomes.get(p.contactId), p, notInBatch))
  const known = new Set(planned.recipients.map((p) => p.contactId))
  for (const outcome of outcomes.values()) {
    if (!known.has(outcome.contactId)) {
      rows.push(recipientRowFor(outcome, { contactId: outcome.contactId, displayName: null, seats: null }, false))
    }
  }
  return rows.sort((a, b) => compareNames(a.displayName, b.displayName) || a.contactId.localeCompare(b.contactId))
}

function mailchimpSummaryOf(sends: SendFacts | null): AutoLetterDetail['mailchimpSummary'] {
  if (sends === null || sends.channel !== 'mailchimp') return null
  const real = sends.recipients.filter((r) => r.outcome === 'sent')
  // 一位的打开记录都没有：打开还没同步进来，不能说成「已打开 0 位」。
  if (!real.some((r) => r.opened !== null)) return null
  return { opened: real.filter((r) => r.opened === true).length, clicked: real.filter((r) => r.clicked === true).length }
}

/**
 * 详情。`today` 给了，并且这封信的发信日早于今天、整批已经发出去，那么计划里有、发送记录里没有的人，
 * 说明引擎发这一批时他们不在名单里（多半是这一批发出之后才交的定金）——显示「这一批发出时他不在名单里（不补发）」，
 * 不显示「待发」（引擎不会补发）。
 */
export function buildDetail(planned: PlannedLetter, facts: LetterFacts | null, today?: NzDate): AutoLetterDetail {
  const row = buildLetterRow(planned, facts, today)
  const batchWentOut = today !== undefined && planned.sendDate < today && row.status === 'sent'
  const letter: LetterDetailRow = {
    ...row,
    previewText: facts?.registry?.previewText ?? null,
    bodyText: facts?.registry?.bodyText ?? null,
    sampleFirstName: SAMPLE_FIRST_NAME,
  }
  return {
    letter,
    tiles: tilesOf(row.counts),
    mailchimpSummary: mailchimpSummaryOf(facts?.sends ?? null),
    recipients: recipientRows(planned, facts?.sends ?? null, batchWentOut),
  }
}
