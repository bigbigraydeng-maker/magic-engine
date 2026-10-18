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

const MISSING_NAME_LITERALS = /^(whatsapp business|unknown|未知|未留姓名|未留名)$/i
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 名字是不是「等于没有」—— 空、带 @、或是一眼假的占位串。 */
export function isMissingName(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return true
  const trimmed = name.trim()
  if (trimmed === '') return true
  if (trimmed.includes('@')) return true
  if (MISSING_NAME_LITERALS.test(trimmed)) return true
  return false
}

/** 从邮箱里抠出一个人名：@ 前面那段，首字母大写，其余原样。 */
export function nameFromEmail(email: string | null | undefined): string | null {
  if (email === null || email === undefined) return null
  const trimmed = email.trim()
  const at = trimmed.indexOf('@')
  if (at < 0) return null
  const local = trimmed.slice(0, at).trim()
  if (local.length < 2) return null
  return local.charAt(0).toUpperCase() + local.slice(1)
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

/** 名字的兜底链：真名 -> 会话参与者 -> 邮箱前缀 -> 名字本身是邮箱时取前缀 -> 没有。 */
export function resolveDisplayName(args: {
  displayName: string | null
  email: string | null
  hints: ConversationHint[]
}): string | null {
  const { displayName, email, hints } = args

  if (!isMissingName(displayName)) {
    return displayName === null ? null : displayName.trim()
  }

  for (const hint of hints) {
    if (!isMissingName(hint.participantName)) {
      return hint.participantName === null ? null : hint.participantName.trim()
    }
  }

  const fromEmail = nameFromEmail(email)
  if (fromEmail !== null) return fromEmail

  if (displayName !== null && displayName.includes('@')) {
    const fromDisplay = nameFromEmail(displayName)
    if (fromDisplay !== null) return fromDisplay
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
 * 这个人**最早**是从哪个渠道进来的（来源）—— 最早的一条触点；没有触点就看会话渠道。
 * 不是「来过哪些渠道」：很多人几个渠道都碰过，列出一串等于没说。
 */
export function originOf(args: {
  touches: Array<{ channel: string; occurred_at: string }>
  conversationChannels: string[]
}): SourceKey | null {
  const byTime = [...args.touches].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
  for (const t of byTime) {
    const key = sourceKeyOf(t.channel)
    if (key !== null) return key
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
      display_name: resolvedName ?? contact.display_name,
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
