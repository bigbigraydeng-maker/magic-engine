/**
 * Sending a WhatsApp reply from ME, on behalf of a client's WhatsApp Business number.
 *
 * Mirrors `lib/messenger/send.ts` (that file's own header names itself the shape
 * every later adapter must follow) with one deliberate difference: the auth model.
 * Messenger tokens are per-client (client connected their own Page via OAuth).
 * WhatsApp numbers get shared into the Magic Engine business portfolio instead
 * (#1300 — client keeps owning the WABA, ME is only a granted user), so a single
 * ME-wide System User token can read/send across every shared number.
 *
 * ## Token resolution — per-number first, env only as a legacy fallback
 *
 * The token is resolved by `resolveWhatsAppCredentials` (see
 * `lib/whatsapp/credentials.ts`): it looks up the client's own WhatsApp
 * connection for this number in `platform_oauth_connections` (provider
 * 'whatsapp') first, and only when there is no such row falls back to the
 * legacy `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` env pair (and
 * only when the env number matches the number this client owns). A row that
 * exists but is non-active or has an unreadable token fails closed — it never
 * silently falls back to env.
 *
 * ## Sender identity — why this reads the DB and not just the env var
 *
 * `clients.whatsapp_phone_number_id` is the authority for which number belongs
 * to which client; `WHATSAPP_PHONE_NUMBER_ID` is only the credential telling us
 * which number this deployment holds a token for. When they disagree, the
 * conversation belongs to a client whose number we are not configured to send
 * from — sending anyway would deliver a message to client A's customer from
 * client B's number, with nothing in the stack reporting an error. The SOP's own
 * "changing the number means delete the old, add the new" procedure guarantees a
 * window where those two disagree, so this is a first-client problem, not a
 * second-client problem. **Fail closed.**
 *
 * ## Window scope — deliberately conservative (2026-09-02)
 *
 * WhatsApp actually has two free windows: the 24h customer-service window
 * (opens on any inbound message), and a 72h window opened by replying within
 * 24h to a conversation that started from an ad/CTA click. This file only
 * implements the 24h customer-service window. Skipping the 72h ad-window is
 * safe in the direction that matters: it only ever makes this code say
 * "template required" when a free send might actually have been available —
 * never the reverse (it will never claim something is free-and-open when
 * Meta would actually charge for it). Implementing the ad-window correctly
 * needs the inbound webhook's `referral` object captured somewhere queryable,
 * which no current caller needs yet — see #1300.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { resolveWhatsAppCredentials } from '@/lib/whatsapp/credentials'
import { isAutomatedActor } from '@/lib/crm/actors'

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

const HOUR_MS = 60 * 60 * 1000
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * HOUR_MS

/**
 * What goes in the shared `conversation_outbound_log.messaging_type` column.
 *
 * That column is shared across channels and has no CHECK constraint; Messenger
 * writes 'standard' / 'human_agent', which are Meta Messenger tag names and mean
 * nothing on WhatsApp. Writing the window kind ('open') there would put a third
 * vocabulary in one column and quietly break any report grouping by it. A
 * channel-qualified constant keeps the values self-describing.
 */
const WHATSAPP_MESSAGING_TYPE = 'whatsapp_cs_window'

export type WhatsAppWindow =
  | { kind: 'open'; msRemaining: number }
  | { kind: 'template_only'; msRemaining: 0 }

/**
 * Which sending window a WhatsApp thread is in, given when the customer last
 * wrote. Pure so the countdown shown on the card and the server-side gate
 * agree — same reason `messagingWindow` in `lib/messenger/send.ts` is pure.
 */
export function whatsappWindow(
  lastInboundAt: string | null,
  now: Date = new Date(),
): WhatsAppWindow {
  // No inbound message means the customer never wrote to this number, so
  // there is no free window — only pre-approved templates can open one.
  if (!lastInboundAt) return { kind: 'template_only', msRemaining: 0 }

  const elapsed = now.getTime() - new Date(lastInboundAt).getTime()
  if (elapsed < CUSTOMER_SERVICE_WINDOW_MS) {
    return { kind: 'open', msRemaining: CUSTOMER_SERVICE_WINDOW_MS - elapsed }
  }
  return { kind: 'template_only', msRemaining: 0 }
}

