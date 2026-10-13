/**
 * WhatsApp **history sync** intake.
 *
 * When a business links a WhatsApp Business account, Meta pushes a bulk
 * "history" payload containing metadata about past conversations. We do NOT
 * want to import those messages as real conversation rows — they belong to
 * chats the business may never have had in our CRM, and we must never store
 * message bodies or media ids from them.
 *
 * Instead we park the *metadata only* in `whatsapp_history_inbox`, a "to be
 * claimed" table. A later, separate flow can decide whether any of these
 * threads correspond to a known customer and promote them.
 *
 * ## Rules this file upholds
 *
 * 1. **Metadata only.** A row never carries a body, a caption, a media id or
 *    any free text. The only strings stored are ids, a direction, a truncated
 *    message type and a truncated history status.
 * 2. **Never guess a direction.** A message whose `from` is neither our number
 *    nor the thread's customer is skipped, never defaulted to 'customer'.
 * 3. **A database error must be loud.** We throw a fixed-text error so the
 *    webhook can answer 503 and Meta redelivers. The thrown message never
 *    contains the underlying error, a message id or a phone number.
 * 4. **Never log customer data.** Exactly one fixed-text line per call, with
 *    counts only.
 *
 * Server-side only.
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { HistoryChunk, HistoryMessage, HistoryThread } from './inbound-classify'

/** Maximum rows per `upsert` call. */
export const HISTORY_INSERT_BATCH = 500

export interface HistoryIntakeResult {
  stored: number
  skipped: number
}

/** A row destined for `whatsapp_history_inbox`. Metadata only — no body. */
interface HistoryInboxRow {
  client_id: string
  phone_number_id: string
  customer_wa_id: string
  message_id: string
  direction: 'business' | 'customer'
  msg_type: string | null
  sent_at: string | null
  history_status: string | null
  phase: number | null
  chunk_order: number | null
}

/** Digits-only form of a phone-ish string. */
function digits(s: string): string {
  return s.replace(/\D/g, '')
}

/** The set of digit-strings that identify OUR number. */
function ourDigitSet(ours: { phoneNumberId: string; displayNumber?: string }): Set<string> {
  const set = new Set<string>()
  const pn = digits(ours.phoneNumberId)
  if (pn) set.add(pn)
  if (ours.displayNumber) {
    const d = digits(ours.displayNumber)
    if (d) set.add(d)
  }
  return set
}

/** Largest value we accept for the integer columns (phase / chunk_order). Anything else is
 *  stored as null: one odd value must never turn a once-only delivery into a permanent 503. */
const MAX_SMALL_INT = 1_000_000

/** A small non-negative integer (or numeric string of one), else null. */
function parseMetaNumber(value: number | string | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= MAX_SMALL_INT ? value : null
  }
  if (typeof value === 'string' && /^[0-9]{1,7}$/.test(value)) {
    const n = Number(value)
    return n <= MAX_SMALL_INT ? n : null
  }
  return null
}

/** ISO string from a seconds-since-epoch numeric string, else null. Never throws: an
 *  out-of-range timestamp must not poison the whole delivery. */
