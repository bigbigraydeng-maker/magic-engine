/**
 * 把一段 Messenger 对话接到「已有的真人」身上 —— 只 LINK，绝不 CREATE。
 *
 * 为什么不建人（三审焊死的红线）：Meta 的 Page 自动回复 / Business AI 会把业务
 * 自己的 info@ctstours.co.nz、电话写进对话正文。从正文抽联系方式建人，会造出一个
 * 假的「info@」客户并把几十段对话错并上去（魏征）。所以反过来：只有「已存在的真实
 * 客户身份」出现在对话里（psid 已知，或客户自己的邮箱原样出现在正文、排除业务自家
 * 域名），才把对话接到那个人身上。对不上就留白 —— 只在 FB 上匿名聊过、从没留过邮箱
 * 的人合并不到任何人，如实不接（板桥：不弄脏干净的联系人表）。
 *
 * 因此这里刻意不走 resolveContact 的合并分支：不新建、不合并两个既有人，就没有
 * 「不可逆错误合并」和「合并后 conversations.contact_id 悬挂」这两个问题。
 *
 * 幂等：conversations 只补 NULL；fb_psid 身份 ON CONFLICT DO NOTHING；触点按
 * (thread + 方向) 唯一键 upsert（重同步刷新 occurred_at）；last_seen 只往前推。
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface IdentityIndex {
  /** 归一化邮箱 -> contactId（同一 client 下邮箱唯一，所以是 1:1）。 */
  byEmail: Map<string, string>
  /** fb_psid -> contactId（回填后已挂上的，命中即最强证据）。 */
  byPsid: Map<string, string>
}

/** 这些域名出现在正文里是「业务自己的」联系方式，不能当成客户身份。 */
const BUSINESS_EMAIL_DOMAINS = ['ctstours.co.nz']

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

export interface ConversationMatchInput {
  psid: string | null
  messageBodies: string[]
}

/**
 * 这段对话对应系统里哪一个已有的人。命中唯一一人才返回；命中 0 个或 >1 个都返回
 * null（>1 = 歧义，错接不可逆，宁可留白）。绝不新建。
 */
export function matchConversationToContact(
  input: ConversationMatchInput,
  index: IdentityIndex,
): { contactId: string; matchedBy: 'psid' | 'email' } | null {
  const found: string[] = []
  const remember = (id: string) => {
    if (!found.includes(id)) found.push(id)
  }
  let via: 'psid' | 'email' | null = null

  // 1) psid 已知 —— 最强、最干净的键
  if (input.psid) {
    const c = index.byPsid.get(input.psid)
    if (c) {
      remember(c)
      via = 'psid'
    }
  }

  // 2) 正文里出现「已有真客户的邮箱」（排除业务自家域名）
  for (const body of input.messageBodies) {
    // .match(/g) 返回字符串数组（或 null），避免 matchAll 的迭代器（编译目标不支持）。
    const emails = body.toLowerCase().match(EMAIL_RE)
    if (!emails) continue
    for (const email of emails) {
      if (BUSINESS_EMAIL_DOMAINS.some((d) => email.endsWith(`@${d}`) || email.endsWith(`.${d}`))) {
        continue
      }
      const c = index.byEmail.get(email)
      if (c) {
        remember(c)
        if (!via) via = 'email'
      }
    }
  }

  // 命中两个不同的人 = 歧义，宁可不接（错接不可逆）。
  if (found.length !== 1) return null
  return { contactId: found[0], matchedBy: via ?? 'email' }
}

export interface LinkConversationInput {
  clientId: string
  /** conversations.id（UUID 主键）。 */
  conversationId: string
  psid: string | null
  participantName: string | null
  messageCount: number
  lastMessageFrom: 'customer' | 'page' | null
  /** conversations.last_message_at，用于把 contact.last_seen_at 往前推。 */
  lastMessageAt: string | null
  messages: { direction: 'inbound' | 'outbound'; body: string; sentAt: string }[]
  /** conversations.contact_id 现值；非空则已接过，只刷新触点、不重新匹配。 */
  existingContactId: string | null
}

export interface LinkConversationResult {
  contactId: string | null
  /** true = 这次新接上了一个人。 */
  linked: boolean
  matchedBy: 'psid' | 'email' | 'already' | null
}

/** 取某个方向最后一条消息的时间。 */
function lastSentAt(
  messages: LinkConversationInput['messages'],
  direction: 'inbound' | 'outbound',
): string | null {
  let latest: string | null = null
  for (const m of messages) {
    if (m.direction !== direction) continue
    if (!latest || m.sentAt > latest) latest = m.sentAt
  }
  return latest
}

