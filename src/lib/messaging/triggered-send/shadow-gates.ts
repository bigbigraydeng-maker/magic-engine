import type { OutboundItem } from '@/lib/crm/email-templates/gates/types'
import type { TriggeredSendRule } from './rule'
import { localDay } from './candidates'
import type {
  ConsentRead,
  DeferReason,
  DncRead,
  EvidenceRead,
  MemberRead,
  ShadowAnnotations,
  ShadowContact,
  ShadowDecision,
  ShadowGatePorts,
  SkipReason,
} from './types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254

const SYSTEM_LOCAL_PARTS: ReadonlySet<string> = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'bounces',
  'notification',
  'notifications',
])

export function isPlausibleEmail(email: string): boolean {
  if (typeof email !== 'string') return false
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false
  return EMAIL_RE.test(email)
}

export function isSystemAddress(email: string): boolean {
  if (typeof email !== 'string') return false
  const at = email.indexOf('@')
  if (at <= 0) return false
  const local = email.slice(0, at).toLowerCase()
  return SYSTEM_LOCAL_PARTS.has(local)
}

function leadLocalDay(contact: ShadowContact, rule: TriggeredSendRule): string {
  return localDay(contact.createdAt, rule.schedule.timezone) ?? 'unknown'
}

export function staleDecision(args: { contact: ShadowContact; rule: TriggeredSendRule }): ShadowDecision {
  const { contact, rule } = args
  const annotations: ShadowAnnotations = {
    gate_contract_version: rule.gate_contract_version,
    would_send: false,
    legacy_welcomed: null,
    legacy_batch_seen: null,
    legacy_campaign_ids: null,
    sales_email: null,
    frequency_count: null,
    lead_local_day: leadLocalDay(contact, rule),
  }
  return {
    kind: 'write',
    status: 'skipped',
    reasonCode: 'stale',
    annotations,
    consentBasis: null,
    sourceRef: null,
  }
}

type Safe<T> = T | { ok: false; error: string }

async function safe<T>(fn: () => Promise<T>): Promise<Safe<T>> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return { ok: false, error: message }
  }
}

function isFailed<T extends { ok: boolean }>(value: Safe<T>): value is { ok: false; error: string } {
  return value.ok === false
}

function isSalesEmailItem(item: OutboundItem, createdAtMs: number): boolean {
  if (item.source === 'mailchimp') return false
  // ME's own automated letters count toward the cap but are not a person's email (design P2 §5.2 step J: "排除 me_send").
  // No shadow decision changes because of this line: until ME's first real send there is no such item, so the gate
  // contract version stays as it is.
  if (item.automated === true) return false
  const atMs = Date.parse(item.at)
  if (Number.isNaN(atMs)) return true
  return atMs >= createdAtMs
}

export async function decideShadow(args: {
  contact: ShadowContact
  rule: TriggeredSendRule
  ports: ShadowGatePorts
}): Promise<ShadowDecision> {
  const { contact, rule, ports } = args

  const primaryEmail = contact.primaryEmail
  const shouldReadMember = primaryEmail !== null && isPlausibleEmail(primaryEmail)
  const shouldReadEvidence = contact.addresses.length > 0

  const consentPromise: Promise<Safe<ConsentRead>> = safe(() => ports.consent(contact.contactId))
  const dncPromise: Promise<Safe<DncRead>> = safe(() => ports.dnc(contact.contactId))
  const memberPromise: Promise<Safe<MemberRead>> = shouldReadMember
    ? safe(() => ports.member(primaryEmail as string))
    : Promise.resolve<Safe<MemberRead>>({ ok: true, state: 'not_applicable', tags: [] })
  const evidencePromise: Promise<Safe<EvidenceRead>> = shouldReadEvidence
    ? safe(() => ports.evidence(contact))
    : // No address at all: the old batch could not have mailed this contact and there is nothing to count.
      Promise.resolve<Safe<EvidenceRead>>({
        ok: true,
        items: [],
        legacy: { welcomed: false, batchSeen: true, campaignIds: [] },
      })

  const [consent, dnc, member, evidence] = await Promise.all([
    consentPromise,
    dncPromise,
    memberPromise,
    evidencePromise,
  ])

  // STEP 2: any failed read defers, in priority order.
  if (isFailed(dnc)) {
    return defer('dnc_unverifiable', dnc.error)
  }
  if (isFailed(consent)) {
    return defer('consent_unreadable', consent.error)
  }
  if (isFailed(member)) {
    return defer('legacy_unverifiable', member.error)
  }
  if (isFailed(evidence)) {
    return defer('evidence_unverifiable', evidence.error)
  }

  // STEP 3: derived facts.
  // The old batch's campaigns are not among the items (taken out before counting), so every item counts.
  const counted = evidence.items
  const createdAtMs = Date.parse(contact.createdAt)
  const salesEmail = counted.some((item) => isSalesEmailItem(item, createdAtMs))
  const frequencyCount = counted.length

  const allowlisted =
    rule.recipient_allowlist !== null &&
    primaryEmail !== null &&
    rule.recipient_allowlist.includes(primaryEmail)

  // The tags the old batch skips (sales is on it, not interested, "next year"): ME skips the same people.
  const excludedTags = new Set(rule.legacy.excluded_tags.map((tag) => tag.toLowerCase()))
  const hasExcludedTag = member.tags.some((tag) => excludedTags.has(tag.toLowerCase()))

  const matchedBasis =
    consent.bases.find((basis) => rule.consent.accepted_bases.includes(basis)) ?? null

  // STEP 4: first matching reason wins.
  let reason: SkipReason | null = null
  if (primaryEmail === null || !isPlausibleEmail(primaryEmail)) {
    reason = 'bad_email'
  } else if (isSystemAddress(primaryEmail)) {
    reason = 'system_address'
  } else if (rule.recipient_allowlist !== null && !allowlisted) {
    reason = 'not_in_allowlist'
  } else if (dnc.blocked) {
    reason = 'dnc'
  } else if (member.state === 'suppressed') {
    reason = 'mailchimp_suppressed'
  } else if (hasExcludedTag) {
    reason = 'excluded_tag'
  } else if (!allowlisted && matchedBasis === null) {
    reason = 'no_consent_basis'
  } else if (salesEmail) {
    reason = 'sales_email_exists'
  } else if (frequencyCount >= rule.frequency_cap.max) {
    reason = 'frequency_full'
  }

  // STEP 5: build the write decision.
  const annotations: ShadowAnnotations = {
    gate_contract_version: rule.gate_contract_version,
    would_send: reason === null,
    legacy_welcomed: evidence.legacy.welcomed,
    legacy_batch_seen: evidence.legacy.batchSeen,
    legacy_campaign_ids: [...evidence.legacy.campaignIds],
    sales_email: salesEmail,
    frequency_count: frequencyCount,
    lead_local_day: leadLocalDay(contact, rule),
  }

  return {
    kind: 'write',
    status: reason === null ? 'shadow' : 'skipped',
    reasonCode: reason,
    annotations,
    consentBasis: matchedBasis,
    sourceRef: consent.sourceRef,
  }
}

function defer(reasonCode: DeferReason, detail: string): ShadowDecision {
  return { kind: 'defer', reasonCode, detail }
}
