/**
 * Customer brief generation — turns a stored Messenger thread into the card a
 * CTS salesperson reads (see brief-schema.ts).
 *
 * Trigger rules live here rather than in the cron route so they can be tested
 * without HTTP. A brief is (re)written only when ALL of these hold:
 *   1. the thread has at least one message
 *   2. nobody has spoken for QUIET_PERIOD_MS — summarise a finished exchange,
 *      not a half-typed one
 *   3. there is no brief yet, or the thread has grown since the last one
 *   4. the thread has not already been rewritten MAX_REGENS_PER_DAY times today
 *
 * Rule 4 is the one that matters commercially: without it a fast back-and-forth
 * re-summarises on every single message.
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  MessengerBriefSchema,
  MESSENGER_BRIEF_JSON_SCHEMA,
  BRIEF_SCHEMA_VERSION,
  type MessengerBrief,
  type BriefContext,
} from './brief-schema'

/** Wait this long after the last message before summarising. */
export const QUIET_PERIOD_MS = 30 * 60 * 1000

/** Hard ceiling on rewrites per thread per day. */
export const MAX_REGENS_PER_DAY = 3

export interface BriefCandidate {
  conversationId: string
  clientId: string
  messageCount: number
  lastMessageAt: string | null
  existingBriefMessageCount: number | null
  regenCount: number
  regenCountDate: string | null
}

export interface StoredMessage {
  direction: 'inbound' | 'outbound'
  senderName: string | null
  body: string
  sentAt: string
}

/**
 * Should this thread get a (re)written brief right now?
 * Pure function — `now` is injected so the quiet period is testable.
 */
export function shouldGenerateBrief(c: BriefCandidate, now: Date): boolean {
  if (c.messageCount <= 0 || !c.lastMessageAt) return false

  const quiet = now.getTime() - new Date(c.lastMessageAt).getTime() >= QUIET_PERIOD_MS
  if (!quiet) return false

  // Nothing new to say since the last brief.
  if (c.existingBriefMessageCount !== null && c.existingBriefMessageCount >= c.messageCount) {
    return false
  }

  const today = now.toISOString().slice(0, 10)
  const countedToday = c.regenCountDate === today ? c.regenCount : 0
  return countedToday < MAX_REGENS_PER_DAY
}

function modelName(): string {
  return process.env.MESSENGER_BRIEF_MODEL ?? 'gpt-4o-mini'
}

const SYSTEM_PROMPT = `You turn a Facebook Messenger thread between CTS Tours New Zealand and a prospective customer into a briefing card for a CTS salesperson.

LANGUAGE — this is the most common mistake, get it right:
- summary, customer_needs, objections, promises_made, next_action, risk_flags: write in SIMPLIFIED CHINESE. CTS staff read these in a Chinese interface.
- draft_reply: write in ENGLISH. It is sent to a New Zealand customer.
- When quoting the customer inside a Chinese field, keep their original English in brackets.

ATTRIBUTION — the mistake that makes a card useless. Every field under "trip" and "contact" describes what the CUSTOMER told us. Anything the CTS side said — a departure date we offered, a price we quoted, a tour we suggested — is OUR information, not theirs.
- If CTS quoted "from NZD $3,880pp" and the customer said nothing about money, budget_signal is null. A quote is not a budget.
- If CTS said a tour "departs 3 November 2026" and the customer never named a month, travel_window is null. A departure date is not their travel window.
- tour_interest may be filled from a tour the customer named or picked in a form, not from one we merely pitched.
- contact.phone / contact.email only from details the customer supplied (lead forms put them in the first message). Never CTS's own 0800 number or info@ address.

NAMES — tour names stay in ENGLISH exactly as CTS sells them ("Best of China", "A Tale of Two Cities"), even inside Chinese fields. Staff search on them and match them to the website; a translated name is unusable.

GROUNDING — only use what is in the thread:
- Never invent tour names, prices, dates, hotels, inclusions or itinerary detail.
- If the customer asked something the thread does not answer, say so in next_action and leave draft_reply asking rather than guessing.
- promises_made must capture EVERY commitment the CTS side made ("we'll send you...", "a specialist will call you within 24 hours"). Staff cannot honour a promise they never saw. An offer the customer has not accepted ("would you like the itinerary?") is NOT a promise.

next_action must be a concrete thing a salesperson does today, in the imperative — "打电话给 Kam，确认出行月份". Never "等待客户回复": if the customer has gone quiet, chasing them IS the action, and the elapsed time below tells you how overdue it is.

draft_reply rules (it goes to a real customer as CTS):
- Warm, plain New Zealand English. Two or three sentences. No hype words.
- Prices are always "from" prices per person in NZD, never a confirmed quote.
- CTS has operated in New Zealand for 25 years. 1928 belongs to the China Travel Service group in China. Never write "since 1928", "in Auckland since 1928" or "New Zealand's oldest".
- New Zealand passport holders can enter China visa-free for up to 30 days until 31 December 2026. Do not state any other figure.
- If the thread is about refunds, cancellations, changes, payment, insurance, medical or accessibility needs, or a complaint: do not attempt to resolve it. Draft a short reply saying a CTS travel specialist will come back to them, and offer 0800 287 888 / info@ctstours.co.nz.`

