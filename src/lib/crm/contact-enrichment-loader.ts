/**
 * 补全层要的原料：这些人的会话（渠道 + 对方名字）和邮件会话里的消息（我们发出的、对方发来的）。
 *
 * 只读、失败不影响名单（返回空，页面退回原样）。纯函数部分在 `contact-enrichment.ts`。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { isAutoReply } from '@/lib/microsoft/mail-ingest'
import { isMissingName, type ConversationHint, type OutboundEmailMsg } from './contact-enrichment'

export interface ConvRow {
  id: string
  contact_id: string | null
  channel: string
  participant_name: string | null
  subject: string | null
}

interface MsgRow {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  sender_name: string | null
  sent_at: string
}

/** `.in()` 一次最多放这么多编号（地址长度限制）。 */
const IN_CHUNK = 100

function chunksOf<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface EnrichmentInputs {
  hints: ConversationHint[]
  outboundEmails: OutboundEmailMsg[]
}

/** Read the tenant-wide conversation set once for priority-list enrichment and briefs. */
export function loadAllEnrichmentConversations(sb: SupabaseClient, clientId: string): Promise<ConvRow[]> {
  return fetchAll<ConvRow>((from, to) =>
    sb
      .from('conversations')
      .select('id, contact_id, channel, participant_name, subject')
      .eq('client_id', clientId)
      .not('contact_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to),
  )
}

/**
 * @param contactIds 只查这些人（分页路径：一页 50 人）；不传 = 整个客户（分段 / 老路径）。
 */
export async function loadEnrichmentInputs(
  sb: SupabaseClient,
  clientId: string,
  contactIds?: string[],
  sharedConversations?: Promise<ConvRow[]>,
): Promise<EnrichmentInputs> {
  try {
    let convs: ConvRow[]
    if (contactIds !== undefined) {
      if (contactIds.length === 0) return { hints: [], outboundEmails: [] }
      const parts = await Promise.all(
        chunksOf(contactIds, IN_CHUNK).map((chunk) =>
          fetchAll<ConvRow>((from, to) =>
            sb
              .from('conversations')
              .select('id, contact_id, channel, participant_name, subject')
              .eq('client_id', clientId)
              .in('contact_id', chunk)
              .order('id', { ascending: true })
              .range(from, to),
          ),
        ),
      )
      convs = parts.flat()
    } else {
      // A failed shared read must not prevent this independent fallback from succeeding.
      convs = sharedConversations
        ? await sharedConversations.catch(() => loadAllEnrichmentConversations(sb, clientId))
        : await loadAllEnrichmentConversations(sb, clientId)
    }

    const hints: ConversationHint[] = []
    const contactOfConv = new Map<string, string>()
    const emailConvIds: string[] = []
    for (const c of convs) {
      if (c.contact_id === null) continue
      hints.push({ contactId: c.contact_id, channel: c.channel, participantName: c.participant_name })
      // 「Automatic reply / 自动回复」之类的线程是机器发的，不能冒充人工跟进（2026-08-02 事故，见 automated-touch.ts）。
      if (c.channel === 'email' && !isAutoReply(c.subject)) {
        contactOfConv.set(c.id, c.contact_id)
        emailConvIds.push(c.id)
      }
    }

    const outboundEmails: OutboundEmailMsg[] = []
    if (emailConvIds.length > 0) {
      const parts = await Promise.all(
        chunksOf(emailConvIds, IN_CHUNK).map((chunk) =>
          fetchAll<MsgRow>((from, to) =>
            sb
              .from('conversation_messages')
              .select('id, conversation_id, direction, sender_name, sent_at')
              .in('conversation_id', chunk)
              .order('id', { ascending: true })
              .range(from, to),
          ),
        ),
      )
      for (const m of parts.flat()) {
        const contactId = contactOfConv.get(m.conversation_id)
        if (contactId === undefined) continue
        if (m.direction === 'outbound') {
          outboundEmails.push({ contactId, sentAt: m.sent_at, messageId: m.id })
        } else if (!isMissingName(m.sender_name)) {
          // 对方来信的发件人显示名：邮件会话里能找回真名的主要来源。
          hints.push({ contactId, channel: 'email', participantName: m.sender_name })
        }
      }
    }
    return { hints, outboundEmails }
  } catch (err) {
    console.warn('[crm contacts] enrichment inputs failed, rows fall back to stored data:', err instanceof Error ? err.message : err)
    return { hints: [], outboundEmails: [] }
  }
}
