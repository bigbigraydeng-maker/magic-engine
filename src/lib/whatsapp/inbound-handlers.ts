/**
 * Inbound webhook handlers for messages the business sends from the WhatsApp
 * phone App, and for Meta's "failed" delivery status callbacks.
 *
 * ## Why this file exists
 *
 * When an employee replies from the WhatsApp Business phone App (not from ME),
 * Meta pushes an *echo* of that message to our webhook with `from` = our own
 * number and `to` = the customer. Nothing else in the stack records it, so
 * without this handler the thread in ME looks unanswered and a salesperson
 * sends the customer a second reply. This module stores the echo as an
 * outbound message and files the CRM touch, mirroring `lib/whatsapp/send.ts`.
 *
 * Separately, Meta reports delivery failures asynchronously via a `status`
 * callback with `status: 'failed'`. `send.ts` writes the audit row as 'sent'
 * the moment Graph accepts the message, so a later failure would otherwise be
 * invisible. `applyFailedStatus` reconciles that row.
 *
 * ## Rules this file upholds
 *
 * 1. **A database error must be loud.** Both handlers THROW on a DB error so
 *    the webhook can answer 503 and Meta redelivers. They return 'skipped'
 *    only for things that are genuinely not applicable.
 * 2. **Never move the thread clock backwards.** The customer's own message is
 *    the clock the free window runs on; an echo that arrives late must not
 *    rewind `last_message_at`, and must never flip `last_message_from` to
 *    'customer'.
 * 3. **Never log customer data.** No phone numbers, bodies or ids beyond a
 *    fixed-text line; never pass an error object to console.
 *
 * Server-side only.
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { WhatsAppEcho, WhatsAppStatus } from './inbound-classify'

/** Shown as the sender of a message typed on the phone App — we cannot know
 *  which employee sent it, so the label is deliberately generic. */
export const WHATSAPP_APP_SENDER_NAME = 'WhatsApp 手机 App 员工'

export interface OurNumber {
  phoneNumberId: string
  displayNumber?: string
}

/** Digits-only form of a phone-ish string, for comparing numbers that may be
 *  formatted differently ('+64 21 000 0000' vs '64210000000'). */
function digits(s: string): string {
  return s.replace(/\D/g, '')
}

/** The set of digit-strings that identify OUR number: the phone_number_id and,
 *  when present, the human-readable display number. */
function ourDigitSet(ours: OurNumber): Set<string> {
  const set = new Set<string>()
  set.add(digits(ours.phoneNumberId))
  if (ours.displayNumber) {
    const d = digits(ours.displayNumber)
    if (d) set.add(d)
  }
  set.delete('')
  return set
}

/** Meta timestamps are seconds-since-epoch as a string. Fall back to now when
 *  the value is missing or not numeric. */
function echoSentAt(timestamp: string | undefined): string {
  if (timestamp && /^[0-9]+$/.test(timestamp)) {
    return new Date(Number(timestamp) * 1000).toISOString()
  }
  return new Date().toISOString()
}

/** Human-readable body for the echo, mirroring route.ts `messageBody`. */
function echoBody(echo: WhatsAppEcho): string | null {
  if (echo.type === 'text') return echo.text?.body ?? null
  const media = echo.image ?? echo.video ?? echo.audio ?? echo.document ?? echo.sticker
  const label = media?.caption ?? media?.filename
  if (label) return `[${echo.type}] ${label}`
  return `[${echo.type ?? 'unsupported'} message]`
}

/** Why an echo is not stored, or null when it should be. The reason is logged
 *  (fixed text, never the number or body) so a whole class of echoes cannot be
 *  dropped silently — e.g. if Meta's `from` format ever stops matching ours. */
function echoSkipReason(echo: WhatsAppEcho, ourDigits: Set<string>): string | null {
  if (typeof echo.id !== 'string' || echo.id.length === 0) return 'missing_id'
  if (typeof echo.to !== 'string' || !/^[0-9]{5,20}$/.test(echo.to)) return 'bad_recipient'
  if (typeof echo.from !== 'string') return 'missing_sender'
  if (!ourDigits.has(digits(echo.from))) return 'sender_not_our_number'
  if (ourDigits.has(digits(echo.to))) return 'recipient_is_our_number'
  if (echo.type === 'revoke' || echo.type === 'edit') return 'revoke_or_edit'
  return null
}

/** Find the conversation id for this customer, or null. */
async function findConversationId(
  clientId: string,
  waId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('client_id', clientId)
    .eq('channel', 'whatsapp')
    .eq('conversation_id', waId)
    .maybeSingle()
  if (error) throw new Error(`conversation lookup failed: ${error.message}`)
  return (data?.id as string | undefined) ?? null
}

/** Store the outbound message row. Throws on error. */
async function storeEchoMessage(
  conversationId: string,
  ours: OurNumber,
  echo: WhatsAppEcho,
  sentAt: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from('conversation_messages').upsert(
    {
      conversation_id: conversationId,
      message_id: echo.id,
      direction: 'outbound',
      sender_id: ours.phoneNumberId,
      sender_name: WHATSAPP_APP_SENDER_NAME,
      body: echoBody(echo),
      sent_at: sentAt,
    },
    // ignoreDuplicates: a redelivery — or Meta echoing a message ME itself sent through the API —
    // must never overwrite the row that already exists (it carries the real sender).
    { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
  )
  if (error) throw new Error(`conversation_messages upsert failed: ${error.message}`)
}

/** Move the thread clock forward only. Throws on error. */
async function advanceThreadClock(conversationId: string, sentAt: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: sentAt, last_message_from: 'page' })
    .eq('id', conversationId)
    .lt('last_message_at', sentAt)
  if (error) throw new Error(`conversation clock update failed: ${error.message}`)
}

