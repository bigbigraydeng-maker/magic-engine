/**
 * Sender-shape check: does this contact look like something other than a real
 * customer enquiry, judged ONLY from the email address and display name?
 *
 * This never looks at message content and never calls a model — it is a pure,
 * deterministic function. Contacts it flags are moved to the visible
 * "leave for now" list, never deleted or hidden, so a false positive costs a
 * little attention rather than a lost customer. Be conservative: when in
 * doubt, return null and treat the sender as a normal person.
 */

import { RELAY_DOMAIN_SUFFIXES } from './rules'

export type SenderShapeCategory = 'bulk_marketing' | 'vendor_notice' | 'cold_outreach' | 'system_account'

export interface SenderShapeVerdict {
  category: SenderShapeCategory
  reason: string
}

/** Suppliers / tools WE use — never a travel customer. */
export const VENDOR_NOTICE_DOMAINS: readonly string[] = [
  'twilio.com',
  'meta.com',
  'facebookmail.com',
  'facebook.com',
  'instagram.com',
  'microsoft.com',
  'microsoftonline.com',
  'office.com',
  'afterpay.com',
  'stripe.com',
  'xero.com',
  'shopify.com',
  'render.com',
  'cloudflare.com',
  'github.com',
  'anthropic.com',
  'openai.com',
  'google.com',
  'accounts.google.com',
  'apple.com',
  'testflight.apple.com',
  'mailchimp.com',
  'intuit.com',
  'paypal.com',
  'atlassian.com',
  'slack.com',
  'zoom.us',
  'dropbox.com',
  'linkedin.com',
  'trustpilot.com',
  'semrush.com',
  'godaddy.com',
]

/** First labels that mark an ESP sending subdomain. */
export const BULK_SUBDOMAIN_LABELS: readonly string[] = [
  'e',
  'em',
  'mail',
  'email',
  'mailer',
  'mailing',
  'news',
  'newsletter',
  'info',
  'notify',
  'notification',
  'notifications',
  'send',
  'sender',
  'smtp',
  'reply',
  'noreply',
  'bounce',
  'go',
  'click',
  'link',
  'track',
  't',
  'm',
  'msg',
  'marketing',
  'campaign',
]

/** Local parts that mean someone is selling TO us. */
export const OUTREACH_LOCAL_PARTS: readonly string[] = [
  'outreach',
  'prospecting',
  'biz',
  'bizdev',
  'bd',
  'growth',
  'seo',
  'linkbuilding',
  'link-building',
  'guestpost',
  'collab',
  'collaboration',
  'partnerships',
  'affiliate',
  'crypto',
  'invest',
  'loans',
]

/** Display-name prefixes that identify a platform/system account. */
const SYSTEM_NAME_PREFIXES: readonly string[] = [
  'meta business',
  'meta platform',
  'facebook 用户',
  'facebook user',
  'microsoft',
  'meta platforms',
  'whatsapp business',
  'instagram',
  'google',
]

/** Display-name suffix that identifies a TestFlight build notification. */
const SYSTEM_NAME_SUFFIX = 'via testflight'

/** Lower-case, trim; null when empty. */
function clean(value: string | null): string | null {
  if (!value) return null
  const t = value.trim().toLowerCase()
  return t.length > 0 ? t : null
}

/** Domain after the last '@', lower-cased; null when absent. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at < 0) return null
  const d = email.slice(at + 1).trim().toLowerCase()
  return d.length > 0 ? d : null
}

/** Local part before the last '@', lower-cased; null when absent. */
function localPartOf(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at <= 0) return null
  const l = email.slice(0, at).trim().toLowerCase()
  return l.length > 0 ? l : null
}

/** Domain equals the listed domain, or is a subdomain of it. */
function domainMatches(domain: string, listed: string): boolean {
  return domain === listed || domain.endsWith('.' + listed)
}

/** Strip dots and dashes so 'link-building' and 'linkbuilding' compare equal. */
function squash(value: string): string {
  return value.replace(/[.-]/g, '')
}

/** (a) Known system / platform account, judged from the display name. */
function systemAccountVerdict(displayName: string | null): SenderShapeVerdict | null {
  const name = clean(displayName)
  if (!name) return null
  if (name.endsWith(SYSTEM_NAME_SUFFIX)) {
    return { category: 'system_account', reason: '系统账号，不是客人' }
  }
  if (SYSTEM_NAME_PREFIXES.some((p) => name === p || name.startsWith(p))) {
    return { category: 'system_account', reason: '系统账号，不是客人' }
  }
  return null
}

/** (b) ESP relay domain. */
function relayVerdict(domain: string): SenderShapeVerdict | null {
  if (RELAY_DOMAIN_SUFFIXES.some((s) => domainMatches(domain, s))) {
    return { category: 'bulk_marketing', reason: '群发服务中转地址' }
  }
  return null
}

/** (c) Vendor / supplier domain. */
function vendorVerdict(domain: string): SenderShapeVerdict | null {
  if (VENDOR_NOTICE_DOMAINS.some((v) => domainMatches(domain, v))) {
    return { category: 'vendor_notice', reason: '供应商系统通知' }
  }
  return null
}

/** (d) ESP sending subdomain: 3+ labels and a listed first label. */
function bulkSubdomainVerdict(domain: string): SenderShapeVerdict | null {
  const labels = domain.split('.')
  if (labels.length < 3) return null
  const first = labels[0]
  if (BULK_SUBDOMAIN_LABELS.includes(first)) {
    return { category: 'bulk_marketing', reason: '群发营销地址' }
  }
  return null
}

/** (e) Local part names a sales/outreach role. */
function outreachLocalVerdict(local: string): SenderShapeVerdict | null {
  const squashed = squash(local)
  if (OUTREACH_LOCAL_PARTS.some((p) => squash(p) === squashed)) {
    return { category: 'cold_outreach', reason: '对方来推销' }
  }
  return null
}

/** (f) Local part equals the domain's first label, which is 6+ chars. */
function outreachSelfBrandVerdict(local: string, domain: string): SenderShapeVerdict | null {
  const first = domain.split('.')[0]
  if (first.length >= 6 && local === first) {
    return { category: 'cold_outreach', reason: '对方来推销' }
  }
  return null
}

/**
 * Judge a sender by shape alone. Returns null when nothing matches, meaning
 * "treat as a normal person". Checks run in a fixed order; the first hit wins.
 */
export function senderShapeOf(input: { email: string | null; displayName: string | null }): SenderShapeVerdict | null {
  const system = systemAccountVerdict(input.displayName)
  if (system) return system

  const email = clean(input.email)
  if (!email) return null

  const domain = domainOf(email)
  if (!domain) return null

  return (
    relayVerdict(domain) ??
    vendorVerdict(domain) ??
    bulkSubdomainVerdict(domain) ??
    (localPartOf(email) ? outreachLocalVerdict(localPartOf(email) as string) : null) ??
    (localPartOf(email) ? outreachSelfBrandVerdict(localPartOf(email) as string, domain) : null)
  )
}
