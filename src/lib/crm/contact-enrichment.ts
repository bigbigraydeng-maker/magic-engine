/**
 * CRM 联系人「补全」—— 只读的展示/判断层。
 *
 * 这一层只做两件事：
 *   1. 把「名字」从各种线索里拼出来（display_name / 会话参与者 / 邮箱前缀）。
 *   2. 把「这个人从哪些渠道来过」算出来，并把会话里已经发生、但触点表里
 *      还没落地的外发邮件补成合成触点，好让页面看到同一件事。
 *
 * 规矩：
 *   - 纯函数，不碰数据库，不改入参（返回新对象）。
 *   - 只依赖 `./contact-response-row` 里的类型。
 */

import type { ContactRow, TouchRow } from './contact-response-row'
import { cleanDisplayName } from './clean-display-name'
import { isAutomatedTouch } from './automated-touch'

export interface ConversationHint {
  contactId: string
  channel: string
  participantName: string | null
}

export interface OutboundEmailMsg {
  contactId: string
  sentAt: string
  messageId: string
}

const SYSTEM_ACCOUNT_LITERAL = /^whatsapp business$/i
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 名字是不是「等于没有」—— 空、整串是邮箱 / 电话、占位词，或平台系统账号名（WhatsApp Business）。
 * 判据只有一份：`cleanDisplayName`（`lib/crm/clean-display-name`）。
 * 注意：以前「带 @ 就算缺名」，现在只有「整串是邮箱」才算——`kay@home` 这种昵称保留。
 */
export function isMissingName(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return true
  if (SYSTEM_ACCOUNT_LITERAL.test(name.trim())) return true
  return cleanDisplayName(name) === null
}

/** 会话参与者里，第一个长得像邮箱的，就是我们要的邮箱。 */
export function emailFromHints(hints: ConversationHint[]): string | null {
  for (const hint of hints) {
    const raw = hint.participantName
    if (raw === null || raw === undefined) continue
    const trimmed = raw.trim()
    if (EMAIL_SHAPE.test(trimmed)) return trimmed
  }
  return null
}

/**
 * 名字的兜底链：真名 -> 会话参与者（各渠道上客人自己的昵称）-> 没有。
 * 🔴 不再从邮箱前缀造名字（`brendam@…` -> 「Brendam」）：那是编出来的，PM 2026-10-22 明确不要。
 */
export function resolveDisplayName(args: {
  displayName: string | null
  email: string | null
  hints: ConversationHint[]
}): string | null {
  const { displayName, hints } = args

  if (!isMissingName(displayName)) {
    return cleanDisplayName(displayName)
  }

  for (const hint of hints) {
    if (!isMissingName(hint.participantName)) {
      return cleanDisplayName(hint.participantName)
    }
  }

  return null
}

export type SourceKey = 'messenger' | 'email' | 'whatsapp' | 'phone' | 'fb_form' | 'web_form'

const SOURCE_ORDER: SourceKey[] = ['messenger', 'email', 'whatsapp', 'phone', 'fb_form', 'web_form']

function sourceKeyOf(channel: string): SourceKey | null {
  switch (channel) {
    case 'messenger':
      return 'messenger'
    case 'email':
      return 'email'
    case 'whatsapp':
      return 'whatsapp'
    case 'phone':
      return 'phone'
    case 'meta_lead_form':
      return 'fb_form'
    case 'web_form':
      return 'web_form'
    default:
      return null
  }
}

/** 这个人从哪些渠道来过 —— 会话渠道 + 触点渠道，去重后按固定顺序输出。 */
export function sourcesOf(args: {
  conversationChannels: string[]
  touchChannels: string[]
}): SourceKey[] {
  const seen = new Set<SourceKey>()
  for (const channel of args.conversationChannels) {
    const key = sourceKeyOf(channel)
    if (key !== null) seen.add(key)
  }
  for (const channel of args.touchChannels) {
    const key = sourceKeyOf(channel)
    if (key !== null) seen.add(key)
  }
  return SOURCE_ORDER.filter((key) => seen.has(key))
}

