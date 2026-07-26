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
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { fetchPageConversations, type MessengerConversation } from '@/lib/meta/conversations'

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

/** Store one thread and its messages. Returns how many messages were new. */
async function storeConversation(
  clientId: string,
  pageId: string,
  convo: MessengerConversation,
): Promise<number> {
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
    .select('id')
    .single()

  if (error || !row) {
    console.error('[messenger/sync] conversation upsert failed:', error)
    return 0
  }

  if (convo.messages.length === 0) return 0

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
    console.error('[messenger/sync] message upsert failed:', msgError)
    return 0
  }

  return inserted?.length ?? 0
}

/**
 * Sync one client's Page inbox.
 * Never throws — a failure for one client must not abort the cron.
 */
export async function syncClientMessenger(
  client: MessengerSyncClient,
): Promise<MessengerSyncResult> {
  const base = { clientId: client.id, clientName: client.name, conversations: 0, messages: 0 }

  const pageId = client.facebook_page_id
  if (!pageId) return { ...base, skipped: 'no_page_id' }

  const userToken = await getMetaTokenForClient(client.id)
  if (!userToken) return { ...base, skipped: 'no_meta_token' }

  const pageToken = await getPageAccessToken(userToken, pageId)
  if (!pageToken) return { ...base, skipped: 'no_page_token' }

  try {
    const watermark = await getWatermark(client.id)
    const conversations = await fetchPageConversations(pageId, pageToken, watermark)

    let messages = 0
    for (const convo of conversations) {
      messages += await storeConversation(client.id, pageId, convo)
    }

    return { ...base, conversations: conversations.length, messages }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[messenger/sync] client ${client.id} failed:`, error)
    return { ...base, error }
  }
}
