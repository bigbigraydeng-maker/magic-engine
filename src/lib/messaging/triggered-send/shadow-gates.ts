import type { OutboundItem } from '@/lib/crm/email-templates/gates/types'
import type { TriggeredSendRule } from './rule'
import { localDay } from './candidates'
import type {
  AddressHistoryRead,
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
  UnsubscribeRead,
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

/**
 * 'rehearsal' = the shadow run (the old batch is only noted); 'send' = real sending (what the old batch already did is a
 * final skip, design P2 §5.2 D④). Everything else is decided the same way, so the rehearsal predicts real sending.
 */
export type GateMode = 'rehearsal' | 'send'

const NO_EVIDENCE: EvidenceRead = { ok: true, items: [], legacy: { welcomed: false, batchSeen: true, campaignIds: [] } }

/** Every read the gates need, all of them succeeded. */
interface GateReads {
  consent: Extract<ConsentRead, { ok: true }>
  dnc: Extract<DncRead, { ok: true }>
  member: Extract<MemberRead, { ok: true }>
  evidence: Extract<EvidenceRead, { ok: true }>
  unsubscribed: Extract<UnsubscribeRead, { ok: true }>
  history: Extract<AddressHistoryRead, { ok: true }>
}

/** All reads at once; the first failed read (in this priority order) defers the contact. */
async function readGates(contact: ShadowContact, ports: ShadowGatePorts): Promise<{ ok: true; reads: GateReads } | { ok: false; decision: ShadowDecision }> {
  const email = contact.primaryEmail
  const hasAddress = contact.addresses.length > 0
  const [dnc, consent, member, evidence, unsubscribed, history] = await Promise.all([
    safe(() => ports.dnc(contact.contactId)),
    safe(() => ports.consent(contact.contactId)),
    email !== null && isPlausibleEmail(email) ? safe(() => ports.member(email)) : Promise.resolve<Safe<MemberRead>>({ ok: true, state: 'not_applicable', tags: [] }),
    // No address at all: the old batch could not have mailed this contact and there is nothing to count.
    hasAddress ? safe(() => ports.evidence(contact)) : Promise.resolve<Safe<EvidenceRead>>(NO_EVIDENCE),
    safe(() => ports.unsubscribed(contact)),
    hasAddress ? safe(() => ports.addressHistory(contact)) : Promise.resolve<Safe<AddressHistoryRead>>({ ok: true, complained: false, hardBounced: false }),
  ])
  if (isFailed(dnc)) return { ok: false, decision: defer('dnc_unverifiable', dnc.error) }
  if (isFailed(consent)) return { ok: false, decision: defer('consent_unreadable', consent.error) }
  if (isFailed(member)) return { ok: false, decision: defer('legacy_unverifiable', member.error) }
  if (isFailed(evidence)) return { ok: false, decision: defer('evidence_unverifiable', evidence.error) }
  if (isFailed(unsubscribed)) return { ok: false, decision: defer('unsubscribe_unverifiable', unsubscribed.error) }
  if (isFailed(history)) return { ok: false, decision: defer('address_history_unreadable', history.error) }
  return { ok: true, reads: { dnc, consent, member, evidence, unsubscribed, history } }
}

/**
 * The two judgements on the e-mail evidence (§5.2 J): a person already wrote to the guest since the lead came in, or the
 * rule's cap is full. Real sending runs this again INSIDE the locks, on evidence read there, with the same code.
 * The old batch's campaigns are not among the items (taken out before counting), so every item counts.
 */
export function evidenceReason(contact: ShadowContact, rule: TriggeredSendRule, items: readonly OutboundItem[]): 'sales_email_exists' | 'frequency_full' | null {
  const createdAtMs = Date.parse(contact.createdAt)
  if (items.some((item) => isSalesEmailItem(item, createdAtMs))) return 'sales_email_exists'
  if (items.length >= rule.frequency_cap.max) return 'frequency_full'
  return null
}

/** The first matching reason wins (the decision is the same whichever reason is named). */
function firstSkipReason(contact: ShadowContact, rule: TriggeredSendRule, r: GateReads, mode: GateMode): SkipReason | null {
  const email = contact.primaryEmail
  const allowlisted = rule.recipient_allowlist !== null && email !== null && rule.recipient_allowlist.includes(email)
  // The tags the old batch skips (sales is on it, not interested, "next year"): ME skips the same people.
  const excludedTags = new Set(rule.legacy.excluded_tags.map((tag) => tag.toLowerCase()))
  if (email === null || !isPlausibleEmail(email)) return 'bad_email'
  if (isSystemAddress(email)) return 'system_address'
  if (rule.recipient_allowlist !== null && !allowlisted) return 'not_in_allowlist'
  if (r.dnc.blocked) return 'dnc'
  if (r.unsubscribed.unsubscribed) return 'email_unsubscribed'
  if (r.history.complained) return 'complained'
  if (r.history.hardBounced) return 'hard_bounced_address'
  if (r.member.state === 'suppressed') return 'mailchimp_suppressed'
  if (r.member.tags.some((tag) => excludedTags.has(tag.toLowerCase()))) return 'excluded_tag'
  if (mode === 'send' && r.evidence.legacy.welcomed) return 'legacy_welcomed'
  if (!allowlisted && matchedBasisOf(rule, r) === null) return 'no_consent_basis'
  return evidenceReason(contact, rule, r.evidence.items)
}

function matchedBasisOf(rule: TriggeredSendRule, r: GateReads): string | null {
  return r.consent.bases.find((basis) => rule.consent.accepted_bases.includes(basis)) ?? null
}

export async function decideShadow(args: {
  contact: ShadowContact
  rule: TriggeredSendRule
  ports: ShadowGatePorts
  mode?: GateMode
}): Promise<ShadowDecision> {
  const { contact, rule, ports } = args
  const read = await readGates(contact, ports)
  if (!read.ok) return read.decision
  const r = read.reads
  const reason = firstSkipReason(contact, rule, r, args.mode ?? 'rehearsal')
  const annotations: ShadowAnnotations = {
    gate_contract_version: rule.gate_contract_version,
    would_send: reason === null,
    legacy_welcomed: r.evidence.legacy.welcomed,
    legacy_batch_seen: r.evidence.legacy.batchSeen,
    legacy_campaign_ids: [...r.evidence.legacy.campaignIds],
    sales_email: r.evidence.items.some((item) => isSalesEmailItem(item, Date.parse(contact.createdAt))),
    frequency_count: r.evidence.items.length,
    lead_local_day: leadLocalDay(contact, rule),
  }
  return {
    kind: 'write',
    status: reason === null ? 'shadow' : 'skipped',
    reasonCode: reason,
    annotations,
    consentBasis: matchedBasisOf(rule, r),
    sourceRef: r.consent.sourceRef,
  }
}

function defer(reasonCode: DeferReason, detail: string): ShadowDecision {
  return { kind: 'defer', reasonCode, detail }
}