/** Look up the contact id for an existing conversation. */
async function contactIdForConversation(conversationId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('contact_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (error) throw new Error(`conversation contact lookup failed: ${error.message}`)
  return (data?.contact_id as string | null | undefined) ?? null
}

/** File the outbound CRM touch, best-effort (never throws). */
async function recordEchoTouch(
  clientId: string,
  conversationId: string,
  contactId: string,
  sentAt: string,
): Promise<void> {
  const sourceRef = `${conversationId}:out`
  const body = {
    summary: '我们在 WhatsApp 回复过',
    metadata: { thread_id: conversationId, sender: 'page', origin: 'whatsapp_business_app_echo' },
  }
  try {
    const created = await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel: 'whatsapp',
        direction: 'outbound',
        occurred_at: sentAt,
        ...body,
        source: 'whatsapp',
        source_ref: sourceRef,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    const advanced = await supabaseAdmin
      .from('contact_touchpoints')
      .update({ occurred_at: sentAt })
      .eq('client_id', clientId)
      .eq('source', 'whatsapp')
      .eq('source_ref', sourceRef)
      .lt('occurred_at', sentAt)
    // supabase-js reports failures as `{ error }`, it does not throw.
    if (created.error || advanced.error) {
      console.error('[whatsapp/inbound-handlers] touchpoint write failed')
    }
  } catch {
    console.error('[whatsapp/inbound-handlers] touchpoint write failed')
  }
}

/**
 * Store a message the business typed on the WhatsApp phone App.
 *
 * Returns 'skipped' (with a fixed-text log line giving the reason) for anything
 * not applicable (not our number, a revoke or edit, a malformed payload, a number
 * with no existing conversation). Throws on a database error so the webhook can
 * answer 503 and Meta redelivers.
 */
export async function storeEcho(
  clientId: string,
  ours: OurNumber,
  echo: WhatsAppEcho,
): Promise<'stored' | 'skipped'> {
  const reason = echoSkipReason(echo, ourDigitSet(ours))
  if (reason) {
    console.error(`[whatsapp/inbound-handlers] echo skipped: reason=${reason}`)
    return 'skipped'
  }

  const waId = echo.to as string
  const sentAt = echoSentAt(echo.timestamp)

  // Only attach to a conversation that already exists. The phone App echoes EVERY
  // chat the staff have (suppliers, friends, strangers); creating a contact for
  // each would flood the CRM. A customer who writes in gets a conversation from
  // the normal inbound path, and later echoes then attach to it.
  const conversationId = await findConversationId(clientId, waId)
  if (!conversationId) {
    console.error('[whatsapp/inbound-handlers] echo skipped: reason=no_existing_conversation')
    return 'skipped'
  }
  const contactId = await contactIdForConversation(conversationId)

  await storeEchoMessage(conversationId, ours, echo, sentAt)
  await advanceThreadClock(conversationId, sentAt)

  if (contactId) {
    await recordEchoTouch(clientId, conversationId, contactId, sentAt)
  }

  return 'stored'
}

/** Build the error_message for a failed status, never including recipient_id. */
function failedStatusMessage(status: WhatsAppStatus): string {
  const first = status.errors?.[0]
  const code = first?.code ?? 'unknown'
  const title = first?.title
  const message = `Meta delivery failed: code ${code}${title ? ` — ${title}` : ''}`
  return message.slice(0, 300)
}

/**
 * Reconcile a `conversation_outbound_log` row when Meta reports a delivery
 * failure. Returns 'skipped' when the status is not applicable or the row is
 * not in a state we can reconcile. Throws on a database error.
 */
export async function applyFailedStatus(
  clientId: string,
  status: WhatsAppStatus,
): Promise<'updated' | 'skipped'> {
  if (status.status !== 'failed') return 'skipped'
  if (typeof status.id !== 'string' || status.id.length === 0) return 'skipped'
  if (typeof status.recipient_id !== 'string' || status.recipient_id.length === 0) {
    return 'skipped'
  }

  const { data: row, error: rowErr } = await supabaseAdmin
    .from('conversation_outbound_log')
    .select('id, conversation_id, status')
    .eq('client_id', clientId)
    .eq('meta_message_id', status.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (rowErr) throw new Error(`outbound log lookup failed: ${rowErr.message}`)
  if (!row) return 'skipped'
  if (row.status !== 'sent') return 'skipped'

  const conversationId = row.conversation_id as string

  const { data: convo, error: convoErr } = await supabaseAdmin
    .from('conversations')
    .select('participant_psid')
    .eq('id', conversationId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (convoErr) throw new Error(`conversation lookup failed: ${convoErr.message}`)
  if (!convo || convo.participant_psid !== status.recipient_id) return 'skipped'

  const errorMessage = failedStatusMessage(status)

  const { error: updateErr } = await supabaseAdmin
    .from('conversation_outbound_log')
    .update({ status: 'failed', error_message: errorMessage })
    .eq('id', row.id)
    .eq('status', 'sent')
  if (updateErr) throw new Error(`outbound log update failed: ${updateErr.message}`)

  return 'updated'
}