/**
 * State the model cannot read off the transcript: who is waiting on whom, and
 * for how long. Without this next_action degrades to "wait for the customer".
 */
function renderContext(context?: BriefContext): string {
  if (!context) return ''
  const who = context.awaitingReply
    ? `The CUSTOMER spoke last and has been waiting ${context.hoursSinceLastMessage} hours for a reply from CTS.`
    : `CTS spoke last. The customer has not replied for ${context.hoursSinceLastMessage} hours.`
  return `Current state: ${who}\n\n`
}

function renderThread(messages: StoredMessage[]): string {
  return messages
    .map((m) => {
      const who = m.direction === 'inbound' ? (m.senderName ?? 'Customer') : 'CTS'
      return `[${m.sentAt}] ${who}: ${m.body}`
    })
    .join('\n')
}

/**
 * Ask the model for a brief. Falls back to a deterministic brief when no API key
 * is configured so dev/test never depends on a network call.
 */
export async function generateBrief(
  messages: StoredMessage[],
  context?: BriefContext,
): Promise<MessengerBrief> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fallbackBrief(messages)

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey })
  const res = await client.responses.create({
    model: modelName(),
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${renderContext(context)}Thread:\n${renderThread(messages)}` },
    ],
    text: {
      format: { type: 'json_schema', name: 'messenger_brief', schema: MESSENGER_BRIEF_JSON_SCHEMA },
    },
  } as Parameters<typeof client.responses.create>[0])

  const text = (res as { output_text?: string }).output_text ?? '{}'
  const brief = MessengerBriefSchema.parse(JSON.parse(text))
  return {
    ...brief,
    follow_up_due_at: normaliseFollowUpDueAt(brief.follow_up_due_at),
    summary: stripMarkdown(brief.summary),
    next_action: brief.next_action ? stripMarkdown(brief.next_action) : null,
    customer_needs: brief.customer_needs.map(stripMarkdown),
    objections: brief.objections.map(stripMarkdown),
    promises_made: brief.promises_made.map(stripMarkdown),
    draft_reply: stripMarkdown(brief.draft_reply),
  }
}

/**
 * follow_up_due_at goes straight into a TIMESTAMPTZ column, so a model that
 * answers "下周三" or "in 3 days" does not merely render oddly — the INSERT
 * throws and the salesperson gets NO card for that thread at all. One unusable
 * date must not cost the whole brief, so anything unparseable becomes null.
 *
 * Bare dates ("2026-08-03") are accepted; Postgres would take them anyway and
 * midnight UTC is a reasonable reading of "that day".
 */
export function normaliseFollowUpDueAt(raw: string | null): string | null {
  if (!raw) return null

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null

  return parsed.toISOString()
}

/**
 * Messenger has no markdown: `**Best of China**` reaches the customer with the
 * asterisks visible. The source threads are full of them (the Meta agent writes
 * markdown), so the model copies the habit. A prompt rule alone is not enough
 * for text that goes to a real customer, so strip it here too.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
}

/**
 * Deterministic brief for the no-API-key path. Says only what is mechanically
 * true — it must never look like a real summary the salesperson can trust.
 */
export function fallbackBrief(messages: StoredMessage[]): MessengerBrief {
  const inbound = messages.filter((m) => m.direction === 'inbound')
  return MessengerBriefSchema.parse({
    summary: `未生成 AI 摘要（未配置模型）。客户共发送 ${inbound.length} 条消息，最后一条：${inbound[inbound.length - 1]?.body?.slice(0, 80) ?? '—'}`,
    intent_level: 'unknown',
    customer_needs: [],
    objections: [],
    promises_made: [],
    next_action: '请直接查看下方完整对话记录。',
    follow_up_due_at: null,
    risk_flags: ['AI 摘要未生成，请以原始对话为准'],
    trip: {
      tour_interest: null,
      travel_window: null,
      party_size: null,
      departure_city: null,
      first_time_to_china: null,
      budget_signal: null,
    },
    contact: { phone: null, email: null },
    draft_reply: '',
  })
}

/** Write (or rewrite) the brief row for one conversation. */
export async function storeBrief(
  candidate: BriefCandidate,
  brief: MessengerBrief,
  now: Date,
): Promise<void> {
  const today = now.toISOString().slice(0, 10)
  const countedToday = candidate.regenCountDate === today ? candidate.regenCount : 0

  const { error } = await supabaseAdmin.from('conversation_briefs').upsert(
    {
      conversation_id: candidate.conversationId,
      client_id: candidate.clientId,
      schema_version: BRIEF_SCHEMA_VERSION,
      model: process.env.OPENAI_API_KEY ? modelName() : 'fallback',
      summary: brief.summary,
      intent_level: brief.intent_level,
      customer_needs: brief.customer_needs,
      objections: brief.objections,
      promises_made: brief.promises_made,
      next_action: brief.next_action,
      follow_up_due_at: brief.follow_up_due_at,
      risk_flags: brief.risk_flags,
      trip: brief.trip,
      contact: brief.contact,
      draft_reply: brief.draft_reply,
      source_message_count: candidate.messageCount,
      generated_at: now.toISOString(),
      regen_count: countedToday + 1,
      regen_count_date: today,
      updated_at: now.toISOString(),
    },
    { onConflict: 'conversation_id' },
  )

  if (error) throw new Error(`brief upsert failed: ${error.message}`)
}
