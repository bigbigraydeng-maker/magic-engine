/**
 * WhatsApp Cloud API webhook — receives inbound customer messages in real time.
 *
 * Unlike Messenger (pulled hourly via `messenger-sync-hourly`, because the Graph
 * API supports listing a Page's conversations), WhatsApp's Cloud API has no
 * equivalent "list recent messages" endpoint — Meta only pushes to a webhook.
 * So this route, not a cron job, is how inbound WhatsApp messages reach
 * `conversations` / `conversation_messages`.
 *
 * GET  — Meta's one-time subscription handshake (`hub.challenge`).
 * POST — the message payload. Signature-verified with the per-number app
 *        secret from `whatsapp_app_credentials`, falling back to
 *        `META_APP_SECRET`.
 *
 * ## Three rules this file exists to uphold
 *
 * 1. **A customer message must never disappear silently.** Meta stops
 *    redelivering once we answer 200, so a 200 is a promise that the message is
 *    durably stored. Anything we could not store is either retried (non-200) or
 *    left in a place a human is told about — never only in a log line.
 *    (CLAUDE.md 铁律 3)
 * 2. **"Not found" and "could not look up" are different answers.** Conflating
 *    them sends whoever is debugging in exactly the wrong direction — the
 *    failure mode `project-me2-ads-empty-has-three-origins` is about.
 * 3. **Inbound must land somewhere a person will actually see.** Storing a row
 *    nobody reads is the database version of a silent failure.
 *
 * Routing an inbound message to a client_id goes through
 * `clients.whatsapp_phone_number_id` (20260902000001) — never a hardcoded
 * client_id here.
 *
 * Inbound is classified (`lib/whatsapp/inbound-classify.ts`): customer messages
 * → storeMessage (unchanged); staff-phone echoes → storeEcho (outbound message,
 * no opt-out check, no event, never moves the customer clock); failed delivery
 * statuses → applyFailedStatus; history → stored metadata-only into
 * `whatsapp_history_inbox` ("to be claimed"; no contacts, conversations,
 * touchpoints or events). A history chunk whose shape we do not recognise is
 * still refused with 503 so Meta redelivers — and the Meta app must NOT be
 * subscribed to the `history` field before the migration is applied.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildIdentities, resolveContact } from '@/lib/crm/identity'
import { isOptOutKeyword, recordOptOutKeywordTouch } from '@/lib/messenger-agent/optout'
import { recordOptOutWriteFailure } from '@/lib/messenger-agent/optout-failures'
import { inngest } from '@/lib/inngest/client'
// 🔴 魏征复审（2026-09-15）实测发现：这里原来自己重新声明一份同名字符串常量，
// 而不是 import 共享契约模块 `@/lib/conversations/events.ts` 的
// `CONVERSATION_MESSAGE_RECEIVED_EVENT` —— 那份契约模块自己的文件头就警告过
// "改这个字符串前必须先跟 WhatsApp 那条线的实现对齐"，而这条实现的 payload
// 形状（`body`/`occurred_at`）跟契约模块要求的 `ConversationMessageReceivedSchema`
// （要求 `sent_at`，没有 `body`）实际上早就对不上——这条不一致因为事件名字符串
// 本身没变而完全没被发现，直到 F1（issue #1584）第一次真的去解析这个事件才
// 实测出来：每一条 WhatsApp 消息都会被判定成 payload 不合法，静默丢弹。
// 改成直接 import 契约模块本身，让 TypeScript 在编译期就能看到两边共用同一个
// 字符串常量；payload 形状也改成跟 `ConversationMessageReceivedSchema` 完全
// 一致（见下面 emit 调用处）。
import { CONVERSATION_MESSAGE_RECEIVED_EVENT } from '@/lib/conversations/events'
import {
  MAX_WEBHOOK_BODY_BYTES,
  extractWebhookPhoneNumberIds,
  chooseWebhookSecret,
} from '@/lib/whatsapp/app-secret'
import {
  classifyInboundChanges,
  type WhatsAppInboundMessage,
  type WhatsAppMedia,
  type WhatsAppReferral,
} from '@/lib/whatsapp/inbound-classify'
import { storeEcho, applyFailedStatus } from '@/lib/whatsapp/inbound-handlers'
import { storeHistoryChunks } from '@/lib/whatsapp/history-intake'
import { recordUnclaimedNumber, type UnclaimedKind } from '@/lib/whatsapp/unclaimed'
import { logRejection } from '@/lib/whatsapp/reject-log'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET — subscription verification handshake.
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
    // Meta expects the raw challenge string back, not JSON. Pin the content type
    // so no browser sniffs an attacker-chosen challenge into something else.
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

// ---------------------------------------------------------------------------
// Signature verification.
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
// Meta's documented Cloud API webhook payload.
// ---------------------------------------------------------------------------

/** Media attached to a message, if any — kept so the Meta media id survives.
 *  Meta deletes the underlying file after ~30 days; losing the id loses the
 *  customer's attachment permanently. Downloading is a later PR. */
