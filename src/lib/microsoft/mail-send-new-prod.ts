/**
 * `sendMailNew` 的真实实现：数据库（supabaseAdmin）+ Microsoft Graph。
 * 编排与所有闸在 `mail-send-new.ts`，这里只做「怎么读、怎么写、怎么调 Graph」。
 * 设计稿：docs/specs/2026-10-21-crm-send-first-email-design-v0.md
 */

import { createHash, randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { createSendGatesProd } from '@/lib/crm/email-templates/send-gates-prod'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'
import { checkManualSendDncForContact } from '@/lib/crm/manual-send-dnc-gate'
import type { TouchKind } from '@/lib/crm/email-compose/enquiry-record'
import { GRAPH, callWithRetry, writeTouchpoint, type GraphCallResult } from '@/lib/microsoft/mail-send'
import {
  requestIdFromMeta,
  type GraphSendOutcome,
  type MailNewDeps,
  type MailNewGraph,
  type MailNewStore,
  type PendingDraft,
  type PriorSend,
} from '@/lib/microsoft/mail-send-new'

const LOCK_STALE_MS = 5 * 60_000
const UNIQUE_VIOLATION = '23505'
const GRAPH_TIMEOUT_MS = 15_000

const lockKey = (contactId: string): string => `mail-lock:${contactId}`
// A contact id is a uuid, so "to:" can never collide with a contact lock. conversations is unique on (client_id, conversation_id).
// The address is hashed: a lock row that outlives a crashed request must not leave a guest's address lying in `conversations`.
export const recipientLockKey = (recipient: string): string =>
  `mail-lock:to:${createHash('sha256').update(recipient.trim().toLowerCase()).digest('hex')}`

function metaPart(meta: string | null, kind: 'draft' | 'msg'): string | null {
  const m = new RegExp(`\\|${kind}:(.+)$`).exec(meta ?? '')
  return m ? m[1] : null
}

export function createMailNewStore(): MailNewStore {
  const db = supabaseAdmin
  // Lock tokens of this store instance (one per request): release only deletes OUR lock row.
  const lockTokens = new Map<string, string>()

  async function takeLock(clientId: string, key: string, mailbox: string): Promise<boolean> {
    await db.from('conversations').delete().eq('client_id', clientId).eq('conversation_id', key).lt('created_at', new Date(Date.now() - LOCK_STALE_MS).toISOString())
    // The subject column of a lock row carries a random token. If a send outlives LOCK_STALE_MS and another request
    // takes the lock over, our release must not delete theirs.
    const token = randomUUID()
    const { error } = await db.from('conversations').insert({ client_id: clientId, channel: 'email', page_id: mailbox, conversation_id: key, subject: token })
    if (!error) {
      lockTokens.set(key, token)
      return true
    }
    if (error.code === UNIQUE_VIOLATION) return false
    throw new Error(error.message)
  }

  async function dropLock(clientId: string, key: string): Promise<void> {
    const token = lockTokens.get(key)
    lockTokens.delete(key)
    if (token === undefined) return // this store instance never took the lock, so there is nothing of ours to delete
    await db.from('conversations').delete().eq('client_id', clientId).eq('conversation_id', key).eq('subject', token)
  }

  return {
    loadSettings: (clientId) => loadEmailSettings(db, clientId),
    async loadLeadsConfig(clientId) {
      const { data, error } = await db.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
      if (error) throw new Error(error.message)
      return (data as { leads_config: unknown } | null)?.leads_config ?? null
    },
    checkDnc: (clientId, contactId) => checkManualSendDncForContact(clientId, contactId),
    async loadContact(clientId, contactId) {
      const { data } = await db.from('contacts').select('id, primary_email').eq('id', contactId).eq('client_id', clientId).maybeSingle()
      const row = data as { id: string; primary_email: string | null } | null
      return row ? { id: row.id, primaryEmail: row.primary_email } : null
    },
    async loadIdentityEmails(clientId, contactId) {
      const { data } = await db.from('contact_identities').select('value').eq('contact_id', contactId).eq('client_id', clientId).eq('kind', 'email')
      return ((data as Array<{ value: string }> | null) ?? []).map((r) => r.value)
    },
    async loadTouchKinds(clientId, contactId) {
      const { data, error } = await db.from('contact_touchpoints').select('channel, source, direction').eq('contact_id', contactId).eq('client_id', clientId)
      if (error) throw new Error(error.message)
      return (data as TouchKind[] | null) ?? []
    },
    async listActiveMailboxes(clientId) {
      const { data } = await db
        .from('platform_oauth_connections')
        .select('id, account_id')
        .eq('client_id', clientId)
        .eq('provider', MICROSOFT_MAIL_PROVIDER)
        .eq('status', CONNECTION_STATUS.ACTIVE)
      return ((data as Array<{ id: string; account_id: string }> | null) ?? []).map((r) => ({ connectionId: r.id, account: r.account_id.toLowerCase() }))
    },
    async findPriorSend(clientId, requestId, contactId): Promise<PriorSend | null> {
      const { data, error: priorError } = await db
        .from('conversation_outbound_log')
        .select('id, status, meta_message_id, conversation_id')
        .eq('client_id', clientId)
        .like('meta_message_id', `req:${requestId}%`)
        .limit(5)
      // A failed lookup is NOT "nothing was sent before": answering that way would let a retry send the mail again.
      if (priorError) throw new Error(`findPriorSend: ${priorError.message}`)
      const rows = (data as Array<{ id: string; status: 'pending' | 'sent' | 'failed'; meta_message_id: string | null; conversation_id: string }> | null) ?? []
      if (rows.length === 0) return null
      // Only a send into THIS contact's own conversation counts; a request id reused for another contact is not "already sent".
      const { data: own, error: ownError } = await db
        .from('conversations')
        .select('id')
        .eq('client_id', clientId)
        .eq('contact_id', contactId)
        .in('id', rows.map((r) => r.conversation_id))
      if (ownError) throw new Error(`findPriorSend: ${ownError.message}`)
      const mine = new Set(((own as Array<{ id: string }> | null) ?? []).map((c) => c.id))
      const row = rows.find((r) => mine.has(r.conversation_id))
      if (!row) return null
      return { auditId: row.id, status: row.status, messageId: metaPart(row.meta_message_id, 'msg'), conversationId: row.conversation_id }
    },
    async listPendingDrafts(clientId, contactId): Promise<PendingDraft[]> {
      const { data: convos } = await db.from('conversations').select('id').eq('client_id', clientId).eq('contact_id', contactId).eq('channel', 'email')
      const ids = ((convos as Array<{ id: string }> | null) ?? []).map((c) => c.id)
      if (ids.length === 0) return []
      const { data } = await db
        .from('conversation_outbound_log')
        .select('id, meta_message_id, created_at')
        .in('conversation_id', ids)
        .eq('messaging_type', 'email')
        .eq('status', 'pending')
        .like('meta_message_id', '%|draft:%')
      const out: PendingDraft[] = []
      for (const r of (data as Array<{ id: string; meta_message_id: string | null; created_at: string }> | null) ?? []) {
        const draftId = metaPart(r.meta_message_id, 'draft')
        if (draftId) out.push({ auditId: r.id, draftId, createdAt: r.created_at, requestId: requestIdFromMeta(r.meta_message_id) })
      }
      return out
    },
    async countUsage(clientId, sentByEmail) {
      const since = (ms: number): string => new Date(Date.now() - ms).toISOString()
      const count = async (extra: (q: ReturnType<typeof base>) => ReturnType<typeof base>, ms: number): Promise<number> => {
        const { count: n } = await extra(base()).gte('created_at', since(ms))
        return n ?? 0
      }
      const base = () =>
        db
          .from('conversation_outbound_log')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('messaging_type', 'email')
          .in('status', ['pending', 'sent'])
      const [userLastHour, userLastDay, mailboxLastDay] = await Promise.all([
        count((q) => q.eq('sent_by_email', sentByEmail), 3_600_000),
        count((q) => q.eq('sent_by_email', sentByEmail), 86_400_000),
        // 审计行不记邮箱；一个客户通常只有一个发信邮箱，所以按客户当天总量算（偏保守）。
        count((q) => q, 86_400_000),
      ])
      return { userLastHour, userLastDay, mailboxLastDay }
    },
    async countRecentEmailsToContact(clientId, contactId, days) {
      const { count } = await db
        .from('contact_touchpoints')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('contact_id', contactId)
        .eq('channel', 'email')
        .eq('direction', 'outbound')
        .gte('occurred_at', new Date(Date.now() - days * 86_400_000).toISOString())
      return count ?? 0
    },
    acquireContactLock: (clientId, contactId, mailbox) => takeLock(clientId, lockKey(contactId), mailbox),
    releaseContactLock: (clientId, contactId) => dropLock(clientId, lockKey(contactId)),
    acquireRecipientLock: (clientId, recipient, mailbox) => takeLock(clientId, recipientLockKey(recipient), mailbox),
    releaseRecipientLock: (clientId, recipient) => dropLock(clientId, recipientLockKey(recipient)),
    async claimConversation({ clientId, contactId, requestId, mailbox, subject }) {
      const { data, error } = await db
        .from('conversations')
        .insert({ client_id: clientId, channel: 'email', page_id: mailbox, conversation_id: `mail-pending:${requestId}`, contact_id: contactId, subject })
        .select('id')
        .single()
      if (error?.code === UNIQUE_VIOLATION) return { kind: 'taken' }
      if (error || !data) return { kind: 'error' }
      return { kind: 'claimed', conversationId: (data as { id: string }).id }
    },
    async insertAudit({ clientId, conversationId, sentByEmail, body, requestId }) {
      const { data, error } = await db
        .from('conversation_outbound_log')
        .insert({ conversation_id: conversationId, client_id: clientId, sent_by_email: sentByEmail, body, used_ai_draft: false, messaging_type: 'email', status: 'pending', meta_message_id: `req:${requestId}` })
        .select('id')
        .single()
      if (error || !data) {
        console.error('[mail-send-new] 发送审计写不进去，拒发:', conversationId, error)
        return null
      }
      return (data as { id: string }).id
    },
    async patchAudit(auditId, patch) {
      const update: Record<string, unknown> = {}
      if (patch.status) update.status = patch.status
      if (patch.metaMessageId) update.meta_message_id = patch.metaMessageId
      if (patch.errorMessage) update.error_message = patch.errorMessage
      const { error } = await db.from('conversation_outbound_log').update(update).eq('id', auditId)
      if (error) console.error('[mail-send-new] 回填发送审计失败:', auditId, error.message)
    },
    async rekeyConversation(conversationId, newKey) {
      const { error } = await db.from('conversations').update({ conversation_id: newKey, updated_at: new Date().toISOString() }).eq('id', conversationId)
      return !error
    },
    async discardConversation(conversationId) {
      // 已有审计行引用它时删不掉，那就留着（/email 路由只认有入站消息的会话，不会误判有线程）。
      await db.from('conversations').delete().eq('id', conversationId)
    },
    async recordSent({ clientId, contactId, conversationId, messageId, sentByEmail, body }) {
      await db.from('conversation_messages').insert({ conversation_id: conversationId, message_id: messageId, direction: 'outbound', sender_name: sentByEmail, body, sent_at: new Date().toISOString() })
      // 不推 last_message_at：它是同步水位线（mail-ingest getMailWatermark），发信路径不去碰。
      await db.from('conversations').update({ last_message_from: 'page' }).eq('id', conversationId)
      await writeTouchpoint(clientId, contactId, messageId, body)
    },
  }
}

const PREFER = { Prefer: 'IdType="ImmutableId"' }

async function graphJson<T>(token: string, path: string, init: RequestInit, timeoutMs = GRAPH_TIMEOUT_MS): Promise<GraphCallResult<T>> {
  let res: Response
  try {
    res = await fetch(`${GRAPH}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`, ...PREFER, ...(init.headers ?? {}) },
    })
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}` }
  return { ok: true, value: (await res.json().catch(() => ({}))) as T }
}

/**
 * Send a draft. 202 = accepted. Same contract as the shared `sendDraft`, but with a time limit: a hung call must not
 * hold the contact lock for minutes. A timeout comes back as status 0, which the caller reports as "outcome unknown"
 * (the mail may well have gone out) — never as a failure.
 */
async function sendDraftWithTimeout(token: string, draftId: string, timeoutMs: number): Promise<GraphCallResult<null>> {
  let res: Response
  try {
    res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draftId)}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...PREFER },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
  if (res.status === 202) return { ok: true, value: null }
  const text = await res.text().catch(() => '')
  return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }
}

export function createMailNewGraph(opts: { timeoutMs?: number } = {}): MailNewGraph {
  const timeoutMs = opts.timeoutMs ?? GRAPH_TIMEOUT_MS
  return {
    async whoAmI(connectionId) {
      const r = await callWithRetry(connectionId, (t) => graphJson<{ mail?: string; userPrincipalName?: string }>(t, '/me?$select=mail,userPrincipalName', { method: 'GET' }, timeoutMs))
      if (!r.ok) return null
      const a = r.value.mail ?? r.value.userPrincipalName
      return a ? a.toLowerCase() : null
    },
    async createDraft(connectionId, { to, subject, body }) {
      const payload = { subject, body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: to } }] }
      const r = await callWithRetry(connectionId, (t) => graphJson<{ id?: string; conversationId?: string }>(t, '/me/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, timeoutMs))
      if (!r.ok) return { error: r.error }
      if (!r.value.id || !r.value.conversationId) return { error: '建草稿成功但没拿到消息 id / conversationId' }
      return { id: r.value.id, conversationId: r.value.conversationId }
    },
    async sendDraft(connectionId, draftId): Promise<GraphSendOutcome> {
      const r = await callWithRetry(connectionId, (t) => sendDraftWithTimeout(t, draftId, timeoutMs))
      if (r.ok) return 'sent'
      // 超时 / 网络错误 / 5xx：信可能已经发走，不能当失败。
      if (r.status === 0 || r.status >= 500) return 'unknown'
      return 'rejected'
    },
    async deleteDraft(connectionId, draftId) {
      await callWithRetry(connectionId, async (t) => {
        const res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draftId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(timeoutMs) }).catch(() => null)
        return res && (res.ok || res.status === 404) ? { ok: true as const, value: null } : { ok: false as const, status: res?.status ?? 0, error: 'delete draft failed' }
      })
    },
    async isStillDraft(connectionId, messageId) {
      const r = await callWithRetry(connectionId, (t) => graphJson<{ isDraft?: boolean }>(t, `/me/messages/${encodeURIComponent(messageId)}?$select=isDraft`, { method: 'GET' }, timeoutMs))
      if (!r.ok || typeof r.value.isDraft !== 'boolean') return null
      return r.value.isDraft
    },
  }
}

/** One page of a Graph list, for the sent-items scan behind the per-guest cap. Only follows links on the Graph host. */
export async function graphGetPage(
  connectionId: string,
  pathOrUrl: string,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  let path: string
  if (pathOrUrl.startsWith(`${GRAPH}/`)) path = pathOrUrl.slice(GRAPH.length)
  else if (pathOrUrl.startsWith('/') && !pathOrUrl.startsWith('//')) path = pathOrUrl
  else return { ok: false, error: 'refusing to follow a link outside Microsoft Graph' }
  const result = await callWithRetry(connectionId, (token) => graphJson<unknown>(token, path, { method: 'GET' }))
  return result.ok ? { ok: true, json: result.value } : { ok: false, error: result.error }
}

/** Pass the client id to get the template-era gates (they are scoped to that one client). */
export function createMailNewDeps(clientId?: string): MailNewDeps {
  const store = createMailNewStore()
  const deps: MailNewDeps = { store, graph: createMailNewGraph() }
  if (clientId !== undefined) {
    deps.gates = createSendGatesProd({ clientId, listActiveMailboxes: store.listActiveMailboxes, graphGetPage })
  }
  return deps
}
