/**
 * 把「计划出来的信」和「登记 / 发送事实」拼成读接口的两种返回（列表、详情）。纯函数，不读数据库、不看现在几点
 * （「今天」从参数传进来）。读数据库的部分在 load.ts，它把表里的行整理成这里的输入。
 *
 * 状态怎么推（合同稿 §3）：
 *  - ME 自己发的信：有未授权的提案 → 等你放行；已授权且开始发 → 已发；其余 → 草稿（含「还没写」）。
 *  - 走 Mailchimp 的信：有任何真发出去的记录 → 已发，否则草稿（Mailchimp 的放行在 Mailchimp 里，不显示「等你放行」）。
 *  - 演练（彩排）行永远不算「已发」，单独计数。
 */

import { reasonTextFor } from './reasons'
import { weekdayLabelZh } from './dates'
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
  /** 被拦 / 出错的原因码；没有就 null。 */
  reasonCode: string | null
  /** 只有 Mailchimp 的信记；ME 自己发的信为 null。 */
  opened: boolean | null
  clicked: boolean | null
}

/** 一封信已经有的发送事实。没有任何事实 → 整个对象为 null。 */
export interface SendFacts {
  channel: LetterChannel
  /** 有未授权、未撤回的提案（等 PM 放行）。 */
  proposalPending: boolean
  /** 已授权且已经开始发。 */
  started: boolean
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
  const counts: Record<RecipientStatus, number> = { pending: 0, sent: 0, blocked: 0, failed: 0, rehearsal: 0 }
  for (const r of recipients) counts[r.outcome] += 1
  return counts
}

function countsOf(planned: PlannedLetter, sends: SendFacts | null): LetterCounts {
  if (sends === null || sends.recipients.length === 0) {
    return { recipients: planned.recipients.length, sent: null, blocked: null, failed: null, rehearsal: 0 }
  }
  const c = countOutcomes(sends.recipients)
  return { recipients: planned.recipients.length, sent: c.sent, blocked: c.blocked, failed: c.failed, rehearsal: c.rehearsal }
}

export function deriveLetterStatus(sends: SendFacts | null): LetterStatus {
  if (sends === null) return 'draft'
  if (sends.channel === 'mailchimp') return sends.recipients.some((r) => r.outcome === 'sent') ? 'sent' : 'draft'
  if (sends.proposalPending) return 'awaiting_release'
  if (sends.started) return 'sent'
  return 'draft'
}

export function buildLetterRow(planned: PlannedLetter, facts: LetterFacts | null): LetterRow {
  const sends = facts?.sends ?? null
  return {
    letterKey: planned.letterKey,
    sendDate: planned.sendDate,
    audience: { tourName: planned.tourName, departOn: planned.departOn, monthsLeft: monthsLeftOf(planned) },
    subject: facts?.registry?.subject ?? null,
    status: deriveLetterStatus(sends),
    channel: sends?.channel ?? 'me',
    counts: countsOf(planned, sends),
  }
}

/** 这一批（同一发信日）整体处在哪一步。 */
function batchPhase(rows: readonly LetterRow[]): LetterStatus {
  if (rows.every((r) => r.status === 'sent')) return 'sent'
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

/**
 * 列表：`planned` 是从今天起的整份计划（已按发信日排好）；`factsByKey` 是已有的登记 / 发送事实（按 letterKey）。
 * 「下一批」= 今天（含）起第一个有信的批次日；「按期发送的信」= 最近几批。
 */
export function buildList(
  planned: readonly PlannedLetter[],
  factsByKey: ReadonlyMap<string, LetterFacts>,
  today: NzDate,
  generatedAt: string,
): AutoLettersList {
  const upcoming = planned.filter((letter) => letter.sendDate >= today)
  const batchDays = Array.from(new Set(upcoming.map((letter) => letter.sendDate)))
  const shownDays = new Set(batchDays.slice(0, SCHEDULED_BATCHES_SHOWN))
  const rowFor = (letter: PlannedLetter): LetterRow => buildLetterRow(letter, factsByKey.get(letter.letterKey) ?? null)
  const nextDay = batchDays[0]
  const nextRows = nextDay === undefined ? [] : upcoming.filter((l) => l.sendDate === nextDay).map(rowFor)
  return {
    generatedAt,
    nextBatch: nextBatchOf(nextRows, upcoming),
    depositLetters: [],
    scheduledLetters: upcoming.filter((letter) => shownDays.has(letter.sendDate)).map(rowFor),
    totalDistinctLetters: upcoming.length,
  }
}

function tilesOf(counts: LetterCounts): LetterTiles {
  return { recipients: counts.recipients, sent: counts.sent, blocked: counts.blocked, failed: counts.failed, rehearsal: counts.rehearsal }
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
): RecipientRow {
  const status = outcome?.outcome ?? 'pending'
  const failed = status === 'blocked' || status === 'failed'
  return {
    contactId: person.contactId,
    displayName: person.displayName,
    seats: person.seats,
    status,
    reasonText: failed ? reasonTextFor(outcome?.reasonCode) : null,
    opened: outcome?.opened ?? null,
    clicked: outcome?.clicked ?? null,
  }
}

/** 收件人：计划里的每一位 + 发送记录里有、计划里已经没有的人（订单后来变了）。 */
function recipientRows(planned: PlannedLetter, sends: SendFacts | null): RecipientRow[] {
  const outcomes = new Map((sends?.recipients ?? []).map((r) => [r.contactId, r] as const))
  const rows = planned.recipients.map((p) => recipientRowFor(outcomes.get(p.contactId), p))
  const known = new Set(planned.recipients.map((p) => p.contactId))
  for (const outcome of outcomes.values()) {
    if (!known.has(outcome.contactId)) {
      rows.push(recipientRowFor(outcome, { contactId: outcome.contactId, displayName: null, seats: null }))
    }
  }
  return rows.sort((a, b) => compareNames(a.displayName, b.displayName) || a.contactId.localeCompare(b.contactId))
}

function mailchimpSummaryOf(sends: SendFacts | null): AutoLetterDetail['mailchimpSummary'] {
  if (sends === null || sends.channel !== 'mailchimp') return null
  const real = sends.recipients.filter((r) => r.outcome === 'sent')
  return { opened: real.filter((r) => r.opened === true).length, clicked: real.filter((r) => r.clicked === true).length }
}

export function buildDetail(planned: PlannedLetter, facts: LetterFacts | null): AutoLetterDetail {
  const row = buildLetterRow(planned, facts)
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
    recipients: recipientRows(planned, facts?.sends ?? null),
  }
}