/**
 * 这个人**最早**是从哪个渠道进来的（来源）。
 *
 * 只认**客人自己发起**的触点：我们打出去的电话 / 发出去的邮件、群发工具记下的「打开了邮件」都不是
 * 他「从哪里来」。2026-10-28 PM 发现 Hinemoa Taylor 来源显示「电话」——其实是 7 月导入跟进表时
 * 记的一条「留言未回复」（我们打出去的，时间戳跟她的 Facebook 表单同一秒，排序时它排在前面），
 * 而 CTS 根本没有电话打进来的渠道。
 *
 * 取舍：先在客人发起的触点里找最早的；一条都没有才退回「最早的任意触点」，再退回会话渠道。
 * 不是「来过哪些渠道」：很多人几个渠道都碰过，列出一串等于没说。
 */
export function originOf(args: {
  touches: Array<{ channel: string; occurred_at: string; direction?: string | null; source?: string | null }>
  conversationChannels: string[]
}): SourceKey | null {
  const byTime = [...args.touches].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
  const customerInitiated = byTime.filter((t) => t.direction === 'inbound' && !isAutomatedTouch(t.source, null))
  for (const list of [customerInitiated, byTime]) {
    for (const t of list) {
      const key = sourceKeyOf(t.channel)
      if (key !== null) return key
    }
  }
  for (const c of args.conversationChannels) {
    const key = sourceKeyOf(c)
    if (key !== null) return key
  }
  return null
}

export interface EnrichResult {
  contacts: ContactRow[]
  touches: TouchRow[]
  sources: Map<string, SourceKey[]>
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = grouped.get(key)
    if (bucket === undefined) {
      grouped.set(key, [item])
    } else {
      bucket.push(item)
    }
  }
  return grouped
}

/**
 * 把线索拼到联系人上，并补出合成触点。
 *
 * 入参一律不动：联系人返回新对象，触点返回「原数组元素 + 合成」的新数组。
 */
export function enrichContacts(args: {
  contacts: ContactRow[]
  touches: TouchRow[]
  hints: ConversationHint[]
  outboundEmails: OutboundEmailMsg[]
}): EnrichResult {
  const { contacts, touches, hints, outboundEmails } = args

  const hintsByContact = groupBy(hints, (h) => h.contactId)
  const emailsByContact = groupBy(outboundEmails, (m) => m.contactId)

  const touchesByContact = groupBy(touches, (t) => t.contact_id)

  const enrichedContacts: ContactRow[] = []
  const syntheticTouches: TouchRow[] = []
  const sources = new Map<string, SourceKey[]>()

  for (const contact of contacts) {
    const contactHints = hintsByContact.get(contact.id) ?? []
    const contactEmails = emailsByContact.get(contact.id) ?? []
    const contactTouches = touchesByContact.get(contact.id) ?? []

    const resolvedName = resolveDisplayName({
      displayName: contact.display_name,
      email: contact.primary_email,
      hints: contactHints,
    })

    const resolvedEmail = contact.primary_email ?? emailFromHints(contactHints)

    enrichedContacts.push({
      ...contact,
      // 清洗后的名字或 null——**不回落原值**：原值可能就是邮箱，回落等于把邮箱又当名字露出来。
      // 平台系统账号名（WhatsApp Business）原样保留：下游靠名字把它们挡在名单外，且它本来就是这个名字。
      display_name: resolvedName ?? (SYSTEM_ACCOUNT_LITERAL.test((contact.display_name ?? '').trim()) ? contact.display_name : null),
      primary_email: resolvedEmail,
    })

    const hasOutboundEmailTouch = contactTouches.some(
      (t) => t.channel === 'email' && t.direction === 'outbound',
    )

    if (contactEmails.length > 0 && !hasOutboundEmailTouch) {
      for (const msg of contactEmails) {
        syntheticTouches.push({
          id: `email-msg:${msg.messageId}`,
          contact_id: contact.id,
          channel: 'email',
          direction: 'outbound',
          occurred_at: msg.sentAt,
          summary: null,
          raw: null,
          metadata: { synthetic_from_conversation: true },
          source: 'email_conversation',
        })
      }
    }

    const origin = originOf({
      touches: contactTouches,
      conversationChannels: contactHints.map((h) => h.channel),
    })
    sources.set(contact.id, origin === null ? [] : [origin])
  }

  return {
    contacts: enrichedContacts,
    touches: [...touches, ...syntheticTouches],
    sources,
  }
}
