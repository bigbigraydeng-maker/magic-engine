/**
 * Sending a Messenger reply from ME, on behalf of a client's Page.
 *
 * This is the only place in the codebase that speaks to a real customer as the
 * client. Three things are therefore non-negotiable here:
 *
 *   1. ISOLATION — the caller has already been proven to act for `clientId`, but
 *      the conversation id comes from the request. It is re-checked against
 *      client_id here so a CTS login can never post into another client's thread.
 *   2. AUDIT — a row is written BEFORE the Graph call and updated after, so a
 *      send that crashes mid-flight still leaves a trace of who tried what.
 *   3. WINDOW — Meta only allows a free-form reply within 24h of the customer's
 *      last message, then 7 days under the human-agent tag, then nothing. We
 *      refuse rather than let Meta reject it with an opaque error.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

const HOUR_MS = 60 * 60 * 1000
export const STANDARD_WINDOW_MS = 24 * HOUR_MS
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * HOUR_MS

export type MessagingWindow =
  | { kind: 'standard'; msRemaining: number }
  | { kind: 'human_agent'; msRemaining: number }
  | { kind: 'closed'; msRemaining: 0 }

/**
 * Which sending window a thread is in, given when the customer last wrote.
 * Pure so the countdown shown on the card and the server-side gate agree.
 */
export function messagingWindow(
  lastInboundAt: string | null,
  now: Date = new Date(),
): MessagingWindow {
  // No inbound message means the customer never opened a conversation with us,
  // so there is no window to reply inside.
  if (!lastInboundAt) return { kind: 'closed', msRemaining: 0 }

  const elapsed = now.getTime() - new Date(lastInboundAt).getTime()
  if (elapsed < STANDARD_WINDOW_MS) {
    return { kind: 'standard', msRemaining: STANDARD_WINDOW_MS - elapsed }
  }
  if (elapsed < HUMAN_AGENT_WINDOW_MS) {
    return { kind: 'human_agent', msRemaining: HUMAN_AGENT_WINDOW_MS - elapsed }
  }
  return { kind: 'closed', msRemaining: 0 }
}

export interface SendReplyInput {
  clientId: string
  conversationId: string
  body: string
  sentByEmail: string
  usedAiDraft: boolean
}

export type SendReplyResult =
  | { ok: true; metaMessageId: string | null; window: MessagingWindow['kind'] }
  | {
      ok: false
      status: 400 | 403 | 404 | 409 | 424 | 502
      error: string
      reason: 'not_found' | 'wrong_client' | 'empty_body' | 'window_closed' | 'no_token' | 'graph_failed'
    }

interface ConversationRow {
  id: string
  client_id: string
  page_id: string
  participant_psid: string | null
}

/** Most recent message the CUSTOMER sent — the clock Meta's window runs on. */
async function lastInboundAt(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('messenger_messages')
    .select('sent_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.sent_at ?? null
}

async function postToGraph(
  pageId: string,
  pageToken: string,
  psid: string,
  body: string,
  window: MessagingWindow['kind'],
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = {
    recipient: { id: psid },
    message: { text: body },
    ...(window === 'human_agent'
      ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }
      : { messaging_type: 'RESPONSE' }),
  }

  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${pageId}/messages?access_token=${encodeURIComponent(pageToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const text = await res.text()
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text}` }

  try {
    return { ok: true, messageId: (JSON.parse(text) as { message_id?: string }).message_id ?? null }
  } catch {
    return { ok: true, messageId: null }
  }
}

export async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  const body = input.body.trim()
  if (!body) {
    return { ok: false, status: 400, error: '回复内容不能为空', reason: 'empty_body' }
  }

  const { data: convo } = await supabaseAdmin
    .from('messenger_conversations')
    .select('id, client_id, page_id, participant_psid')
    .eq('id', input.conversationId)
    .maybeSingle<ConversationRow>()

  if (!convo) {
    return { ok: false, status: 404, error: '对话不存在', reason: 'not_found' }
  }

  // The caller proved they may act for input.clientId; the conversation id came
  // from the request and must be proven to belong to that same client.
  if (convo.client_id !== input.clientId) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'wrong_client' }
  }

  if (!convo.participant_psid) {
    return { ok: false, status: 409, error: '这条对话没有可回复的收件人', reason: 'window_closed' }
  }

  const window = messagingWindow(await lastInboundAt(input.conversationId))
  if (window.kind === 'closed') {
    return {
      ok: false,
      status: 409,
      error: 'Messenger 回复窗口已关闭（客户超过 7 天未联系），请改用电话或邮件',
      reason: 'window_closed',
    }
  }

  const { data: audit } = await supabaseAdmin
    .from('messenger_outbound_log')
    .insert({
      conversation_id: convo.id,
      client_id: convo.client_id,
      sent_by_email: input.sentByEmail,
      body,
      used_ai_draft: input.usedAiDraft,
      messaging_type: window.kind,
      status: 'pending',
    })
    .select('id')
    .single()

  const finish = async (patch: Record<string, unknown>) => {
    if (audit?.id) await supabaseAdmin.from('messenger_outbound_log').update(patch).eq('id', audit.id)
  }

  const userToken = await getMetaTokenForClient(convo.client_id)
  const pageToken = userToken ? await getPageAccessToken(userToken, convo.page_id) : null
  if (!pageToken) {
    await finish({ status: 'failed', error_message: 'no page access token' })
    return { ok: false, status: 424, error: 'Meta 授权未配置，无法发送', reason: 'no_token' }
  }

  const sent = await postToGraph(convo.page_id, pageToken, convo.participant_psid, body, window.kind)
  if (!sent.ok) {
    await finish({ status: 'failed', error_message: sent.error })
    return { ok: false, status: 502, error: 'Meta 拒绝了这条消息，请稍后重试', reason: 'graph_failed' }
  }

  await finish({ status: 'sent', meta_message_id: sent.messageId })

  // Write the message straight into the thread so the card is correct
  // immediately, instead of looking unanswered until the next hourly sync.
  await supabaseAdmin.from('messenger_messages').insert({
    conversation_id: convo.id,
    message_id: sent.messageId ?? `me-${audit?.id ?? Date.now()}`,
    direction: 'outbound',
    sender_id: convo.page_id,
    sender_name: input.sentByEmail,
    body,
    sent_at: new Date().toISOString(),
  })

  await supabaseAdmin
    .from('messenger_conversations')
    .update({ last_message_at: new Date().toISOString(), last_message_from: 'page' })
    .eq('id', convo.id)

  return { ok: true, metaMessageId: sent.messageId, window: window.kind }
}
