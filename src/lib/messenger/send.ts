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
import { loadMessengerSendGate } from '@/lib/crm/messenger-send-gate'
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
      reason:
        | 'not_found'
        | 'wrong_client'
        | 'wrong_channel'
        | 'empty_body'
        | 'window_closed'
        | 'do_not_contact'
        | 'dnc_review_required'
        | 'dnc_unknown'
        | 'no_token'
        | 'graph_failed'
    }

interface ConversationRow {
  id: string
  client_id: string
  page_id: string
  participant_psid: string | null
  channel: string
  /** 认领过的会话才挂得上人；没认领的是 null，那种情况不写触点。 */
  contact_id: string | null
}

/** Most recent message the CUSTOMER sent — the clock Meta's window runs on. */
async function lastInboundAt(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversation_messages')
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
    .from('conversations')
    // contact_id：发完之后要就地把卡片标成「今天联系过了」，见文件末尾。
    .select('id, client_id, page_id, participant_psid, channel, contact_id')
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

  // conversations 是四个渠道共用的表。走到这里的必须是私信 —— 否则我们会拿一封
  // 邮件的线程去调 Meta 的发送接口。没有 psid 时其实也发不出去，但那会报成
  // 「窗口关了」，把一个渠道用错说成一个时间问题，排查要绕一大圈。
  if (convo.channel !== 'messenger') {
    return {
      ok: false,
      status: 409,
      error: '这条不是 Facebook 私信，不能在这里回',
      reason: 'wrong_channel',
    }
  }

  if (!convo.participant_psid) {
    return { ok: false, status: 409, error: '这条对话没有可回复的收件人', reason: 'window_closed' }
  }

  if (convo.contact_id) {
    const gate = await loadMessengerSendGate(supabaseAdmin, {
      clientId: convo.client_id,
      contactId: convo.contact_id,
      conversationId: convo.id,
    })
    if (gate.kind === 'do_not_contact') {
      return {
        ok: false,
        status: 409,
        error: '他说过别再联系。判错了的话，先在客人卡片上点「放回名单」',
        reason: 'do_not_contact',
      }
    }
    if (gate.kind === 'review_required') {
      return {
        ok: false,
        status: 409,
        error: `客人可能要求停止联系，请先人工确认原话：${gate.quote}`,
        reason: 'dnc_review_required',
      }
    }
    if (gate.kind === 'unknown') {
      return {
        ok: false,
        status: 409,
        error: '暂时查不到他能不能联系，请稍后再试',
        reason: 'dnc_unknown',
      }
    }
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
    .from('conversation_outbound_log')
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
    if (audit?.id) await supabaseAdmin.from('conversation_outbound_log').update(patch).eq('id', audit.id)
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
  await supabaseAdmin.from('conversation_messages').insert({
    conversation_id: convo.id,
    message_id: sent.messageId ?? `me-${audit?.id ?? Date.now()}`,
    direction: 'outbound',
    sender_id: convo.page_id,
    sender_name: input.sentByEmail,
    body,
    sent_at: new Date().toISOString(),
  })

  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), last_message_from: 'page' })
    .eq('id', convo.id)

  await markContactFollowedUp(convo)

  return { ok: true, metaMessageId: sent.messageId, window: window.kind }
}

/**
 * 在 CRM 那一侧记一笔「我们回过他了」。
 *
 * ## 为什么非要在这里写
 *
 * 「今天该联系谁」判断卡片灰不灰，看的是 `contact_touchpoints` 里今天有没有
 * 一笔我们发出的、真人做的联系。而 Messenger 的出站触点**只有每小时那次同步
 * 才会写**（`link-contacts`）—— 于是销售在页面里回完一条私信，那张卡最长
 * 一小时不变灰。
 *
 * 那正是 PM 2026-08-05 抱怨的毛病本身（「做了动作回到目录页，我如何知道哪个
 * 已经联系了」），只是换了个渠道：他会以为没记上，再回一遍。
 *
 * ## 为什么用跟同步完全一样的那一行
 *
 * `source_ref` 用 `<会话 id>:out`、`source` 用 `messenger` —— **跟
 * `link-contacts` 写的是同一个幂等键**。于是这一笔和之后每小时那次同步
 * 落在同一行上（`ON CONFLICT DO UPDATE` 刷新时间），永远只有一条。
 *
 * 换个新键的话，同一段对话会同时存在「我写的每条一行」和「同步写的汇总一行」，
 * 任何按触点条数做的统计当场失真 —— 而这张表已经有人在按渠道聚合了。
 *
 * ## 失败不影响发送
 *
 * 话已经发出去了，为一条记录把整个请求判失败，只会让销售再发一遍
 * （客人就收到两条）。这里跟 snooze 路由那条**刻意相反**：那边的记录是
 * 名单正确性的必要条件，这边只是让卡片早一点变灰 —— 最坏结果是等下一次同步，
 * 也就是改动前的行为。
 */
async function markContactFollowedUp(convo: ConversationRow): Promise<void> {
  // 没认领的会话挂不到人（`contact_id` 为空）—— 没有人可标，跳过。
  if (!convo.contact_id) return

  try {
    await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: convo.client_id,
        contact_id: convo.contact_id,
        channel: 'messenger',
        direction: 'outbound',
        occurred_at: new Date().toISOString(),
        summary: '我们在 Messenger 回复过',
        metadata: { thread_id: convo.id, sender: 'page' },
        source: 'messenger',
        source_ref: `${convo.id}:out`,
      },
      { onConflict: 'client_id,source,source_ref' },
    )
  } catch (err) {
    console.error('[messenger/send] 记 CRM 触点失败（不影响已发出的消息）:', err)
  }
}
