import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classifyAiNotice,
  classifyPageReplies,
  normaliseNoticeText,
  type ThreadMessage,
} from './automation'
import { AUTOACK_SENT_BY_EMAIL, isAutoAckBody } from './autoack-identity'

/** One conversation_messages row, as read from the database. */
export interface ReplyMetricRow {
  conversationId: string
  direction: 'inbound' | 'outbound'
  body: string | null
  senderName: string | null
  sentAt: string
}

/**
 * A whole-string email address. Meta-synced Page messages carry the Page's
 * display name, which could contain an '@' (a name like "Tours @ Auckland"),
 * so a bare `includes('@')` is not enough to say "sent through ME".
 */
const EMAIL_SENDER_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Map a stored row to the shape the classifier understands. Outbound rows sent
 * through ME carry the sender's email in `senderName`; Meta-synced Page
 * messages carry the Page name instead, which has no '@'. The auto-ack email is
 * shared with human-approved drafts, so the email alone does not prove a
 * message is the auto-ack — the body must match the template as well.
 */
export function rowToThreadMessage(row: ReplyMetricRow): ThreadMessage {
  const body = row.body ?? ''
  const senderName = row.senderName ?? ''
  const message: ThreadMessage = {
    direction: row.direction,
    body,
    sentAt: row.sentAt,
    tags: [],
  }
  if (row.direction === 'outbound') {
    const viaMeAutoAck =
      senderName === AUTOACK_SENT_BY_EMAIL &&
      isAutoAckBody(body, normaliseNoticeText)
    message.viaMeAutoAck = viaMeAutoAck
    message.sentByHumanViaMe = EMAIL_SENDER_RE.test(senderName) && !viaMeAutoAck
  }
  return message
}

/** Window is [from, to) on the time of the customer's FIRST inbound message. */
export interface ReplyMetricsOptions {
  from: Date
  to: Date
  now: Date
}