function parseTimestamp(timestamp: string | undefined): string | null {
  if (typeof timestamp !== 'string' || !/^[0-9]{1,13}$/.test(timestamp)) return null
  const date = new Date(Number(timestamp) * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Truncate a string to `max` chars, or null when not a non-empty string. */
function truncate(value: string | undefined, max: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.slice(0, max)
}

/** The customer wa id for a thread, or null when the thread is not applicable. */
function customerForThread(thread: HistoryThread, ourDigits: Set<string>): string | null {
  const id = thread.id
  if (typeof id !== 'string' || !/^[0-9]{5,20}$/.test(id)) return null
  if (ourDigits.has(digits(id))) return null
  return id
}

/** Direction for a message, or null when it cannot be determined. */
function directionFor(
  message: HistoryMessage,
  customer: string,
  ourDigits: Set<string>,
): 'business' | 'customer' | null {
  if (typeof message.from !== 'string') return null
  const from = digits(message.from)
  if (!from) return null
  if (ourDigits.has(from)) return 'business'
  if (from === customer) return 'customer'
  return null
}

/** Build a row for one message, or null when the message must be skipped. */
function rowForMessage(
  clientId: string,
  ours: { phoneNumberId: string },
  ourDigits: Set<string>,
  customer: string,
  message: HistoryMessage,
  phase: number | null,
  chunkOrder: number | null,
): HistoryInboxRow | null {
  if (typeof message.id !== 'string' || message.id.length === 0) return null
  const direction = directionFor(message, customer, ourDigits)
  if (!direction) return null
  return {
    client_id: clientId,
    phone_number_id: ours.phoneNumberId,
    customer_wa_id: customer,
    message_id: message.id,
    direction,
    msg_type: truncate(message.type, 50),
    sent_at: parseTimestamp(message.timestamp),
    history_status: truncate(message.history_context?.status, 30),
    phase,
    chunk_order: chunkOrder,
  }
}

/** Collect rows from one chunk, counting skipped messages. */
function collectChunk(
  clientId: string,
  ours: { phoneNumberId: string },
  ourDigits: Set<string>,
  chunk: HistoryChunk,
): { rows: HistoryInboxRow[]; skipped: number } {
  const rows: HistoryInboxRow[] = []
  let skipped = 0
  const phase = parseMetaNumber(chunk.metadata?.phase)
  const chunkOrder = parseMetaNumber(chunk.metadata?.chunk_order)
  const threads = Array.isArray(chunk.threads) ? chunk.threads : []
  for (const thread of threads) {
    if (!thread || typeof thread !== 'object') continue
    const messages = Array.isArray(thread.messages) ? thread.messages : []
    const customer = customerForThread(thread, ourDigits)
    if (!customer) {
      skipped += messages.length
      continue
    }
    for (const message of messages) {
      if (!message || typeof message !== 'object') {
        skipped += 1
        continue
      }
      const row = rowForMessage(clientId, ours, ourDigits, customer, message, phase, chunkOrder)
      if (row) rows.push(row)
      else skipped += 1
    }
  }
  return { rows, skipped }
}

/** De-duplicate rows by message_id, keeping the first occurrence. */
function dedupeByMessageId(rows: HistoryInboxRow[]): HistoryInboxRow[] {
  const seen = new Set<string>()
  const out: HistoryInboxRow[] = []
  for (const row of rows) {
    if (seen.has(row.message_id)) continue
    seen.add(row.message_id)
    out.push(row)
  }
  return out
}

/** Insert rows in batches. Throws a fixed-text error on any DB error. */
async function insertBatches(rows: HistoryInboxRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += HISTORY_INSERT_BATCH) {
    const batch = rows.slice(i, i + HISTORY_INSERT_BATCH)
    const { error } = await supabaseAdmin
      .from('whatsapp_history_inbox')
      .upsert(batch, { onConflict: 'client_id,message_id', ignoreDuplicates: true })
    if (error) throw new Error('history inbox upsert failed')
  }
}

/**
 * Store WhatsApp history-sync metadata into `whatsapp_history_inbox`.
 *
 * Returns the number of rows stored (after de-duplication) and the number of
 * messages skipped. Throws a fixed-text error on a database error so the
 * webhook can answer 503 and Meta redelivers.
 */
export async function storeHistoryChunks(
  clientId: string,
  ours: { phoneNumberId: string; displayNumber?: string },
  chunks: HistoryChunk[],
): Promise<HistoryIntakeResult> {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    console.log('[whatsapp/history-intake] stored=0 skipped=0')
    return { stored: 0, skipped: 0 }
  }

  const ourDigits = ourDigitSet(ours)
  const allRows: HistoryInboxRow[] = []
  let skipped = 0

  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue
    const { rows, skipped: chunkSkipped } = collectChunk(clientId, ours, ourDigits, chunk)
    allRows.push(...rows)
    skipped += chunkSkipped
  }

  const rows = dedupeByMessageId(allRows)
  const stored = rows.length

  if (stored > 0) {
    await insertBatches(rows)
  }

  console.log(`[whatsapp/history-intake] stored=${stored} skipped=${skipped}`)
  if (skipped > 0) {
    // Counts only. A non-zero number here after go-live usually means our number's format does not
    // match Meta's `from` (or the display number is missing) — history is delivered once, so it
    // must be noticed, not lost quietly.
    console.error(`[whatsapp/history-intake] skipped ${skipped} message(s) — check sender/number matching`)
  }
  if (stored === 0 && skipped > 0) {
    // Nothing usable in a delivery that did contain messages: refuse so Meta redelivers
    // instead of acknowledging (and losing) history we could not read.
    throw new Error('history delivery contained messages but none could be stored')
  }
  return { stored, skipped }
}