function extractMedia(msg: WhatsAppInboundMessage): { kind: string; media: WhatsAppMedia } | null {
  for (const kind of ['image', 'video', 'audio', 'document', 'sticker'] as const) {
    const media = msg[kind]
    if (media?.id) return { kind, media }
  }
  return null
}

/** Human-readable body for a message. Non-text keeps its caption/filename when
 *  Meta supplies one, so an operator sees something better than a bare tag. */
function messageBody(msg: WhatsAppInboundMessage): string | null {
  if (msg.type === 'text') return msg.text?.body ?? null
  const found = extractMedia(msg)
  if (!found) return `[${msg.type ?? 'unsupported'} message]`
  const label = found.media.caption ?? found.media.filename
  return label ? `[${found.kind}] ${label}` : `[${found.kind} message]`
}

// ---------------------------------------------------------------------------
// Storage.
// ---------------------------------------------------------------------------

/** Distinguishes "this number maps to nobody" from "we could not ask". */
type ClientLookup =
  | { ok: true; clientId: string }
  | { ok: false; kind: 'unmapped' }
  | { ok: false; kind: 'lookup_failed'; message: string }

async function resolveClientId(phoneNumberId: string): Promise<ClientLookup> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .maybeSingle()

  // A failed query is NOT "no client". The common cause is the migration not
  // being applied yet, which reports as `column does not exist` — reporting that
  // as "unmapped" would send someone to check Meta's config instead of the
  // deploy, while 100% of inbound messages are dropped.
  if (error) return { ok: false, kind: 'lookup_failed', message: error.message }
  if (!data?.id) return { ok: false, kind: 'unmapped' }
  return { ok: true, clientId: data.id as string }
}

/**
 * Find or create this customer's thread, and attach it to a real person.
 *
 * Atomic upsert rather than select-then-insert: Meta delivers at-least-once and
 * concurrently, so two deliveries for a new customer would both see "no thread"
 * and both insert, one hitting `UNIQUE (client_id, conversation_id)` and
 * throwing — which under the old code dropped the message.
 *
 * `wa_id` is the customer's phone number, which is ME's strongest cross-channel
 * identity key (lib/crm/identity.ts) — far better than a Messenger PSID. Wiring
 * it through `resolveContact` is what makes the thread visible in the CRM day
 * list and what lets the send path record a touchpoint; without a `contact_id`
 * the whole outbound adapter is unreachable code.
 */