export interface ReplyMetrics {
  cohort: number
  pageSpokeFirst: number
  mature: number
  humanReplied: number
  humanRepliedWithin24h: number
  meAutoAck: number
  automatedOnly: number
  noReply: number
  humanRepliedRate: number | null
  humanRepliedWithin24hRate: number | null
  window: { from: string; to: string; now: string }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Earliest parseable inbound time, or null when the customer never wrote. */
function firstInboundTime(messages: readonly ThreadMessage[]): number | null {
  let first: number | null = null
  for (const message of messages) {
    if (message.direction !== 'inbound') continue
    const ms = Date.parse(message.sentAt)
    if (Number.isNaN(ms)) continue
    if (first === null || ms < first) first = ms
  }
  return first
}

/**
 * "Page spoke first" means real Page text before the customer: an outbound
 * message with a non-empty body that is not a Meta system notice. Empty-body
 * card replies and notices (e.g. ad-reply banners) do not count.
 */
function pageSpokeBefore(messages: readonly ThreadMessage[], beforeMs: number): boolean {
  return messages.some((message) => {
    if (message.direction !== 'outbound') return false
    const ms = Date.parse(message.sentAt)
    if (Number.isNaN(ms) || ms >= beforeMs) return false
    if (normaliseNoticeText(message.body).length === 0) return false
    return classifyAiNotice(message.body) === null
  })
}

interface ReplyOutcome {
  human: boolean
  humanWithin24h: boolean
  autoAck: boolean
  automated: boolean
}

/** What happened after the customer's first message, from the reply verdicts. */
function summariseReplies(messages: readonly ThreadMessage[], firstInboundMs: number): ReplyOutcome {
  const outcome: ReplyOutcome = { human: false, humanWithin24h: false, autoAck: false, automated: false }
  let firstHumanMs = Number.POSITIVE_INFINITY
  for (const verdict of classifyPageReplies(messages)) {
    const ms = Date.parse(verdict.sentAt)
    if (Number.isNaN(ms) || ms <= firstInboundMs) continue
    if (verdict.kind === 'human') {
      outcome.human = true
      if (ms < firstHumanMs) firstHumanMs = ms
    } else if (verdict.kind === 'me_autoack') {
      outcome.autoAck = true
    } else if (verdict.kind === 'automated') {
      outcome.automated = true
    }
  }
  outcome.humanWithin24h = outcome.human && firstHumanMs <= firstInboundMs + DAY_MS
  return outcome
}

export function computeReplyMetrics(
  threads: ReadonlyArray<{ conversationId: string; messages: readonly ThreadMessage[] }>,
  opts: ReplyMetricsOptions,
): ReplyMetrics {
  const fromMs = opts.from.getTime()
  const toMs = opts.to.getTime()
  const nowMs = opts.now.getTime()

  let cohort = 0
  let pageSpokeFirst = 0
  let mature = 0
  let humanReplied = 0
  let humanRepliedWithin24h = 0
  let meAutoAck = 0
  let automatedOnly = 0
  let noReply = 0

  for (const thread of threads) {
    const firstInboundMs = firstInboundTime(thread.messages)
    if (firstInboundMs === null) continue
    if (firstInboundMs < fromMs || firstInboundMs >= toMs) continue

    if (pageSpokeBefore(thread.messages, firstInboundMs)) {
      pageSpokeFirst++
      continue
    }

    cohort++
    if (firstInboundMs > nowMs - DAY_MS) continue
    mature++

    const outcome = summariseReplies(thread.messages, firstInboundMs)
    if (outcome.human) humanReplied++
    if (outcome.humanWithin24h) humanRepliedWithin24h++
    if (outcome.autoAck) meAutoAck++
    if (!outcome.human && (outcome.autoAck || outcome.automated)) automatedOnly++
    if (!outcome.human && !outcome.autoAck && !outcome.automated) noReply++
  }

  return {
    cohort,
    pageSpokeFirst,
    mature,
    humanReplied,
    humanRepliedWithin24h,
    meAutoAck,
    automatedOnly,
    noReply,
    humanRepliedRate: mature === 0 ? null : humanReplied / mature,
    humanRepliedWithin24hRate: mature === 0 ? null : humanRepliedWithin24h / mature,
    window: {
      from: opts.from.toISOString(),
      to: opts.to.toISOString(),
      now: opts.now.toISOString(),
    },
  }
}

const PAGE_SIZE = 1000
const ID_CHUNK = 100

interface MessageRow {
  conversation_id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  sender_name: string | null
  sent_at: string
}

async function pageAll<T>(
  fetchPage: (offset: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await fetchPage(offset)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

export async function fetchReplyMetrics(
  db: SupabaseClient,
  clientId: string,
  opts: ReplyMetricsOptions,
): Promise<ReplyMetrics> {
  const conversations = await pageAll<{ id: string }>((offset) =>
    db
      .from('conversations')
      .select('id')
      .eq('client_id', clientId)
      .eq('channel', 'messenger')
      .gte('last_message_at', opts.from.toISOString())
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1),
  )

  const ids = conversations.map((row) => row.id)
  const rows: MessageRow[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    const chunkRows = await pageAll<MessageRow>((offset) =>
      db
        .from('conversation_messages')
        .select('conversation_id, direction, body, sender_name, sent_at')
        .in('conversation_id', chunk)
        .order('sent_at')
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1),
    )
    rows.push(...chunkRows)
  }

  const grouped = new Map<string, ThreadMessage[]>()
  for (const row of rows) {
    const list = grouped.get(row.conversation_id) ?? []
    list.push(
      rowToThreadMessage({
        conversationId: row.conversation_id,
        direction: row.direction,
        body: row.body,
        senderName: row.sender_name,
        sentAt: row.sent_at,
      }),
    )
    grouped.set(row.conversation_id, list)
  }

  const threads = Array.from(grouped, ([conversationId, messages]) => ({
    conversationId,
    messages,
  }))
  return computeReplyMetrics(threads, opts)
}
