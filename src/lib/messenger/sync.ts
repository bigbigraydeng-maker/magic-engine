/**
 * Messenger inbox sync — pulls a client's Facebook Page threads into
 * conversations / conversation_messages.
 *
 * Step 1 of the Messenger → sales-brief pipeline. This module only stores the
 * raw conversation; summarising it into a needs card is a later step.
 *
 * Idempotent: threads key on (client_id, conversation_id) and messages on
 * (conversation_id, message_id), so re-running a window is safe.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { authorizePageSync } from '@/lib/meta/page-sync-authorization'
import { fetchPageConversations, type MessengerConversation } from '@/lib/meta/conversations'
import { linkMessengerConversation, loadIdentityIndex } from '@/lib/messenger/link-contacts'
import { backfillUnlinkedConversations } from '@/lib/messenger/backfill'
import { backfillLeadIntroDetails } from '@/lib/messenger/lead-intro-backfill'

export interface MessengerSyncClient {
  id: string
  name: string | null
  facebook_page_id: string | null
}

export interface MessengerSyncResult {
  clientId: string
  clientName: string | null
  /** Threads created or updated this run. */
  conversations: number
  /** Messages newly inserted this run. */
  messages: number
  /** Threads newly attached to a contact this run (matched or newly created). */
  linked: number
  /**
   * Contacts newly CREATED this run from a Facebook-only chatter (fb_psid, no
   * phone/email). Counted separately from `linked` because it is the number PM
   * actually asks about — "how many new people did Messenger bring in today".
   */
  created: number
  /**
   * Contacts created this run by sweeping OLD stored threads that were never
   * attached to anyone (see lib/messenger/backfill). Separate from `created`,
   * which only counts threads Meta returned as recently updated.
   */
  backfilled: number
  /** Stored threads still attached to nobody after this run's sweep. */
  backfillRemaining: number
  /** 这一轮翻过私信找开场白的人数（补电话邮箱用）。 */
  leadIntroScanned: number
  skipped?: 'no_page_id' | 'no_meta_token' | 'no_page_token' | 'page_not_verified'
  error?: string
}

/**
 * Re-sync a window of history rather than only what changed. Meta can backdate
 * updated_time, and a missed hour would otherwise be lost forever.
 */
const WATERMARK_LOOKBACK_MS = 6 * 60 * 60 * 1000

/**
 * Newest thread we have already stored, minus a lookback buffer.
 * Returns undefined on a first run so the full inbox is pulled.
 */
async function getWatermark(clientId: string): Promise<string | undefined> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('meta_updated_time')
    .eq('client_id', clientId)
    .not('meta_updated_time', 'is', null)
    .order('meta_updated_time', { ascending: false })
    .limit(1)
    .maybeSingle()

  const newest = data?.meta_updated_time
  if (!newest) return undefined
  return new Date(new Date(newest).getTime() - WATERMARK_LOOKBACK_MS).toISOString()
}

interface StoredConversation {
  /** conversations.id (UUID). */
  id: string
  /** Current contact_id on the row (null until linked). */
  contactId: string | null
  /** Messages newly inserted this run. */
  newMessages: number
}

/**
 * The fields on an existing `conversations` row that this sync and the
 * real-time Messenger webhook (`/api/webhooks/meta/messenger`, issue #1581)
 * both write. Fetched before the upsert so this cron — now the FALLBACK path,
 * not the authoritative one — can tell whether its own Graph API snapshot is
 * fresher than what the webhook already wrote.
 */
interface ExistingSummary {
  participantName: string | null
  lastMessageAt: string | null
}

async function loadExistingSummary(clientId: string, conversationId: string): Promise<ExistingSummary | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('participant_name, last_message_at')
    .eq('client_id', clientId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (!data) return null
  return {
    participantName: (data.participant_name as string | null) ?? null,
    lastMessageAt: (data.last_message_at as string | null) ?? null,
  }
}

/**
 * Store one thread and its messages.
 * Throws on the conversation upsert failing — the per-thread try/catch in the
 * caller isolates it so one bad thread never aborts the client's remaining threads.
 */
