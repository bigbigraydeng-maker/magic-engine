/**
 * 「AI 写跟进信」的**客户配置**：问候、署名、官网总链接、价格口径。
 *
 * 住在 `clients.leads_config.follow_up_writer`（跟 `email_compose` 同一个客户配置袋），不是共享代码：
 * 换一个客户（地产、电商）只换这一块数据，写信逻辑一行不用改。没配、没开、写坏了 = `null` →
 * 这个客户的写邮件框不出跟进信草稿（按钮点了只会说「还没配置」）。
 *
 * 读法是宽松的（跟 `readEmailComposeConfig` 一样）：缺键用默认值，坏值整块当没配。
 * 注意：不放进 `crm_email_settings`——那份设置是严格解析的，多一个没登记的键会让整份设置被判无效、发信被拦。
 */

export interface FollowUpSiteLink {
  /** 信里这条链接前面的名字，例如 "All our China tours" */
  label: string
  /** https 网址；主机必须在发信设置的 guardrails.allowedLinkHosts 里（写信时再核一遍） */
  url: string
}

export interface FollowUpWriterConfig {
  /** 问候，必须含 `{first_name}`，例如 "Kia ora {first_name},"。 */
  greeting: string
  /** 名字读不可靠时的问候（不含花括号），例如 "Kia ora,"。 */
  greetingNoName: string
  /** 署名，多行，原样接在信的最后。 */
  signature: string
  /** 每封信都带的官网总链接；没配 = 不加。 */
  siteLink: FollowUpSiteLink | null
  /** 带金额的句子必须含这些词（不分大小写），例如 ["per person", "twin share"]。 */
  priceBasisPhrases: string[]
  /** 正文（不含问候、署名、链接）最多多少词。 */
  maxWords: number
}

export const DEFAULT_FOLLOW_UP_MAX_WORDS = 150
const MIN_MAX_WORDS = 60
const MAX_MAX_WORDS = 250
const MAX_GREETING = 80
const MAX_SIGNATURE = 400
const MAX_LABEL = 60
const MAX_URL = 300
const MAX_PHRASES = 4
const MAX_PHRASE = 40

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > max) return null
  return trimmed
}

function readSiteLink(value: unknown): FollowUpSiteLink | null {
  if (!isPlainObject(value)) return null
  const label = readText(value.label, MAX_LABEL)
  const url = readText(value.url, MAX_URL)
  if (label === null || url === null) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
  } catch {
    return null
  }
  return { label, url }
}

function readPhrases(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_PHRASES) return null
  const out: string[] = []
  for (const item of value) {
    const phrase = readText(item, MAX_PHRASE)
    if (phrase === null) return null
    out.push(phrase)
  }
  return out
}

function readMaxWords(value: unknown): number | null {
  if (value === undefined) return DEFAULT_FOLLOW_UP_MAX_WORDS
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < MIN_MAX_WORDS || value > MAX_MAX_WORDS) return null
  return value
}

/** `clients.leads_config` → 跟进信写法。没开（enabled 不是 true）或任何一项写坏 = null。 */
export function readFollowUpWriterConfig(leadsConfig: unknown): FollowUpWriterConfig | null {
  if (!isPlainObject(leadsConfig)) return null
  const raw = leadsConfig.follow_up_writer
  if (!isPlainObject(raw) || raw.enabled !== true) return null

  const greeting = readText(raw.greeting, MAX_GREETING)
  if (greeting === null || !greeting.includes('{first_name}')) return null

  const noName = raw.greeting_no_name === undefined ? 'Hello,' : readText(raw.greeting_no_name, MAX_GREETING)
  if (noName === null || noName.includes('{') || noName.includes('}')) return null

  const signature = readText(raw.signature, MAX_SIGNATURE)
  if (signature === null) return null

  let siteLink: FollowUpSiteLink | null = null
  if (raw.site_link !== undefined && raw.site_link !== null) {
    siteLink = readSiteLink(raw.site_link)
    if (siteLink === null) return null
  }

  const priceBasisPhrases = readPhrases(raw.price_basis_phrases)
  if (priceBasisPhrases === null) return null

  const maxWords = readMaxWords(raw.max_words)
  if (maxWords === null) return null

  return { greeting, greetingNoName: noName, signature, siteLink, priceBasisPhrases, maxWords }
}