/**
 * 把一段已入库的对话接到已有的人身上并写触点。绝不新建联系人。
 *
 * index 会在命中时就地更新（把新挂的 psid 记进去），让同一次同步里后面的对话
 * 能直接命中，不用重查库。
 */
export async function linkMessengerConversation(
  input: LinkConversationInput,
  index: IdentityIndex,
): Promise<LinkConversationResult> {
  let contactId = input.existingContactId
  let matchedBy: LinkConversationResult['matchedBy'] = contactId ? 'already' : null
  let newlyLinked = false

  if (!contactId) {
    const match = matchConversationToContact(
      { psid: input.psid, messageBodies: input.messages.map((m) => m.body) },
      index,
    )
    if (!match) return { contactId: null, linked: false, matchedBy: null }

    contactId = match.contactId
    matchedBy = match.matchedBy
    newlyLinked = true

    // 只在仍为 NULL 时写，幂等；别覆盖别处已接好的人。
    await supabaseAdmin
      .from('conversations')
      .update({ contact_id: contactId, updated_at: new Date().toISOString() })
      .eq('id', input.conversationId)
      .is('contact_id', null)

    // 把 fb_psid 挂到这个人上，未来 O(1) 命中。
    if (input.psid) {
      await supabaseAdmin.from('contact_identities').upsert(
        {
          contact_id: contactId,
          client_id: input.clientId,
          kind: 'fb_psid',
          value: input.psid,
          first_source: 'messenger',
        },
        { onConflict: 'client_id,kind,value', ignoreDuplicates: true },
      )
      index.byPsid.set(input.psid, contactId)
    }
  }

  // 写/刷新两条汇总触点：客户来信 + 我们回复。分两条，segments 才能让
  // 「客户在等我们」只在客户更晚时才触发，而不是一段对话糊成一个方向。
  const lastIn = lastSentAt(input.messages, 'inbound')
  const lastOut = lastSentAt(input.messages, 'outbound')

  const rows: Record<string, unknown>[] = []
  if (lastIn) {
    rows.push({
      client_id: input.clientId,
      contact_id: contactId,
      channel: 'messenger',
      direction: 'inbound',
      occurred_at: lastIn,
      summary: `Messenger 私信（${input.messageCount} 条往来）`,
      metadata: {
        thread_id: input.conversationId,
        participant_name: input.participantName,
        last_message_from: input.lastMessageFrom,
        message_count: input.messageCount,
        linked_by: matchedBy,
      },
      source: 'messenger',
      source_ref: `${input.conversationId}:in`,
    })
  }
  if (lastOut) {
    rows.push({
      client_id: input.clientId,
      contact_id: contactId,
      channel: 'messenger',
      direction: 'outbound',
      occurred_at: lastOut,
      summary: '我们在 Messenger 回复过',
      metadata: { thread_id: input.conversationId, sender: 'page' },
      source: 'messenger',
      source_ref: `${input.conversationId}:out`,
    })
  }

  if (rows.length > 0) {
    // 不加 ignoreDuplicates → ON CONFLICT DO UPDATE：重同步刷新 occurred_at。
    await supabaseAdmin
      .from('contact_touchpoints')
      .upsert(rows, { onConflict: 'client_id,source,source_ref' })
  }

  // last_seen 只往前推：仅当现值早于本对话最后活动时才更新，绝不回拨。
  if (input.lastMessageAt) {
    await supabaseAdmin
      .from('contacts')
      .update({ last_seen_at: input.lastMessageAt, updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('client_id', input.clientId)
      .lt('last_seen_at', input.lastMessageAt)
  }

  return { contactId, linked: newlyLinked, matchedBy }
}

/** 一次同步开始时加载该客户的身份索引（邮箱 + psid），供逐条对话就地匹配。 */
export async function loadIdentityIndex(clientId: string): Promise<IdentityIndex> {
  const byEmail = new Map<string, string>()
  const byPsid = new Map<string, string>()

  const { data } = await supabaseAdmin
    .from('contact_identities')
    .select('kind, value, contact_id')
    .eq('client_id', clientId)
    .in('kind', ['email', 'fb_psid'])

  for (const row of (data ?? []) as { kind: string; value: string; contact_id: string }[]) {
    if (row.kind === 'email') byEmail.set(row.value.toLowerCase(), row.contact_id)
    else if (row.kind === 'fb_psid') byPsid.set(row.value, row.contact_id)
  }

  return { byEmail, byPsid }
}