async function storeConversation(
  clientId: string,
  pageId: string,
  convo: MessengerConversation,
): Promise<StoredConversation> {
  const last = convo.messages[convo.messages.length - 1]
  const incomingLastMessageAt = last?.sentAt ?? null
  const incomingLastMessageFrom = last ? (last.direction === 'inbound' ? 'customer' : 'page') : null

  // 🔴 **webhook 权威、这条 cron 只兜底**（issue #1581，H14）：`participant_name` /
  // `last_message_at` / `last_message_from` 现在也由 `/api/webhooks/meta/messenger`
  // 实时写。这条 2 小时一轮的 Graph API 拉取如果照旧无条件覆盖，会把 webhook
  // 刚落的更新用一份更旧的快照冲掉——参照 whatsapp webhook 的 `entry_referral`
  // /`occurred_at` 那两处「只往前推」写法，这里同理：只在本轮数据比已存的新
  // （或者压根还没有）时才覆盖这三列；已存的行更新，就原样保留，只补
  // page_id/message_count/meta_updated_time/last_synced_at 这些 cron 独有的列。
  const existing = await loadExistingSummary(clientId, convo.conversationId)
  const existingTime = existing?.lastMessageAt ? new Date(existing.lastMessageAt).getTime() : null
  const incomingTime = incomingLastMessageAt ? new Date(incomingLastMessageAt).getTime() : null
  const shouldOverwriteLastMessage =
    !existing || existingTime === null || (incomingTime !== null && incomingTime > existingTime)

  const payload: Record<string, unknown> = {
    client_id: clientId,
    page_id: pageId,
    conversation_id: convo.conversationId,
    participant_psid: convo.participantPsid,
    message_count: convo.messageCount,
    meta_updated_time: convo.updatedTime,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (shouldOverwriteLastMessage) {
    payload.participant_name = convo.participantName
    payload.last_message_at = incomingLastMessageAt
    payload.last_message_from = incomingLastMessageFrom
  }

  const { data: row, error } = await supabaseAdmin
    .from('conversations')
    .upsert(payload, { onConflict: 'client_id,conversation_id' })
    // contact_id comes back so the linker knows whether this thread is already
    // attached to a person (upsert preserves it — we never send it here).
    .select('id, contact_id')
    .single()

  if (error || !row) {
    throw new Error(`conversation upsert failed: ${error?.message}`)
  }

  const base: StoredConversation = {
    id: row.id as string,
    contactId: (row.contact_id as string | null) ?? null,
    newMessages: 0,
  }

  if (convo.messages.length === 0) return base

  // ignoreDuplicates keeps already-stored messages untouched, so the returned
  // rows are exactly the ones that were new this run.
  const { data: inserted, error: msgError } = await supabaseAdmin
    .from('conversation_messages')
    .upsert(
      convo.messages.map((m) => ({
        conversation_id: row.id,
        message_id: m.messageId,
        direction: m.direction,
        sender_id: m.senderId,
        sender_name: m.senderName,
        body: m.body,
        sent_at: m.sentAt,
      })),
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')

  if (msgError) {
    // Messages are best-effort; the thread row is stored, so linking can still run.
    console.error('[messenger/sync] message upsert failed:', msgError)
    return base
  }

  return { ...base, newMessages: inserted?.length ?? 0 }
}

/**
 * Sync one client's Page inbox.
 * Never throws — a failure for one client must not abort the cron.
 */
export async function syncClientMessenger(
  client: MessengerSyncClient,
): Promise<MessengerSyncResult> {
  const base = {
    clientId: client.id,
    clientName: client.name,
    conversations: 0,
    messages: 0,
    linked: 0,
    created: 0,
    backfilled: 0,
    backfillRemaining: 0,
    leadIntroScanned: 0,
  }

  const pageId = client.facebook_page_id
  if (!pageId) return { ...base, skipped: 'no_page_id' }

  /**
   * 🔴 **本地补档案要跑在 Meta 凭证闸之前**（Codex 复审 2026-08-17）。
   *
   * 这一步**只读我们自己的数据库**（已经存下来的私信正文），跟 Meta 通不通没关系。
   * 原先放在函数末尾，于是 token 过期 / 没授权 / 换不到 Page token 的客户会在
   * 上面几行提前 return —— 他们的 CRM 卡片就一直缺着电话邮箱，而那些号码明明
   * 早就躺在消息表里。授权断掉的客户恰恰最需要这条本地路还在跑。
   *
   * 函数自己吞异常，失败不影响下面的同步。
   */
  const details = await backfillLeadIntroDetails(client.id)

  // AD-SEC-4: only a Page verified as this client's is read (page-sync-authorization.ts).
  // Token order is unchanged: a Page token stored by the "连接 Meta" button, else
  // one derived from an env-var user token — the gap that left 30 Kiteroa
  // skipping with `no_page_token` while its ads spent and its inbox filled up.
  const auth = await authorizePageSync(supabaseAdmin, client.id, pageId, process.env)
  if (!auth.ok) {
    if (auth.skipped !== 'page_not_verified') return { ...base, skipped: auth.skipped }
    // Reported as an error so the hourly run counts it as failed — a paused
    // inbox must not look like a quiet hour. The daily todo tells staff how to fix it.
    return { ...base, skipped: auth.skipped, error: `page_not_verified: ${auth.reason}` }
  }
  const pageToken = auth.pageToken

  try {
    const watermark = await getWatermark(client.id)
    const conversations = await fetchPageConversations(pageId, pageToken, watermark)

    // Load the client's identity index once so each thread matches in-memory
    // (no per-thread DB scan). Mutated in place as new psids get attached.
    const index = await loadIdentityIndex(client.id)

    let messages = 0
    let linked = 0
    let created = 0
    for (const convo of conversations) {
      // Per-thread isolation: a store/link failure on one thread must not abort
      // the client's remaining threads (adding throwing link logic to a shared
      // try would otherwise drop everything after the first bad thread).
      try {
        const stored = await storeConversation(client.id, pageId, convo)
        messages += stored.newMessages

        const last = convo.messages[convo.messages.length - 1]
        const res = await linkMessengerConversation(
          {
            clientId: client.id,
            conversationId: stored.id,
            psid: convo.participantPsid,
            participantName: convo.participantName,
            messageCount: convo.messageCount,
            lastMessageFrom: last ? (last.direction === 'inbound' ? 'customer' : 'page') : null,
            lastMessageAt: last?.sentAt ?? null,
            messages: convo.messages.map((m) => ({
              direction: m.direction,
              body: m.body,
              sentAt: m.sentAt,
              tags: m.tags,
            })),
            existingContactId: stored.contactId,
          },
          index,
        )
        if (res.linked) linked++
        if (res.created) created++
      } catch (err) {
        console.error(`[messenger/sync] thread ${convo.conversationId} failed:`, err)
      }
    }

    // 补挂历史：水位线只带回「最近更新过的」线程，早就聊完的老对话永远等不到
    // 一次重新处理。放在实时同步之后，且复用同一个 index（刚建的人已经在里面）。
    const sweep = await backfillUnlinkedConversations(client.id, index)


    return {
      ...base,
      conversations: conversations.length,
      messages,
      linked,
      created,
      backfilled: sweep.created,
      backfillRemaining: sweep.remaining,
      leadIntroScanned: details.scanned,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[messenger/sync] client ${client.id} failed:`, error)
    return { ...base, error }
  }
}