async function upsertConversation(
  clientId: string,
  waId: string,
  participantName: string | undefined,
  referral: WhatsAppReferral | undefined,
  sentAt: string,
): Promise<{ conversationId: string; contactId: string | null }> {
  let contactId: string | null = null
  try {
    const resolved = await resolveContact({
      clientId,
      // wa_id is a full international number WITHOUT the leading '+' (Meta's
      // contract). Passing it raw makes normalisePhone fall through to its
      // "already has a country code" branch, which only recognises the DEFAULT
      // country — so a +64 number resolves and an Australian, Chinese or US one
      // returns null, the contact is never created, no touchpoint is filed, and
      // the message sits in the database where nobody sees it. Re-adding the '+'
      // routes it through the E.164 branch, which is country-agnostic.
      // ME serves AU **and** NZ; defaulting to one of them here would hardcode
      // the first client's market into shared runtime (张良 红线 2 / 换客户测试).
      identities: buildIdentities({ phone: `+${waId}` }),
      displayName: participantName ?? null,
      // 🔴 **绝不用 WhatsApp 昵称盖掉库里已有的名字**（魏征复审 2026-09-28，实测确认）。
      //
      // `resolveContact` 的 `renameOk` 默认是 true（lib/crm/identity.ts:249），所以
      // 不显式关掉的话，**每一条** WhatsApp 消息都会把 `contacts.display_name` 改写成
      // 客人自设的 WhatsApp 昵称。而这里传进来的 identity 只有电话号，命中的往往是
      // 早就存在的老联系人：CTS 库里 774 条表单留资 + 642 通电话的人，报名时填的
      // 真名会被表情 / 小名静默覆盖 —— 顾问再也认不出这是谁，而且原名不可恢复。
      //
      // 首次建人不受影响：新建那条路径直接用 `displayName` 建，跟这个开关无关。
      // 所以效果正是「没名字时用昵称，有名字时不动」。
      overwriteDisplayName: false,
      source: 'whatsapp',
      seenAt: sentAt,
    })
    contactId = resolved.contactId
  } catch (err) {
    // Identity resolution is best-effort: a thread with no contact is still
    // better than a dropped message. It is logged loudly because it degrades
    // the thread to "visible in the inbox but not in the day list".
    console.error(`[webhooks/whatsapp] resolveContact failed for client=${clientId}:`, err)
  }

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .upsert(
      {
        client_id: clientId,
        channel: 'whatsapp',
        // WhatsApp has no separate thread id — the wa_id IS the thread key.
        conversation_id: waId,
        participant_psid: waId,
        participant_name: participantName ?? null,
        ...(contactId ? { contact_id: contactId } : {}),
        // The message's own timestamp, not arrival time — a delayed delivery
        // must not jump the inbox ordering. Known edge: if Meta delivers an
        // older message after a newer one, this writes the older time. Making
        // that impossible needs a read-then-compare, which reintroduces the
        // race this upsert exists to remove; the ordering cost is smaller than
        // the dropped-message cost.
        last_message_at: sentAt,
        last_message_from: 'customer',
      },
      { onConflict: 'client_id,conversation_id' },
    )
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'failed to upsert conversation')
  const conversationId = data.id as string

  // Attribution is FIRST-touch, so this is a separate guarded write rather than
  // part of the upsert above: a customer who clicks a second ad weeks later
  // would otherwise have the original ad overwritten, which is exactly the
  // last-touch-wins failure lib/crm/identity.ts guards `first_attributed_at`
  // against. The `.is(null)` lives in the WHERE clause so concurrent deliveries
  // cannot race each other.
  if (referral) {
    const { error: refErr } = await supabaseAdmin
      .from('conversations')
      .update({ entry_referral: referral })
      .eq('id', conversationId)
      .is('entry_referral', null)
    if (refErr) {
      console.error(`[webhooks/whatsapp] entry_referral 写入失败（会话 ${conversationId}）:`, refErr.message)
    }
  }

  return { conversationId, contactId }
}

/**
 * File the inbound touch in the CRM, mirroring `advanceOutboundTouch` in
 * lib/messenger/link-contacts.ts (same idempotency key shape, same
 * create-then-advance pair).
 *
 * This is what actually puts a WhatsApp enquiry in front of a salesperson: the
 * 「今天该联系谁」 list is built from contact_touchpoints, so a thread stored
 * without one is a row nobody ever sees.
 */
