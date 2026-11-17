/**
 * The one place that names the kinds of letter the triggered sender knows (`trigger_key`) and the ledger scopes their
 * rows live in (`dedupe_scope`). Every other file takes these values from here, so a second kind of letter does not
 * need a literal in the sender, the stores, the receipts or the authorization commands (design 2026-11-17 §7.5; a
 * static test keeps those files free of the literals).
 *
 *   - a trigger with ONE letter (the welcome letter): its live rows are `lifetime`, claimed by `triggered_send_claim`;
 *   - a trigger with a LIST of letters (the AI follow-up letters): one live row per letter, `letter:<key>`, claimed by
 *     `triggered_send_claim_letter`. Which one a rule is, is said by the rule itself (`send.template` or `send.letters`).
 *   - `shadow` rows are the welcome letter's rehearsal; everything that is not `shadow` is a real (live) row.
 * Design: docs/specs/2026-11-17-me-send-crm-ai-followup-cut1.md §3, §7.1.
 */

export const WELCOME_TRIGGER = 'welcome' as const
export const AI_FOLLOWUP_TRIGGER = 'crm_ai_followup' as const
export const TRIGGER_KEYS = [WELCOME_TRIGGER, AI_FOLLOWUP_TRIGGER] as const
export type TriggerKey = (typeof TRIGGER_KEYS)[number]

/** The only channel the sender has. */
export const EMAIL_CHANNEL = 'email' as const

/** The live scope of a one-letter trigger: one letter per guest, ever. */
export const LIFETIME_SCOPE = 'lifetime' as const
/** The rehearsal's scope (frozen decisions, never sent). */
export const SHADOW_SCOPE = 'shadow' as const
const LETTER_SCOPE_PREFIX = 'letter:'

/** A letter's key in a rule's letter list (and in its ledger scope). Same shape the database checks. */
export const LETTER_KEY_RE = /^[a-z][a-z0-9_]{1,40}$/

export interface TriggerProfile {
  /** One letter per guest (`send.template`) or a list of letters (`send.letters`). */
  kind: 'single' | 'letters'
  /** What the letter is called on the CRM timeline. */
  label: string
}

const PROFILES: Readonly<Record<TriggerKey, TriggerProfile>> = {
  [WELCOME_TRIGGER]: { kind: 'single', label: '欢迎信' },
  [AI_FOLLOWUP_TRIGGER]: { kind: 'letters', label: 'AI 跟进信' },
}

export function triggerProfile(trigger: TriggerKey): TriggerProfile {
  return PROFILES[trigger]
}

export function isTriggerKey(value: unknown): value is TriggerKey {
  return typeof value === 'string' && (TRIGGER_KEYS as readonly string[]).includes(value)
}

/** The ledger scope of one letter of a letter list. */
export function letterScope(letterKey: string): string {
  return `${LETTER_SCOPE_PREFIX}${letterKey}`
}

/** The letter key of a `letter:<key>` scope; null for any other scope. */
export function letterKeyOfScope(scope: string): string | null {
  if (!scope.startsWith(LETTER_SCOPE_PREFIX)) return null
  const key = scope.slice(LETTER_SCOPE_PREFIX.length)
  return LETTER_KEY_RE.test(key) ? key : null
}

/** A real (sent or to be sent) row: anything but the rehearsal. Receipts, unsubscribes and complaints use this. */
export function isLiveScope(scope: string): boolean {
  return scope !== SHADOW_SCOPE
}

/** The timeline line once a letter is known not to have gone (refused by the provider, or a person said so). */
export function notSentTimelineLine(trigger: TriggerKey): string {
  return `ME 自动发信没有发出：${triggerProfile(trigger).label}`
}

/** The provider idempotency key of a new letter of this trigger. */
export function idempotencyKeyFor(trigger: TriggerKey, unique: string): string {
  return `triggered-send:${trigger}:${unique}`
}