export interface SendWhatsAppInput {
  clientId: string
  conversationId: string
  body: string
  sentByEmail: string
  usedAiDraft: boolean
}

export type SendWhatsAppResult =
  | { ok: true; whatsappMessageId: string | null; window: WhatsAppWindow['kind'] }
  | {
      ok: false
      status: 400 | 403 | 404 | 409 | 424 | 502
      error: string
      reason:
        | 'not_found'
        | 'wrong_client'
        | 'wrong_channel'
        | 'empty_body'
        | 'window_closed'
        | 'no_token'
        | 'graph_failed'
    }

interface ConversationRow {
  id: string
  client_id: string
  channel: string
  /** Repurposed from Messenger's PSID meaning: for whatsapp-channel rows this
   *  holds the customer's `wa_id` (their WhatsApp-format phone number). Same
   *  TEXT column, same "per-channel customer identifier" role — reused rather
   *  than adding a whatsapp-specific column, matching how `page_id` was made
   *  nullable instead of adding a new identifier column per channel
   *  (20260726000004_unified_contacts.sql). */
  participant_psid: string | null
  contact_id: string | null
}

/** Most recent message the CUSTOMER sent — the clock the free window runs on. */
async function lastInboundAt(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversation_messages')
    .select('sent_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.sent_at as string | undefined) ?? null
}

async function postToGraph(
  phoneNumberId: string,
  accessToken: string,
  waId: string,
  body: string,
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const payload = {
    messaging_product: 'whatsapp',
    to: waId,
    type: 'text',
    text: { body },
  }

  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const text = await res.text()
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text}` }

  try {
    const parsed = JSON.parse(text) as { messages?: Array<{ id?: string }> }
    return { ok: true, messageId: parsed.messages?.[0]?.id ?? null }
  } catch {
    return { ok: true, messageId: null }
  }
}

export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  const body = input.body.trim()
  if (!body) {
    return { ok: false, status: 400, error: '回复内容不能为空', reason: 'empty_body' }
  }

  const { data: convo } = await supabaseAdmin
    .from('conversations')
    .select('id, client_id, channel, participant_psid, contact_id')
    .eq('id', input.conversationId)
    .maybeSingle<ConversationRow>()

  if (!convo) {
    return { ok: false, status: 404, error: '对话不存在', reason: 'not_found' }
  }

  if (convo.client_id !== input.clientId) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'wrong_client' }
  }

  if (convo.channel !== 'whatsapp') {
    return {
      ok: false,
      status: 409,
      error: '这条不是 WhatsApp 对话，不能在这里回',
      reason: 'wrong_channel',
    }
  }

  if (!convo.participant_psid) {
    return { ok: false, status: 409, error: '这条对话没有可回复的收件人', reason: 'window_closed' }
  }

  const window = whatsappWindow(await lastInboundAt(input.conversationId))
  if (window.kind === 'template_only') {
    return {
      ok: false,
      status: 409,
      error: 'WhatsApp 免费回复窗口已关闭（客户超过 24 小时未联系），只能发送已审核的模板消息',
      reason: 'window_closed',
    }
  }

  // Which number does this conversation's client actually own? Sending from a
  // number that belongs to a different client is the one failure here that
  // reaches a real customer wearing the wrong business's identity.
  const { data: owner, error: ownerErr } = await supabaseAdmin
    .from('clients')
    .select('whatsapp_phone_number_id')
    .eq('id', convo.client_id)
    .maybeSingle<{ whatsapp_phone_number_id: string | null }>()

  if (ownerErr) {
    return {
      ok: false,
      status: 424,
      error: 'WhatsApp 号码归属查不到，暂时不能发送，请稍后重试',
      reason: 'no_token',
    }
  }

  const ownedNumberId = owner?.whatsapp_phone_number_id ?? null
  if (!ownedNumberId) {
    return {
      ok: false,
      status: 424,
      error: '这个客户还没有绑定 WhatsApp 号码，不能发送',
      reason: 'no_token',
    }
  }

  // Resolve the token for THIS number: the client's own connection first, the
  // legacy env pair only as a fallback when the number matches. A non-active
  // or unreadable connection fails closed rather than falling back to env.
  const creds = await resolveWhatsAppCredentials(convo.client_id, ownedNumberId)
  if (!creds.ok) {
    return { ok: false, status: 424, error: creds.error, reason: 'no_token' }
  }
  const { accessToken, phoneNumberId } = creds.credentials

  // Audit BEFORE the send, and refuse to send if the audit row cannot be
  // written: this module speaks to a real customer as the client, so "who said
  // this" must always be answerable. A send with no audit row is worse than a
  // send that did not happen.
  const { data: audit, error: auditErr } = await supabaseAdmin
    .from('conversation_outbound_log')
    .insert({
      conversation_id: convo.id,
      client_id: convo.client_id,
      sent_by_email: input.sentByEmail,
      body,
      used_ai_draft: input.usedAiDraft,
      messaging_type: WHATSAPP_MESSAGING_TYPE,
      status: 'pending',
    })
    .select('id')
    .single()

  if (auditErr || !audit?.id) {
    return {
      ok: false,
      status: 502,
      error: '发送前的记录没写成功，为避免留下无法追溯的消息，这条没有发出去，请重试',
      reason: 'graph_failed',
    }
  }

  const auditId = audit.id as string
  const finish = async (patch: Record<string, unknown>) => {
    const { error } = await supabaseAdmin
      .from('conversation_outbound_log')
      .update(patch)
      .eq('id', auditId)
    if (error) {
      // The message may already be out; the audit row is now stuck on 'pending'.
      // Loud log so a reaper/alert can find it — never silent.
      console.error(`[whatsapp/send] 审计行 ${auditId} 更新失败（消息可能已发出）:`, error.message)
    }
  }

  const sent = await postToGraph(phoneNumberId, accessToken, convo.participant_psid, body)
  if (!sent.ok) {
    await finish({ status: 'failed', error_message: sent.error })
    return { ok: false, status: 502, error: 'Meta 拒绝了这条消息，请稍后重试', reason: 'graph_failed' }
  }

  await finish({ status: 'sent', meta_message_id: sent.messageId })

  // The customer already has this message. If the local copy fails to write,
  // the thread will look unanswered and someone will send it a second time —
  // so this failure has to be visible even though we cannot undo the send.
  const nowIso = new Date().toISOString()
  const { error: echoErr } = await supabaseAdmin.from('conversation_messages').insert({
    conversation_id: convo.id,
    message_id: sent.messageId ?? `me-${auditId}`,
    direction: 'outbound',
    sender_id: creds.credentials.phoneNumberId,
    sender_name: input.sentByEmail,
    body,
    sent_at: nowIso,
  })
  if (echoErr) {
    console.error(
      `[whatsapp/send] 消息已发给客人但没写进对话流（会话 ${convo.id}，审计 ${auditId}）：${echoErr.message}`,
    )
  }

  const { error: bumpErr } = await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: nowIso, last_message_from: 'page' })
    .eq('id', convo.id)
  if (bumpErr) {
    console.error(`[whatsapp/send] 会话 ${convo.id} 时间戳更新失败:`, bumpErr.message)
  }

  await markContactFollowedUp(convo, isAutomatedActor(input.sentByEmail))

  return { ok: true, whatsappMessageId: sent.messageId, window: window.kind }
}

/** 记 CRM 触点 —— 跟 `lib/messenger/send.ts` 里同名函数同一套幂等键逻辑，见那边的注释。 */
async function markContactFollowedUp(convo: ConversationRow, automated: boolean): Promise<void> {
  if (!convo.contact_id) return

  try {
    await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: convo.client_id,
        contact_id: convo.contact_id,
        channel: 'whatsapp',
        direction: 'outbound',
        occurred_at: new Date().toISOString(),
        summary: '我们在 WhatsApp 回复过',
        // 机器发的（自动安抚 / AI 起草经人批准发出）标 automated：CRM 不把它算成「有人联系过他」
        // （2026-10-22 PM）。人亲手发的不带这个键——同一个会话一行触点、upsert 会把旧的机器标记一并覆盖掉。
        metadata: { thread_id: convo.id, sender: 'page', ...(automated ? { automated: true } : {}) },
        source: 'whatsapp',
        source_ref: `${convo.id}:out`,
      },
      { onConflict: 'client_id,source,source_ref' },
    )
  } catch (err) {
    console.error('[whatsapp/send] 记 CRM 触点失败（不影响已发出的消息）:', err)
  }
}
