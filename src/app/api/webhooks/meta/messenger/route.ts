/**
 * Facebook Page Messenger webhook — receives inbound customer messages in real time.
 *
 * Issue #1581 (CTS Governed Reply v3, Layer 5). This is the piece of the pipeline
 * that is genuinely new: `src/lib/messenger/sync.ts` already pulls the Page inbox
 * hourly via the Graph API's "list conversations" endpoint (Messenger, unlike
 * WhatsApp, HAS such an endpoint), which is why Messenger never needed a webhook
 * before. That cron is real-time-ish at best (it now runs every 2 hours, see
 * `src/app/api/cron/messenger-sync-hourly/route.ts`) and — per this issue — Meta's
 * Business AI has been observed answering with stale tour availability while the
 * cron's snapshot is out of date. This webhook makes inbound messages land the
 * moment Meta sends them, so the Governed Reply agent (F1-F4, issues #1577-#1580)
 * can react before Business AI does.
 *
 * GET  — Meta's one-time subscription handshake (`hub.challenge`).
 * POST — the message payload. Signature-verified with `META_APP_SECRET`.
 *
 * Mirrors `src/app/api/webhooks/whatsapp/route.ts` structure (verify → parse →
 * idempotent upsert → 200/503) — not reinvented. The two real differences from
 * that file:
 *
 * 1. **Thread identity.** WhatsApp has no separate thread id, so `wa_id` IS
 *    `conversations.conversation_id`. Messenger's cron already keys threads on
 *    the Graph API's own thread id (`t_xxx`, see `lib/meta/conversations.ts`),
 *    which this webhook's payload never contains (Meta only gives the sender's
 *    PSID on a `messaging` event). To avoid splitting one real customer into two
 *    `conversations` rows (one keyed `t_xxx` from cron, one keyed by PSID from
 *    this webhook), `upsertConversation` below looks up any existing row by
 *    `(client_id, channel, participant_psid)` first and reuses its
 *    `conversation_id` verbatim; only a customer nobody has synced before gets a
 *    brand-new row keyed on their PSID (same pattern WhatsApp uses for `wa_id`).
 * 2. **Contact linking is intentionally NOT done here.** `lib/messenger/link-contacts.ts`
 *    encodes several hard-won guardrails for turning a Messenger thread into a CRM
 *    contact (build only from `fb_psid`, never from an address typed into the
 *    message body — Meta's automated Page replies echo the business's own
 *    info@/phone into the thread, and matching on that built a fake customer,
 *    see that file's header). Re-deriving a slimmer version of those rules here
 *    would be a second, divergent implementation of a safety-critical rule.
 *    The message is still durably stored either way; `contact_id` stays null
 *    until the next `messenger-sync-hourly` run links it (now ≤2h later, not the
 *    days-long gap the WhatsApp file's `resolveContact` call was written to
 *    close for a channel with no other linking path at all).
 *
 * ## Three rules this file exists to uphold (copied from the WhatsApp webhook)
 *
 * 1. **A customer message must never disappear silently.** Meta stops
 *    redelivering once we answer 200, so a 200 is a promise the message is
 *    durably stored. Anything we could not store is either retried (non-200) or
 *    left in a place a human is told about — never only in a log line.
 * 2. **"Not found" and "could not look up" are different answers.**
 * 3. **Inbound must land somewhere a person will actually see.**
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { CONVERSATION_MESSAGE_RECEIVED_EVENT } from '@/lib/conversations/events'
import { isOptOutKeyword, recordOptOutKeywordTouch } from '@/lib/messenger-agent/optout'
import { recordOptOutWriteFailure } from '@/lib/messenger-agent/optout-failures'
import { assessPageBinding } from '@/lib/meta/page-sync-authorization'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET — subscription verification handshake. Identical contract to the
// WhatsApp webhook (same Meta App, same verify token).
// ---------------------------------------------------------------------------

/** Constant-time string compare, so the verify token can't be probed byte by byte. */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const verifyToken = process.env.META_VERIFY_TOKEN
  if (!verifyToken) {
    return NextResponse.json({ error: 'Server misconfiguration: META_VERIFY_TOKEN not set' }, { status: 500 })
  }

  const params = req.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (mode === 'subscribe' && token && safeEquals(token, verifyToken) && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

// ---------------------------------------------------------------------------
// Signature verification — same HMAC contract WhatsApp's webhook uses (both
// channels sign with the same Meta App's `META_APP_SECRET`).
// ---------------------------------------------------------------------------
function isValidSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const provided = signatureHeader.slice('sha256='.length)

  // Shape-check before decoding: Buffer.from(x, 'hex') silently truncates at the
  // first non-hex character, so "zz…" would decode to an empty buffer and could
  // otherwise be compared against a truncated expectation.
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(provided, 'hex')
  if (expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

// ---------------------------------------------------------------------------
// Meta's documented Messenger Platform webhook payload (`messaging` events).
// https://developers.facebook.com/docs/messenger-platform/webhooks
// ---------------------------------------------------------------------------

interface MessengerAttachment {
  type?: string // image | video | audio | file | template | fallback
  payload?: { url?: string }
}

/** The ad/CTA click that started a thread (Click-to-Messenger ads). Present on
 *  the referring event only — no read API returns it later, so it is captured
 *  on sight, same reasoning as WhatsApp's `referral`. */
interface MessengerReferral {
  ref?: string
  source?: string
  type?: string
  ad_id?: string
}

interface MessengerMessage {
  mid?: string
  text?: string
  /** True when this event is Meta echoing back a message the Page itself sent
   *  (only delivered if the app subscribes to `message_echoes`). Not a customer
   *  message — skipped, same as WhatsApp's `statuses` callbacks having no `messages`. */
  is_echo?: boolean
  attachments?: MessengerAttachment[]
}

interface MessengerMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: MessengerMessage
  referral?: MessengerReferral
}

interface MessengerWebhookPayload {
  object?: string
  entry?: Array<{
    id?: string // Page id
    messaging?: MessengerMessagingEvent[]
  }>
}

/** Media attached to a message, if any. Meta's CDN URL for it is time-limited,
 *  but keeping it is still strictly better than losing the reference entirely. */
function extractMedia(msg: MessengerMessage): { kind: string; url: string | null } | null {
  const first = msg.attachments?.[0]
  if (!first?.type) return null
  return { kind: first.type, url: first.payload?.url ?? null }
}

/** Human-readable body for a message. Non-text keeps a usable label so an
 *  operator sees something better than a bare tag. */
function messageBody(msg: MessengerMessage): string {
  if (msg.text) return msg.text
  const media = extractMedia(msg)
  if (!media) return '[unsupported message]'
  return `[${media.kind} message]`
}

// ---------------------------------------------------------------------------
// Storage.
// ---------------------------------------------------------------------------

/** Distinguishes "this Page maps to nobody" from "we could not ask". */
type ClientLookup =
  | { ok: true; clientId: string }
  | { ok: false; kind: 'unmapped' }
  | { ok: false; kind: 'lookup_failed'; message: string }

async function resolveClientId(pageId: string): Promise<ClientLookup> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('facebook_page_id', pageId)
    .maybeSingle()

  // A failed query is NOT "no client" — see whatsapp/route.ts's identical guard.
  // Reporting a lookup failure as "unmapped" would send someone to check Meta's
  // config instead of the deploy, while 100% of inbound Messenger traffic drops.
  if (error) return { ok: false, kind: 'lookup_failed', message: error.message }
  if (!data?.id) return { ok: false, kind: 'unmapped' }
  return { ok: true, clientId: data.id as string }
}

