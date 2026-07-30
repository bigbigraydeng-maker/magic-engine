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
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { fetchPageConversations, type MessengerConversation } from '@/lib/meta/conversations'
import { linkMessengerConversation, loadIdentityIndex } from '@/lib/messenger/link-contacts'

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
  skipped?: 'no_page_id' | 'no_meta_token' | 'no_page_token'
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

  const { data: row, error } = await supabaseAdmin
    .from('conversations')
    .upsert(
      {
        client_id: clientId,
        page_id: pageId,
        conversation_id: convo.conversationId,
        participant_psid: convo.participantPsid,
        participant_name: convo.participantName,
        message_count: convo.messageCount,
        meta_updated_time: convo.updatedTime,
        last_message_at: last?.sentAt ?? null,
        last_message_from: last ? (last.direction === 'inbound' ? 'customer' : 'page') : null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,conversation_id' },
    )
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
  }

  const pageId = client.facebook_page_id
  if (!pageId) return { ...base, skipped: 'no_page_id' }

  // Preferred: a Page token stored by the "连接 Meta" button. Falls back to
  // deriving one from an env-var user token, which only works when that
  // identity holds a role on the Page — the gap that left 30 Kiteroa skipping
  // with `no_page_token` while its ads spent and its inbox filled up.
  let pageToken = await getStoredPageToken(client.id, pageId)

  if (!pageToken) {
    const userToken = await getMetaTokenForClient(client.id)
    if (!userToken) return { ...base, skipped: 'no_meta_token' }
    pageToken = await getPageAccessToken(userToken, pageId)
  }

  if (!pageToken) return { ...base, skipped: 'no_page_token' }

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

    return { ...base, conversations: conversations.length, messages, linked, created }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[messenger/sync] client ${client.id} failed:`, error)
    return { ...base, error }
  }
}
