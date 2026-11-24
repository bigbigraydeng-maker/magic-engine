/**
 * 「昨天进来多少个咨询客人、各自问什么」每日早报。
 *
 * 跟 `lead-followup-digest`（「填了表没人回」）是两封不同的信：
 *   · 那一封盯的是**欠账**：谁等了超过一天没人回；
 *   · 这一封盯的是**进账**：昨天一共进来几个人、问的是什么团 —— 让销售一早
 *     就知道今天的盘子，不用自己翻后台。
 *
 * 取数在 `enquiry-daily-load`，编排在 `inngest/functions/crm-enquiry-daily-digest`。
 * 这一层只放纯函数：把触点归成「一个人一行」，再渲染成一封信。
 *
 * ## 什么算「一个咨询」
 *
 * 只算客人**主动留了资料**的两种：Facebook 表单（`meta_lead_form`）和官网表单
 * （`web_form`，含官网的回电预约）。这两种每条触点就是一次留资，数字是准的。
 *
 * Facebook 私信 / WhatsApp **单独列一段、不算进咨询数**：这两种触点在库里是
 * 「一整条对话」一行，`occurred_at` 是对话最后一次动静 —— 老客人昨天回一句
 * 「谢谢」也会落在昨天。把它算进咨询数会把数字说大。
 *
 * 邮件和电话不进这封信：库里的进站邮件大半是群发信的回执和老客人的往来，
 * 分不出哪封是新咨询；电话同理。正文里明说「不含邮件和电话」，不让人以为漏了。
 *
 * ## 隐私纪律（同 `digest-shared` 那两封信）
 *
 * 正文不写客人的邮箱和电话：名字过 `digestName`，留言过 `scrubContactDetails`。
 * 认人靠名字 + 直达后台的链接。
 */

import { digestName, scrubContactDetails } from './digest-shared'

/** 测试期标记。收件人从 ME 自己的信箱转成客户信箱时，只改这一处（和收件人常量）。 */
export const ENQUIRY_DIGEST_TEST_PREFIX = '【测试中】'

/** 算「咨询」的渠道。 */
export const ENQUIRY_FORM_CHANNELS = ['meta_lead_form', 'web_form'] as const
/** 单独列、不算咨询数的对话渠道。 */
export const ENQUIRY_CHAT_CHANNELS = ['messenger', 'whatsapp'] as const

/** 留言最多显示多少字 —— 够看出「问什么」，又不把整封信撑成一屏一个人。 */
const MESSAGE_MAX = 220

/** 从库里读出来的一条进站触点（只取这封信要用的字段）。 */
export interface EnquiryTouchRow {
  contact_id: string | null
  channel: string
  source: string | null
  occurred_at: string
  summary: string | null
  raw: string | null
  metadata: Record<string, unknown> | null
}

/** 信里的一行 = 一个人。 */
export interface EnquiryEntry {
  contactId: string | null
  name: string
  /** 第一次进来的时间（毫秒）。 */
  firstAtMs: number
  /** 这个人昨天从哪些渠道进来（已去重，按出现顺序）。 */
  channels: string[]
  /** 问的是哪个团 / 哪类事。认不出来是 null，不编。 */
  interest: string | null
  /** 客人自己写的话（已脱敏、已截断）。没有就是 null。 */
  message: string | null
}

export interface EnquiryDigest {
  /** 表单咨询（Facebook 表单 + 官网表单），一人一行。 */
  enquiries: EnquiryEntry[]
  /** 昨天有动静的私信 / WhatsApp 对话，一人一行。 */
  chats: EnquiryEntry[]
  /** 触点指向的人在 contacts 里查不到 —— 照样列，名字写「未留姓名」，并计数。 */
  orphans: number
  /** ME 自己造的测试线索（名字以 `ME Test` 开头），不算进咨询数，只计数。 */
  testExcluded: number
}

/** ME 自己提交的测试线索的名字形状（例如 `ME Test Lead 20261009`）。 */
const ME_TEST_NAME = /^\s*ME Test\b/i

export function isMeTestContact(name: string | null | undefined): boolean {
  return typeof name === 'string' && ME_TEST_NAME.test(name)
}

