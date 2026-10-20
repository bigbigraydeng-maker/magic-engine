/**
 * `sendMailNew` 的真实实现：数据库（supabaseAdmin）+ Microsoft Graph。
 * 编排与所有闸在 `mail-send-new.ts`，这里只做「怎么读、怎么写、怎么调 Graph」。
 * 设计稿：docs/specs/2026-10-21-crm-send-first-email-design-v0.md
 */

import { supabaseAdmin } from '@/lib/supabase'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'
import { checkManualSendDncForContact } from '@/lib/crm/manual-send-dnc-gate'
import type { TouchKind } from '@/lib/crm/email-compose/enquiry-record'
import { GRAPH, callWithRetry, sendDraft as graphSendDraft, writeTouchpoint, type GraphCallResult } from '@/lib/microsoft/mail-send'
import type { GraphSendOutcome, MailNewDeps, MailNewGraph, MailNewStore, PendingDraft, PriorSend } from '@/lib/microsoft/mail-send-new'

const LOCK_STALE_MS = 5 * 60_000
const UNIQUE_VIOLATION = '23505'

const lockKey = (contactId: string): string => `mail-lock:${contactId}`

function metaPart(meta: string | null, kind: 'draft' | 'msg'): string | null {
  const m = new RegExp(`\\|${kind}:(.+)$`).exec(meta ?? '')
  return m ? m[1] : null
}

export function createMailNewStore(): MailNewStore {
  const db = supabaseAdmin
  return {
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
    async findPriorSend(clientId, requestId): Promise<PriorSend | null> {
      const { data } = await db
        .from('conversation_outbound_log')
        .select('id, status, meta_message_id, conversation_id')
        .eq('client_id', clientId)
        .like('meta_message_id', `req:${requestId}%`)
        .limit(1)
      const row = (data as Array<{ id: string; status: 'pending' | 'sent' | 'failed'; meta_message_id: string | null; conversation_id: string }> | null)?.[0]
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
        if (draftId) out.push({ auditId: r.id, draftId, createdAt: r.created_at })
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
    async acquireContactLock(clientId, contactId, mailbox) {
      await db.from('conversations').delete().eq('client_id', clientId).eq('conversation_id', lockKey(contactId)).lt('created_at', new Date(Date.now() - LOCK_STALE_MS).toISOString())
      const { error } = await db.from('conversations').insert({ client_id: clientId, channel: 'email', page_id: mailbox, conversation_id: lockKey(contactId) })
      if (!error) return true
      if (error.code === UNIQUE_VIOLATION) return false
      throw new Error(error.message)
    },
    async releaseContactLock(clientId, contactId) {
      await db.from('conversations').delete().eq('client_id', clientId).eq('conversation_id', lockKey(contactId))
    },
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

async function graphJson<T>(token: string, path: string, init: RequestInit): Promise<GraphCallResult<T>> {
  let res: Response
  try {
    res = await fetch(`${GRAPH}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...PREFER, ...(init.headers ?? {}) } })
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}` }
  return { ok: true, value: (await res.json().catch(() => ({}))) as T }
}

export function createMailNewGraph(): MailNewGraph {
  return {
    async whoAmI(connectionId) {
      const r = await callWithRetry(connectionId, (t) => graphJson<{ mail?: string; userPrincipalName?: string }>(t, '/me?$select=mail,userPrincipalName', { method: 'GET' }))
      if (!r.ok) return null
      const a = r.value.mail ?? r.value.userPrincipalName
      return a ? a.toLowerCase() : null
    },
    async createDraft(connectionId, { to, subject, body }) {
      const payload = { subject, body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: to } }] }
      const r = await callWithRetry(connectionId, (t) => graphJson<{ id?: string; conversationId?: string }>(t, '/me/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
      if (!r.ok) return { error: r.error }
      if (!r.value.id || !r.value.conversationId) return { error: '建草稿成功但没拿到消息 id / conversationId' }
      return { id: r.value.id, conversationId: r.value.conversationId }
    },
    async sendDraft(connectionId, draftId): Promise<GraphSendOutcome> {
      const r = await callWithRetry(connectionId, (t) => graphSendDraft(t, draftId))
      if (r.ok) return 'sent'
      // 超时 / 网络错误 / 5xx：信可能已经发走，不能当失败。
      if (r.status === 0 || r.status >= 500) return 'unknown'
      return 'rejected'
    },
    async deleteDraft(connectionId, draftId) {
      await callWithRetry(connectionId, async (t) => {
        const res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draftId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }).catch(() => null)
        return res && (res.ok || res.status === 404) ? { ok: true as const, value: null } : { ok: false as const, status: res?.status ?? 0, error: 'delete draft failed' }
      })
    },
    async isStillDraft(connectionId, messageId) {
      const r = await callWithRetry(connectionId, (t) => graphJson<{ isDraft?: boolean }>(t, `/me/messages/${encodeURIComponent(messageId)}?$select=isDraft`, { method: 'GET' }))
      if (!r.ok || typeof r.value.isDraft !== 'boolean') return null
      return r.value.isDraft
    },
  }
}

export function createMailNewDeps(): MailNewDeps {
  return { store: createMailNewStore(), graph: createMailNewGraph() }
}