interface ExistingConversation {
  id: string
  conversationId: string
  contactId: string | null
}

/** Reuse the cron's existing thread for this PSID, if `messenger-sync-hourly`
 *  has already synced this customer — see the file header for why this lookup
 *  is what keeps the two writers from splitting one customer into two rows. */
async function findExistingConversation(clientId: string, psid: string): Promise<ExistingConversation | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('id, conversation_id, contact_id')
    .eq('client_id', clientId)
    .eq('channel', 'messenger')
    .eq('participant_psid', psid)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id as string,
    conversationId: data.conversation_id as string,
    contactId: (data.contact_id as string | null) ?? null,
  }
}

/**
 * Find or create this customer's thread.
 *
 * Atomic upsert rather than select-then-insert-on-miss: Meta delivers
 * at-least-once and concurrently, so two deliveries for a brand-new customer
 * would both see "no thread" and both try to insert. Passing the SAME
 * `conversation_id` (the PSID, when no cron-synced row exists yet) through
 * `.upsert(..., { onConflict: 'client_id,conversation_id' })` makes the second
 * delivery an UPDATE instead of a constraint violation — no row is duplicated
 * and no message is dropped by an unhandled insert error.
 */
async function upsertConversation(
  clientId: string,
  pageId: string,
  psid: string,
  participantName: string | undefined,
  referral: MessengerReferral | undefined,
  sentAt: string,
): Promise<{ id: string; conversationId: string; contactId: string | null }> {
  const existing = await findExistingConversation(clientId, psid)
  const conversationId = existing?.conversationId ?? psid

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .upsert(
      {
        client_id: clientId,
        channel: 'messenger',
        page_id: pageId,
        conversation_id: conversationId,
        participant_psid: psid,
        participant_name: participantName ?? null,
        last_message_at: sentAt,
        last_message_from: 'customer',
      },
      { onConflict: 'client_id,conversation_id' },
    )
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'failed to upsert conversation')
  const id = data.id as string

  // Attribution is FIRST-touch — same reasoning and same `.is(null)` concurrency
  // guard as whatsapp/route.ts's `entry_referral` write.
  if (referral) {
    const { error: refErr } = await supabaseAdmin
      .from('conversations')
      .update({ entry_referral: referral })
      .eq('id', id)
      .is('entry_referral', null)
    if (refErr) {
      console.error(`[webhooks/meta/messenger] entry_referral 写入失败（会话 ${id}）:`, refErr.message)
    }
  }

  return { id, conversationId, contactId: existing?.contactId ?? null }
}