const CHANNEL_LABEL: Record<string, string> = {
  meta_lead_form: 'Facebook form',
  web_form: 'Website form',
  messenger: 'Messenger',
  whatsapp: 'WhatsApp',
}

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? channel
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** `silk_road_–_18_days` → `Silk road – 18 days`。Meta 表单选项存的是这种下划线串。 */
export function humanizeOption(raw: string): string {
  const s = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * 只剩页面地址时，把 `/tours/china/discovery/essentials` 说成 `Essentials (website page)`。
 * 地址本身没人看得懂；最后一截通常就是团名。
 */
export function pageLabel(path: string): string {
  const last = path.split('?')[0].split('/').filter(Boolean).pop()
  if (!last) return 'Website page'
  return `${humanizeOption(last.replace(/-/g, ' '))} (website page)`
}

/** 官网表单的 raw 是「兴趣: X\n留言: Y」两行。取出某一行冒号后面的内容。 */
function rawLine(raw: string | null, label: string): string | null {
  if (!raw) return null
  const idx = raw.indexOf(`${label}:`)
  if (idx < 0) return null
  const rest = raw.slice(idx + label.length + 1)
  const nextLabel = rest.search(/\n\S+:/)
  return str(nextLabel >= 0 ? rest.slice(0, nextLabel) : rest)
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s
}

/** 这条触点问的是哪个团。认不出来返回 null。 */
export function interestOf(row: EnquiryTouchRow): string | null {
  const md = row.metadata ?? {}
  if (row.channel === 'meta_lead_form') {
    const opt = str(md.tour_interest_raw)
    return opt ? humanizeOption(opt) : null
  }
  if (row.channel === 'web_form') {
    const path = str(md.tour_path) ?? str(md.source_url)
    return rawLine(row.raw, '兴趣') ?? (path ? pageLabel(path) : null)
  }
  return null
}

/** 客人自己写的话（只有官网表单有）。脱敏后截断。 */
export function messageOf(row: EnquiryTouchRow): string | null {
  if (row.channel !== 'web_form') return null
  const text = rawLine(row.raw, '留言')
  if (!text) return null
  return truncate(scrubContactDetails(text.replace(/\s+/g, ' ')), MESSAGE_MAX)
}

/**
 * 把一批触点归成「一个人一行」。同一个人昨天既填了 Facebook 表单又填了官网表单，
 * 只占一行，两个渠道都标出来；问的团取第一条认得出来的。
 */
export function groupByPerson(
  rows: EnquiryTouchRow[],
  names: ReadonlyMap<string, string | null>,
): { entries: EnquiryEntry[]; orphans: number } {
  const byKey = new Map<string, EnquiryEntry>()
  let orphans = 0
  const sorted = [...rows].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
  sorted.forEach((row, i) => {
    const key = row.contact_id ?? `no-contact-${i}`
    const known = row.contact_id !== null && names.has(row.contact_id)
    const existing = byKey.get(key)
    if (!existing) {
      if (!known) orphans++
      byKey.set(key, {
        contactId: known ? row.contact_id : null,
        name: digestName(known && row.contact_id ? names.get(row.contact_id) : null),
        firstAtMs: Date.parse(row.occurred_at),
        channels: [row.channel],
        interest: interestOf(row),
        message: messageOf(row),
      })
      return
    }
    if (!existing.channels.includes(row.channel)) existing.channels.push(row.channel)
    existing.interest = existing.interest ?? interestOf(row)
    existing.message = existing.message ?? messageOf(row)
  })
  return { entries: Array.from(byKey.values()), orphans }
}

/** 把一天的触点拆成「咨询」和「对话」两段。 */
export function buildEnquiryDigest(
  rows: EnquiryTouchRow[],
  names: ReadonlyMap<string, string | null>,
): EnquiryDigest {
  const isForm = (r: EnquiryTouchRow) => (ENQUIRY_FORM_CHANNELS as readonly string[]).includes(r.channel)
  const isChat = (r: EnquiryTouchRow) => (ENQUIRY_CHAT_CHANNELS as readonly string[]).includes(r.channel)
  const isTest = (r: EnquiryTouchRow) => r.contact_id !== null && isMeTestContact(names.get(r.contact_id))
  const testIds = new Set(rows.filter(isTest).map((r) => r.contact_id))
  const real = rows.filter((r) => !isTest(r))
  const forms = groupByPerson(real.filter(isForm), names)
  const chats = groupByPerson(real.filter(isChat), names)
  return {
    enquiries: forms.entries,
    chats: chats.entries,
    orphans: forms.orphans + chats.orphans,
    testExcluded: testIds.size,
  }
}

/** 「大概问什么」：按团归类数人头，多的在前。认不出团的归到「Not specified」。 */
export function topInterests(entries: EnquiryEntry[]): Array<{ interest: string; count: number }> {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const k = e.interest ?? 'Not specified'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([interest, count]) => ({ interest, count }))
    .sort((a, b) => b.count - a.count || a.interest.localeCompare(b.interest))
}

/** 各渠道各几个人。 */
export function channelCounts(entries: EnquiryEntry[]): Array<{ channel: string; count: number }> {
  const counts = new Map<string, number>()
  for (const e of entries) {
    for (const c of e.channels) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([channel, count]) => ({ channel, count }))
}
