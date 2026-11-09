/**
 * Sender-shape check: does this contact's ADDRESS look like something other
 * than a real customer enquiry?
 *
 * This judges the sender's address shape only — never message content, never
 * a model call. It is a pure, deterministic function.
 *
 * It is deliberately conservative: a false positive costs us a real customer,
 * while a false negative costs a human one click. Anything this function
 * flags is MOVED to the visible "leave for now" list — never hidden, never
 * deleted — so a mistake is recoverable. Anything it misses is handled by a
 * human pressing the existing "not an enquiry" button once.
 *
 * When in doubt, return null and treat the sender as a normal person.
 */

import { RELAY_DOMAIN_SUFFIXES } from './rules'

export type SenderShapeCategory = 'bulk_marketing' | 'machine_sender'

export interface SenderShapeVerdict {
  category: SenderShapeCategory
  reason: string
}

/**
 * Local parts that mean "this mailbox does not accept replies". Compared after
 * normalisation (see `normaliseLocalPart`), so `no-reply`, `noreply2` and
 * `bounce+tag` all match.
 */
export const MACHINE_LOCAL_PARTS: readonly string[] = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailerdaemon',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'bounces',
  'mailer',
  'automated',
  'autoreply',
  'auto-reply',
  'notification',
  'notifications',
  'alerts',
  'nreply',
]

/**
 * First labels that are unambiguously an email-service-provider sending
 * subdomain. Deliberately narrow: `mail`, `email`, `info`, `notify`, `send`,
 * `smtp`, `reply`, `go`, `m`, `t`, `msg` are all used by real organisations
 * (universities, tour operators, government) and MUST NOT appear here.
 */
export const ESP_SUBDOMAIN_LABELS: readonly string[] = [
  'e',
  'em',
  'news',
  'newsletter',
  'campaign',
  'campaigns',
  'marketing',
  'mkt',
  'promo',
  'click',
  'clicks',
  'track',
  'tracking',
  'link',
  'links',
  'sendgrid',
  'mailgun',
  'sparkpost',
  'cmail',
  'ccsend',
  'sendible',
  'mailer',
]

/** Labels that mark an academic or government domain — never a bulk sender. */
export const ACADEMIC_OR_GOVT_LABELS: readonly string[] = [
  'edu',
  'ac',
  'govt',
  'gov',
  'school',
  'mil',
  'k12',
]

/**
 * Two-label public suffixes we must not mistake for a sending subdomain.
 * `info.co.nz` is a registrable domain, not `info` under `co.nz`.
 */
export const MULTI_LABEL_PUBLIC_SUFFIXES: readonly string[] = [
  'co.nz',
  'net.nz',
  'org.nz',
  'govt.nz',
  'ac.nz',
  'school.nz',
  'geek.nz',
  'com.au',
  'net.au',
  'org.au',
  'gov.au',
  'edu.au',
  'asn.au',
  'id.au',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'or.jp',
  'ne.jp',
  'ac.jp',
  'com.cn',
  'net.cn',
  'org.cn',
  'edu.cn',
  'gov.cn',
  'com.tw',
  'edu.tw',
  'org.tw',
  'com.hk',
  'edu.hk',
  'co.in',
  'com.sg',
  'edu.sg',
  'com.my',
  'co.za',
  'com.br',
]

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

/**
 * Split a lower-cased domain into the labels ABOVE the registrable domain
 * (`prefixLabels`) and the registrable domain itself (`root`).
 *
 * The public suffix is the longest MULTI_LABEL_PUBLIC_SUFFIXES match the
 * domain ends with, otherwise the last label. The registrable domain is the
 * public suffix plus one label. A domain with too few labels returns
 * `prefixLabels: []` and `root` = the whole domain.
 */
export function registrableParts(domain: string): { prefixLabels: string[]; root: string } {
  const labels = domain.toLowerCase().split('.').filter((l) => l.length > 0)
  if (labels.length === 0) return { prefixLabels: [], root: '' }

  const suffix = longestMatchingSuffix(labels)
  const suffixLabelCount = suffix === null ? 1 : suffix.split('.').length
  const rootLabelCount = suffixLabelCount + 1

  if (labels.length < rootLabelCount) {
    return { prefixLabels: [], root: labels.join('.') }
  }

  const prefixLabels = labels.slice(0, labels.length - rootLabelCount)
  const root = labels.slice(labels.length - rootLabelCount).join('.')
  return { prefixLabels, root }
}

/** Longest MULTI_LABEL_PUBLIC_SUFFIXES entry the labels end with, or null. */
function longestMatchingSuffix(labels: string[]): string | null {
  let best: string | null = null
  for (const suffix of MULTI_LABEL_PUBLIC_SUFFIXES) {
    const parts = suffix.split('.')
    if (parts.length > labels.length) continue
    const tail = labels.slice(labels.length - parts.length).join('.')
    if (tail !== suffix) continue
    if (best === null || parts.length > best.split('.').length) best = suffix
  }
  return best
}

/**
 * Normalise a local part for machine-sender comparison: drop a `+tag`
 * suffix, then `.`, `-`, `_`, then trailing digits. `bounce+tag` -> `bounce`,
 * `no-reply` -> `noreply`, `noreply2` -> `noreply`.
 */
function normaliseLocalPart(local: string): string {
  const withoutTag = local.split('+')[0]
  const withoutSeparators = withoutTag.replace(/[.\-_]/g, '')
  return withoutSeparators.replace(/\d+$/, '')
}

/** (a) ESP relay domain. */
function relayVerdict(domain: string): SenderShapeVerdict | null {
  if (RELAY_DOMAIN_SUFFIXES.some((s) => domainMatches(domain, s))) {
    return { category: 'bulk_marketing', reason: '群发服务中转地址' }
  }
  return null
}

/** (b) Machine mailbox that does not accept replies. */
function machineVerdict(local: string): SenderShapeVerdict | null {
  const normalised = normaliseLocalPart(local)
  if (normalised.length === 0) return null
  const hit = MACHINE_LOCAL_PARTS.some((p) => normaliseLocalPart(p) === normalised)
  return hit ? { category: 'machine_sender', reason: '机器发信地址（不收回复）' } : null
}

/** (c) ESP sending subdomain, unless the root is academic or government. */
function espSubdomainVerdict(domain: string): SenderShapeVerdict | null {
  const { prefixLabels, root } = registrableParts(domain)
  if (prefixLabels.length === 0) return null
  if (!prefixLabels.some((l) => ESP_SUBDOMAIN_LABELS.includes(l))) return null
  const rootLabels = root.split('.')
  if (rootLabels.some((l) => ACADEMIC_OR_GOVT_LABELS.includes(l))) return null
  return { category: 'bulk_marketing', reason: '群发营销子域' }
}

/**
 * Judge a sender by address shape alone. Returns null when nothing matches,
 * meaning "treat as a normal person". Checks run in a fixed order; the first
 * hit wins.
 *
 * `displayName` is accepted for call-site compatibility but is NOT used to
 * judge: a shared upstream helper already filters platform system accounts,
 * and a name like 'Facebook 用户' means a real customer who left no name.
 */
export function senderShapeOf(input: { email: string | null; displayName: string | null }): SenderShapeVerdict | null {
  void input.displayName

  const email = clean(input.email)
  if (!email) return null

  const domain = domainOf(email)
  if (!domain) return null

  const relay = relayVerdict(domain)
  if (relay) return relay

  const local = localPartOf(email)
  if (local) {
    const machine = machineVerdict(local)
    if (machine) return machine
  }

  return espSubdomainVerdict(domain)
}
