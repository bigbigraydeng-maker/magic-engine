/**
 * Meta Graph API — Page Messenger inbox (read-only).
 *
 * Mirrors the style of meta/comments.ts: thin fetch wrappers, graceful failure
 * (return [] / null and log rather than throw), Page access token passed in.
 *
 * Requires a Page Access Token with pages_messaging + pages_read_engagement.
 * The same token already powers sendPrivateReply() in meta/comments.ts, so a
 * client with working comment auto-reply should need no extra permission.
 *
 * Read-only by design: nothing here writes to Meta. Replies stay in the
 * Business Suite inbox / Business AI.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

/** How many Graph pages we will walk before giving up, per call. */
const MAX_PAGES = 20

export interface MessengerMessage {
  messageId: string
  /** 'inbound' = from the customer, 'outbound' = from the Page (human agent or Business AI). */
  direction: 'inbound' | 'outbound'
  senderId: string | null
  senderName: string | null
  body: string
  sentAt: string
  /**
   * Meta's `tags.data[].name` — folder + source-of-message markers. The only
   * signal that hints whether an outbound Page message was typed by a human in
   * the inbox (`source:chat`) or produced by an automation (instant reply / away
   * message / Business AI). Empty when Meta returns none. See lib/messenger/automation.
   */
  tags: string[]
}

export interface MessengerConversation {
  conversationId: string
  /** Page-scoped id of the customer. Null when Meta withholds the participant. */
  participantPsid: string | null
  participantName: string | null
  messageCount: number
  updatedTime: string
  messages: MessengerMessage[]
}

interface RawParticipant {
  id?: string
  name?: string
}

interface RawMessage {
  id?: string
  created_time?: string
  message?: string
  from?: { id?: string; name?: string }
  tags?: { data?: { name?: string }[] }
}

interface RawConversation {
  id?: string
  updated_time?: string
  message_count?: number
  participants?: { data?: RawParticipant[] }
  messages?: { data?: RawMessage[] }
}

interface GraphList<T> {
  data?: T[]
  paging?: { next?: string }
}

async function getJson<T>(url: string, label: string): Promise<T | null> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error(`[meta/conversations] ${label} network error:`, err)
    return null
  }
  if (!res.ok) {
    console.error(`[meta/conversations] ${label} HTTP ${res.status}:`, await res.text())
    return null
  }
  return (await res.json()) as T
}

function toMessage(raw: RawMessage, pageId: string): MessengerMessage | null {
  if (!raw.id || !raw.created_time) return null
  const senderId = raw.from?.id ?? null
  return {
    messageId: raw.id,
    direction: senderId === pageId ? 'outbound' : 'inbound',
    senderId,
    senderName: raw.from?.name ?? null,
    // Attachment-only messages carry no text; keep the row so ordering and
    // "who spoke last" stay correct, and mark it so the summariser sees it.
    body: raw.message ?? '[non-text message]',
    sentAt: raw.created_time,
    tags: (raw.tags?.data ?? []).map((t) => t.name).filter((n): n is string => !!n),
  }
}

/**
 * Fetch every message in one thread, oldest first.
 * Used when a thread has more messages than the nested field returned.
 */
export async function fetchConversationMessages(
  conversationId: string,
  pageId: string,
  pageAccessToken: string,
): Promise<MessengerMessage[]> {
  const params = new URLSearchParams({
    fields: 'id,created_time,message,from,tags',
    limit: '100',
    access_token: pageAccessToken,
  })
  let url: string | undefined = `${GRAPH_BASE}/${conversationId}/messages?${params.toString()}`
  const out: MessengerMessage[] = []

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const body: GraphList<RawMessage> | null = await getJson(url, 'fetchConversationMessages')
    if (!body) break
    for (const raw of body.data ?? []) {
      const msg = toMessage(raw, pageId)
      if (msg) out.push(msg)
    }
    url = body.paging?.next
  }

  return out.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}

/**
 * Fetch Messenger threads for a Page, most-recently-updated first.
 *
 * `updatedSince` short-circuits paging: Graph returns threads ordered by
 * updated_time descending, so the first thread at or before the watermark means
 * everything after it is already stored. Threads are still filtered
 * individually in case that ordering ever changes.
 */
export async function fetchPageConversations(
  pageId: string,
  pageAccessToken: string,
  updatedSince?: string,
): Promise<MessengerConversation[]> {
  const params = new URLSearchParams({
    platform: 'messenger',
    fields:
      'id,updated_time,message_count,participants,messages.limit(100){id,created_time,message,from,tags}',
    limit: '25',
    access_token: pageAccessToken,
  })
  let url: string | undefined = `${GRAPH_BASE}/${pageId}/conversations?${params.toString()}`
  const out: MessengerConversation[] = []

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const body: GraphList<RawConversation> | null = await getJson(url, 'fetchPageConversations')
    if (!body) break

    let reachedWatermark = false
    for (const raw of body.data ?? []) {
      if (!raw.id || !raw.updated_time) continue
      if (updatedSince && raw.updated_time <= updatedSince) {
        reachedWatermark = true
        continue
      }
      out.push(await buildConversation(raw, pageId, pageAccessToken))
    }

    if (reachedWatermark) break
    url = body.paging?.next
  }

  return out
}

async function buildConversation(
  raw: RawConversation,
  pageId: string,
  pageAccessToken: string,
): Promise<MessengerConversation> {
  const customer = (raw.participants?.data ?? []).find((p) => p.id && p.id !== pageId)
  const nested = (raw.messages?.data ?? [])
    .map((m) => toMessage(m, pageId))
    .filter((m): m is MessengerMessage => m !== null)

  const total = raw.message_count ?? nested.length
  // The nested field is capped, so re-fetch the thread when it truncated history.
  const messages =
    total > nested.length
      ? await fetchConversationMessages(raw.id!, pageId, pageAccessToken)
      : nested.sort((a, b) => a.sentAt.localeCompare(b.sentAt))

  return {
    conversationId: raw.id!,
    participantPsid: customer?.id ?? null,
    participantName: customer?.name ?? null,
    messageCount: total,
    updatedTime: raw.updated_time!,
    messages,
  }
}