/** Store one message. Throws so the caller can decide to retry the delivery. */
async function storeMessage(
  clientId: string,
  pageId: string,
  event: MessengerMessagingEvent,
): Promise<{ conversationId: string; messageId: string; contactId: string | null; sentAt: string } | null> {
  const psid = event.sender?.id
  const msg = event.message
  if (!psid || !msg?.mid || msg.is_echo) return null

  const sentAt = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString()

  const { id: conversationRowId, contactId } = await upsertConversation(
    clientId,
    pageId,
    psid,
    undefined, // Messenger's `messaging` event carries no display name; the
    // hourly sync fills participant_name in from the Graph API's participants list.
    event.referral,
    sentAt,
  )

  const media = extractMedia(msg)

  // Idempotent on (conversation_id, message_id) — `on conflict do nothing`, per
  // issue #1581: a redelivered mid must never produce a second row.
  const { error: msgErr } = await supabaseAdmin.from('conversation_messages').upsert(
    {
      conversation_id: conversationRowId,
      message_id: msg.mid,
      direction: 'inbound',
      sender_id: psid,
      body: messageBody(msg),
      ...(media ? { media_type: media.kind, media_id: media.url } : {}),
      sent_at: sentAt,
    },
    { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
  )
  if (msgErr) throw new Error(`conversation_messages upsert failed: ${msgErr.message}`)

  return { conversationId: conversationRowId, messageId: msg.mid, contactId, sentAt }
}

/**
 * Tell the Governed Reply pipeline a message landed. Never throws: the message
 * is already durably stored by the time this runs, so a failed handoff must not
 * turn into a 503 that makes Meta redeliver a message we already have (that
 * would double the emitted event once retried, not recover anything).
 */
async function emitMessageReceived(data: {
  clientId: string
  conversationId: string
  messageId: string
  contactId: string | null
  sentAt: string
}): Promise<{ sent: boolean; error: string | null }> {
  try {
    await sendInngestEvent({
      id: `messenger-webhook:${data.conversationId}:${data.messageId}`,
      name: CONVERSATION_MESSAGE_RECEIVED_EVENT,
      data: {
        channel: 'messenger',
        client_id: data.clientId,
        conversation_id: data.conversationId,
        message_id: data.messageId,
        contact_id: data.contactId,
        direction: 'inbound',
        sent_at: data.sentAt,
      },
    })
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `[webhooks/meta/messenger] conversation/message.received 没发出去（消息已入库）: ${message}`,
    )
    return { sent: false, error: message }
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: META_APP_SECRET not set' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')
  if (!isValidSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: MessengerWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Every message is attempted independently: one bad message must not discard
  // the others in the same delivery.
  let stored = 0
  const failures: string[] = []

  for (const entry of payload.entry ?? []) {
    const pageId = entry.id
    const events = entry.messaging ?? []
    if (!pageId || events.length === 0) continue

    const lookup = await resolveClientId(pageId)
    if (!lookup.ok) {
      if (lookup.kind === 'lookup_failed') {
        console.error(
          `[webhooks/meta/messenger] client lookup FAILED for page_id=${pageId} ` +
            `— this is a lookup error, not an unmapped page: ${lookup.message}`,
        )
        failures.push(`lookup_failed:${pageId}`)
      } else {
        // Genuinely nobody owns this Page. Retrying will not help. Same
        // known-gap-not-a-blocker call as whatsapp/route.ts TODO(#1331): this
        // dead-ends in a log line rather than a 「🙋 需要你动手」 item, deferred
        // for the same reason (no client_id to attach the manual task to).
        console.error(
          `[webhooks/meta/messenger] no client mapped to page_id=${pageId} ` +
            `— ${events.length} event(s) dropped. Set clients.facebook_page_id.`,
        )
      }
      continue
    }

    // AD-SEC-4: the Page → client mapping comes from clients.facebook_page_id,
    // which client staff could edit until 2026-09-14. Only store under a client
    // whose binding is verified (same gate as the hourly sync) — otherwise a
    // stale binding of someone else's Page would file their customers' messages
    // under the wrong client. A read failure is retryable (503); a refusal is not
    // — the daily todo (pm-todo/page-binding-items.ts) names the client to fix.
    const verdict = await assessPageBinding(supabaseAdmin, lookup.clientId, pageId, process.env)
    if (!verdict.verified) {
      if (verdict.reason === 'check_failed') {
        console.error(`[webhooks/meta/messenger] binding check FAILED for page_id=${pageId}: ${verdict.detail ?? ''}`)
        failures.push(`binding_check_failed:${pageId}`)
      } else {
        console.error(
          `[webhooks/meta/messenger] page_id=${pageId} binding not verified for client ${lookup.clientId} ` +
            `(${verdict.reason}) — ${events.length} event(s) not stored`,
        )
      }
      continue
    }

    for (const event of events) {
      try {
        const result = await storeMessage(lookup.clientId, pageId, event)
        if (!result) continue // echo / non-message event — not an error, nothing to store
        stored++

        // 🔴 Codex 复审（2026-09-15，PR #1736）实测发现：这条渠道从来没检测过
        // 「这条正在处理的消息本身是不是一句退订指令」——只有 WhatsApp 那边的
        // webhook（issue #1582）会做这一步，Messenger 这边只落库 + emit。后果：
        // 一个客户第一次开口就说"别再联系我"，F1（issue #1584）的 opt-out 检查
        // 只会去查"已经记录过的"拒联状态——这条消息本身还没被任何人记下来，
        // 检查通过、照常自动回一句安抚，直接违反客户刚说的话（也是 Meta
        // Messenger Platform Policy §2.1 意义上的真实风险，跟当初给 F1 加
        // opt-out 检查这条 v3 补丁要防的是同一类事故）。
        //
        // 修法跟 WhatsApp webhook 逐字一致（`optout.ts` 的写入路径本来就是
        // 渠道无关设计，只是 Messenger 这边一直没接上）：best-effort，消息已经
        // 落库，这一步写失败不能让 Meta 重投整条已经存好的消息。
        if (isOptOutKeyword(event.message?.text ?? '')) {
          try {
            if (result.contactId) {
              await recordOptOutKeywordTouch(
                {
                  clientId: lookup.clientId,
                  contactId: result.contactId,
                  channel: 'messenger',
                  conversationId: result.conversationId,
                  messageId: result.messageId,
                  // 必须传消息真实的发送时间，理由跟 whatsapp/route.ts 同一段
                  // 注释——省略参数落到「现在」会让「晚于人工纠正」的判断失效。
                  occurredAt: result.sentAt,
                },
                supabaseAdmin,
              )
            } else {
              // 没解析出 contact_id：退回会话级兜底列（issue #1574），
              // 不经过 optout.ts（它假设 contact 已经存在）。
              const { error: unlinkedErr } = await supabaseAdmin
                .from('conversations')
                .update({ optout_unlinked: true })
                .eq('id', result.conversationId)
                .eq('client_id', lookup.clientId)
              if (unlinkedErr) {
                console.error(
                  `[webhooks/meta/messenger] 写 conversations.optout_unlinked 失败（会话 ${result.conversationId}）:`,
                  unlinkedErr.message,
                )
                // 心跳检查（issue #1587）要能看到这次失败——否则会被误判成
                // 「没人退订、一切正常」。
                await recordOptOutWriteFailure(
                  {
                    clientId: lookup.clientId,
                    channel: 'messenger',
                    conversationId: result.conversationId,
                    contactId: null,
                    errorMessage: unlinkedErr.message,
                  },
                  supabaseAdmin,
                )
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[webhooks/meta/messenger] 退订触点写入失败（消息已入库）:`, err)
            await recordOptOutWriteFailure(
              {
                clientId: lookup.clientId,
                channel: 'messenger',
                conversationId: result.conversationId,
                contactId: result.contactId,
                errorMessage: message,
              },
              supabaseAdmin,
            )
          }
        }

        await emitMessageReceived({
          clientId: lookup.clientId,
          conversationId: result.conversationId,
          messageId: result.messageId,
          contactId: result.contactId,
          sentAt: result.sentAt,
        })
      } catch (err) {
        console.error(`[webhooks/meta/messenger] failed to store message ${event.message?.mid}:`, err)
        failures.push(`store_failed:${event.message?.mid ?? 'unknown'}`)
      }
    }
  }

  // A 200 tells Meta "durably stored, never send this again" — only said when true.
  if (failures.length > 0) {
    return NextResponse.json({ received: false, stored, failed: failures.length }, { status: 503 })
  }

  return NextResponse.json({ received: true, stored }, { status: 200 })
}