async function recordInboundTouch(
  clientId: string,
  conversationId: string,
  contactId: string,
  at: string,
): Promise<void> {
  const sourceRef = `${conversationId}:in`
  const body = {
    summary: '客人在 WhatsApp 上说了话',
    metadata: { thread_id: conversationId, sender: 'customer' },
  }

  // Create if absent, never overwrite — an existing row is the earlier contact.
  await supabaseAdmin.from('contact_touchpoints').upsert(
    {
      client_id: clientId,
      contact_id: contactId,
      channel: 'whatsapp',
      direction: 'inbound',
      occurred_at: at,
      ...body,
      source: 'whatsapp',
      source_ref: sourceRef,
    },
    { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
  )

  // Then advance it, but only forwards — the WHERE clause is evaluated by the
  // database, so concurrent deliveries cannot walk the timestamp backwards.
  await supabaseAdmin
    .from('contact_touchpoints')
    .update({ occurred_at: at, ...body })
    .eq('client_id', clientId)
    .eq('source', 'whatsapp')
    .eq('source_ref', sourceRef)
    .lt('occurred_at', at)
}

/** Store one message. Throws so the caller can decide to retry the delivery. */
async function storeMessage(
  clientId: string,
  msg: WhatsAppInboundMessage,
  contactName: string | undefined,
): Promise<void> {
  const waId = msg.from
  if (!waId || !msg.id) return

  const sentAt = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString()

  const { conversationId, contactId } = await upsertConversation(
    clientId,
    waId,
    contactName,
    msg.referral,
    sentAt,
  )
  const media = extractMedia(msg)

  // Idempotent on (conversation_id, message_id) — the unique constraint carried
  // over from messenger_messages — so Meta's at-least-once redelivery cannot
  // duplicate a row.
  const { error: msgErr } = await supabaseAdmin.from('conversation_messages').upsert(
    {
      conversation_id: conversationId,
      message_id: msg.id,
      direction: 'inbound',
      sender_id: waId,
      sender_name: contactName ?? null,
      body: messageBody(msg),
      // Media id kept: Meta deletes the file after ~30 days and no API hands the
      // id back later, so dropping it loses the customer's attachment for good.
      ...(media ? { media_type: media.kind, media_id: media.media.id } : {}),
      sent_at: sentAt,
    },
    { onConflict: 'conversation_id,message_id' },
  )
  if (msgErr) throw new Error(`conversation_messages upsert failed: ${msgErr.message}`)

  // Without this the thread exists but never reaches 「今天该联系谁」. Best-effort:
  // the message is already durably stored, so a touchpoint failure must not make
  // Meta redeliver it — but it does mean a salesperson may not be prompted.
  if (contactId) {
    try {
      await recordInboundTouch(clientId, conversationId, contactId, sentAt)
    } catch (err) {
      console.error(`[webhooks/whatsapp] 记 CRM 触点失败（消息已入库，但可能不会出现在今日待办）:`, err)
    }
  }

  // Opt-out 检测（issue #1575 / #1582）：只判文本消息本身的整条内容，不是
  // messageBody() 拼过 `[image] ...` 这类前缀的展示用文案。best-effort（跟上面
  // 的 CRM 触点一样）——消息已经落库，退订判定写失败不该让 Meta 重投整条消息；
  // 代价是极端情况下这一条命中会被漏记，等下一条重复的退订消息（或人工核对）
  // 兜底，比因为这里失败而把已经存好的消息也标记成失败要小。
  if (isOptOutKeyword(msg.text?.body ?? '')) {
    try {
      if (contactId) {
        // 有 contact_id：走 optout.ts 的跨渠道写入路径（触点 + 反规范化镜像列）。
        await recordOptOutKeywordTouch(
          {
            clientId,
            contactId,
            channel: 'whatsapp',
            conversationId,
            messageId: msg.id,
            // 必须传消息真实的发送时间，不能让函数省略参数落到「现在」——
            // 那样 Meta 的 webhook 重投会让「晚于人工纠正」这个判断永远失效
            // （见 optout.ts 头部注释）。
            occurredAt: sentAt,
          },
          supabaseAdmin,
        )
      } else {
        // 没解析出 contact_id（resolveContact 是 best-effort，可能失败）：
        // optout.ts 假设 contact 已经存在，这条会话没有可查的联系人，退回
        // 会话级兜底列（issue #1574），不经过 optout.ts。
        const { error: unlinkedErr } = await supabaseAdmin
          .from('conversations')
          .update({ optout_unlinked: true })
          .eq('id', conversationId)
          .eq('client_id', clientId)
        if (unlinkedErr) {
          console.error(
            `[webhooks/whatsapp] 写 conversations.optout_unlinked 失败（会话 ${conversationId}）:`,
            unlinkedErr.message,
          )
          // 心跳检查（issue #1587）要能看到这次失败——否则会被误判成
          // 「没人退订、一切正常」。
          await recordOptOutWriteFailure(
            {
              clientId,
              channel: 'whatsapp',
              conversationId,
              contactId: null,
              errorMessage: unlinkedErr.message,
            },
            supabaseAdmin,
          )
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[webhooks/whatsapp] 退订触点写入失败（消息已入库）:`, err)
      await recordOptOutWriteFailure(
        {
          clientId,
          channel: 'whatsapp',
          conversationId,
          contactId: contactId ?? null,
          errorMessage: message,
        },
        supabaseAdmin,
      )
    }
  }

  // emit 渠道无关事件（issue #1582）：下游分类 / agent-core 靠这个事件驱动，
  // 不靠轮询。跟 CRM 触点一样 best-effort——消息已经落库，emit 失败不该让
  // Meta 重投整条已经存好的消息。
  try {
    await inngest.send({
      id: `whatsapp:${conversationId}:${msg.id}`,
      name: CONVERSATION_MESSAGE_RECEIVED_EVENT,
      data: {
        channel: 'whatsapp',
        client_id: clientId,
        conversation_id: conversationId,
        contact_id: contactId,
        message_id: msg.id,
        direction: 'inbound',
        sent_at: sentAt,
      },
    })
  } catch (err) {
    console.error(`[webhooks/whatsapp] emit ${CONVERSATION_MESSAGE_RECEIVED_EVENT} 失败（消息已入库）:`, err)
  }
}

/**
 * Resolve the client for a phone_number_id, then run `fn` with it. Keeps the
 * three "resolve then handle" branches in POST identical and short.
 *
 * Returns true when the change was handled (or was genuinely not applicable),
 * false when it produced a failure entry. `failures` is appended to in place.
 */
async function withClient(
  phoneNumberId: string,
  count: number,
  what: string,
  kind: UnclaimedKind,
  failures: string[],
  fn: (clientId: string) => Promise<void>,
  retryIfUnmapped = false,
): Promise<void> {
  const lookup = await resolveClientId(phoneNumberId)
  if (!lookup.ok) {
    if (lookup.kind === 'lookup_failed') {
      // Our fault, not Meta's: ask for redelivery rather than swallow it.
      console.error(
        `[webhooks/whatsapp] client lookup FAILED for phone_number_id=${phoneNumberId} ` +
          `— this is a lookup error, not an unmapped number: ${lookup.message}`,
      )
      failures.push(`lookup_failed:${phoneNumberId}`)
    } else {
      // Genuinely nobody owns this number. Retrying will not help, so this
      // must not hold up the delivery — but it is a real configuration hole
      // AND a real customer message being lost.
      //
      // TODO(#1331): the number is now registered in
      // `whatsapp_unclaimed_numbers` and surfaces as a to-do via
      // `lib/pm-todo/whatsapp-unclaimed-items.ts`, so it no longer dead-ends
      // in a log line (铁律 3 下半). The log line stays as the immediate
      // signal; the registry is what a human actually sees.
      await recordUnclaimedNumber(phoneNumberId, kind)
      console.error(
        `[webhooks/whatsapp] no client mapped to phone_number_id=${phoneNumberId} ` +
          `— ${count} ${what} dropped. Set clients.whatsapp_phone_number_id.`,
      )
      if (retryIfUnmapped) {
        // History is delivered exactly once, so a 200 here would lose it for
        // good. Hold it back (503) so Meta redelivers once someone binds the
        // number.
        console.error(
          `[webhooks/whatsapp] ${what} held back (503) until a client binds this number`,
        )
        failures.push(`unclaimed:${phoneNumberId}`)
      }
    }
    return
  }
  await fn(lookup.clientId)
}

/**
 * Handle a `history` change: store metadata-only rows into
 * `whatsapp_history_inbox`, refuse an unrecognised chunk shape, and acknowledge
 * media follow-ups without storing them.
 *
 * History is delivered exactly once, so anything we cannot store must produce a
 * failure entry (503) rather than a silent 200.
 */
async function handleHistory(
  change: Extract<ReturnType<typeof classifyInboundChanges>[number], { kind: 'history' }>,
  failures: string[],
): Promise<void> {
  const unrecognised = change.itemCount - change.chunks.length - change.mediaFollowUps
  if (unrecognised > 0) {
    console.error(
      '[webhooks/whatsapp] history chunk shape not recognised — refusing so Meta redelivers',
    )
    failures.push('history_unrecognised')
  }

  if (change.mediaFollowUps > 0) {
    console.log(
      `[webhooks/whatsapp] history media follow-up acknowledged but not stored (count=${change.mediaFollowUps})`,
    )
  }

  if (change.chunks.length > 0) {
    await withClient(
      change.phoneNumberId,
      change.chunks.length,
      'history chunk(s)',
      'history',
      failures,
      async (clientId) => {
        try {
          await storeHistoryChunks(
            clientId,
            { phoneNumberId: change.phoneNumberId, displayNumber: change.displayNumber },
            change.chunks,
          )
        } catch {
          console.error('[webhooks/whatsapp] history intake failed')
          failures.push('history_failed')
        }
      },
      true,
    )
  }
}

type RejectReason =
  | 'malformed_number'
  | 'mixed_apps'
  | 'disabled_number'
  | 'signature_mismatch'
  | 'lookup_unavailable'
  | 'secret_unreadable'

/**
 * Refuse a delivery AND leave one fixed-text line saying why. Before this, a rejected signature
 * was completely silent, so "Meta says it sent it, we show nothing" could not be diagnosed — the
 * usual cause is a number whose app secret we do not hold (it then falls back to the env secret).
 * The line carries only a reason code, which secret SOURCE was tried, a count and whether a
 * signature header was present — never a secret, a signature, a number, an id or any body text.
 */
function rejectionLine(
  reason: RejectReason,
  ctx: { source: 'route' | 'env' | 'none'; numbers: number; hasSignatureHeader: boolean },
): string {
  return (
    `[webhooks/whatsapp] delivery rejected: reason=${reason} secret_source=${ctx.source} ` +
    `numbers=${ctx.numbers} signature_header=${ctx.hasSignatureHeader ? 'present' : 'absent'}`
  )
}

function reject(
  reason: RejectReason,
  status: 401 | 503,
  ctx: { source: 'route' | 'env' | 'none'; numbers: number; hasSignatureHeader: boolean },
): NextResponse {
  logRejection(`${reason}:${ctx.source}`, rejectionLine(reason, ctx))
  const error = status === 503 ? 'Credential lookup unavailable' : 'Invalid signature'
  return NextResponse.json({ error }, { status })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // The phone_number_id list is read from the UNVERIFIED body only to decide
  // WHICH secret verifies it — nothing is processed unless that secret's
  // signature matches. Mixed or unknown mixes are rejected so one app's secret
  // can never vouch for another app's number. Never log secrets, signatures or
  // the body.
  const rawBody = await req.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  const signature = req.headers.get('x-hub-signature-256')
  const hasSignatureHeader = signature !== null

  const extracted = extractWebhookPhoneNumberIds(rawBody)
  if (!extracted.ok) {
    // Same body as a bad signature: do not hint at the reason to the caller (the log has it).
    return reject('malformed_number', 401, { source: 'none', numbers: 0, hasSignatureHeader })
  }
  const numbers = extracted.ids.length

  const choice = await chooseWebhookSecret(extracted.ids)

  let secret: string
  if (choice.kind === 'reject') {
    if (choice.reason === 'decrypt_failed') {
      // A server-side configuration fault (every delivery for these numbers fails): leave a trace too.
      logRejection(
        'secret_unreadable:route',
        rejectionLine('secret_unreadable', { source: 'route', numbers, hasSignatureHeader }),
      )
      return NextResponse.json(
        { error: 'Server misconfiguration: webhook secret unreadable' },
        { status: 500 },
      )
    }
    return reject(choice.reason === 'disabled_number' ? 'disabled_number' : 'mixed_apps', 401, {
      source: 'none',
      numbers,
      hasSignatureHeader,
    })
  } else if (choice.kind === 'route') {
    secret = choice.secret
  } else if (choice.kind === 'env') {
    const envSecret = process.env.META_APP_SECRET
    if (!envSecret) {
      return NextResponse.json({ error: 'Server misconfiguration: META_APP_SECRET not set' }, { status: 500 })
    }
    secret = envSecret
  } else {
    // lookup_failed. Only "the table is not deployed yet" may fall back to the env
    // secret (then no number can have its own secret, so the CTS number keeps
    // working). Any other failure fails closed: otherwise the env secret could
    // vouch for a number that has its own app secret.
    const envSecret = process.env.META_APP_SECRET
    if (!choice.tableMissing || !envSecret || !isValidSignature(rawBody, signature, envSecret)) {
      return reject('lookup_unavailable', 503, { source: 'env', numbers, hasSignatureHeader })
    }
    secret = envSecret
  }

  if (!isValidSignature(rawBody, signature, secret)) {
    return reject('signature_mismatch', 401, {
      source: choice.kind === 'route' ? 'route' : 'env',
      numbers,
      hasSignatureHeader,
    })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Every change is attempted independently: one bad change must not discard
  // the others in the same delivery. `failures` decides the status code below.
  let stored = 0
  const failures: string[] = []

  for (const change of classifyInboundChanges(payload)) {
    switch (change.kind) {
      case 'customer_messages': {
        await withClient(change.phoneNumberId, change.messages.length, 'message(s)', 'customer_messages', failures, async (clientId) => {
          for (const msg of change.messages) {
            try {
              await storeMessage(clientId, msg, change.contactName)
              stored++
            } catch (err) {
              console.error(`[webhooks/whatsapp] failed to store message ${msg.id}:`, err)
              failures.push(`store_failed:${msg.id ?? 'unknown'}`)
            }
          }
        })
        break
      }

      case 'echoes': {
        await withClient(change.phoneNumberId, change.echoes.length, 'staff-phone echo(es)', 'echoes', failures, async (clientId) => {
          for (const echo of change.echoes) {
            try {
              const result = await storeEcho(
                clientId,
                { phoneNumberId: change.phoneNumberId, displayNumber: change.displayNumber },
                echo,
              )
              if (result === 'stored') stored++
            } catch {
              console.error('[webhooks/whatsapp] echo store failed')
              failures.push('echo_failed')
            }
          }
        })
        break
      }

      case 'statuses': {
        // Only failures are reconciled; sent/delivered/read receipts must not cost a
        // client lookup (a lookup error would otherwise 503 a harmless receipt).
        const failed = change.statuses.filter((s) => s.status === 'failed')
        if (failed.length === 0) break
        await withClient(change.phoneNumberId, failed.length, 'failed-delivery receipt(s)', 'statuses', failures, async (clientId) => {
          for (const status of failed) {
            try {
              await applyFailedStatus(clientId, status)
            } catch {
              console.error('[webhooks/whatsapp] status update failed')
              failures.push('status_failed')
            }
          }
        })
        break
      }

      case 'history': {
        await handleHistory(change, failures)
        break
      }

      case 'malformed': {
        console.error(
          `[webhooks/whatsapp] malformed change ignored (field=${change.field}, reason=${change.reason})`,
        )
        break
      }

      case 'ignored': {
        break
      }
    }
  }

  // A 200 tells Meta "durably stored, never send this again". We only say that
  // when it is true. Non-200 triggers redelivery, which is the correct outcome
  // for a transient failure on our side — and the upserts above make replay safe.
  if (failures.length > 0) {
    return NextResponse.json(
      { received: false, stored, failed: failures.length },
      { status: 503 },
    )
  }

  return NextResponse.json({ received: true, stored }, { status: 200 })
}
