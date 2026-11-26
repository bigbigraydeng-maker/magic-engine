/**
 * Who a controlled trial may go to (§6.6). A recipient allow-list makes a rule a trial: it skips the five-day rehearsal
 * and the guests' consent check, because the only recipients are internal inboxes. So "internal" must be a fact of the
 * deploy's configuration, never whatever a proposal says: every address must be on a domain listed in
 * `TRIGGERED_SEND_TRIAL_DOMAINS` (exact domains, comma-separated; set on the deploy by the PM). Not set = no trial may
 * be proposed, authorized or sent. At most `MAX_TRIAL_RECIPIENTS` addresses (rule.ts).
 * Checked when proposing, when authorizing and on the status page; the sender must check it again before each letter.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §6.6 (plan: §17.2).
 */

import type { TriggeredSendRule } from './rule'

export const TRIAL_DOMAINS_ENV = 'TRIGGERED_SEND_TRIAL_DOMAINS'

export type EnvReader = (name: string) => string | undefined

export type TrialCheck =
  | { ok: true }
  | { ok: false; reason: 'trial_domains_not_configured' }
  | { ok: false; reason: 'trial_recipient_not_internal'; outside: number }

export function readTrialDomains(env: EnvReader): ReadonlySet<string> {
  return new Set(
    (env(TRIAL_DOMAINS_ENV) ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0),
  )
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase()
}

/** A rule without an allow-list is not a trial: nothing to check here (the rehearsal gate applies instead). */
export function checkTrialRecipients(rule: TriggeredSendRule, env: EnvReader): TrialCheck {
  if (rule.recipient_allowlist === null) return { ok: true }
  const domains = readTrialDomains(env)
  if (domains.size === 0) return { ok: false, reason: 'trial_domains_not_configured' }
  const outside = rule.recipient_allowlist.filter((address) => !domains.has(domainOf(address))).length
  return outside === 0 ? { ok: true } : { ok: false, reason: 'trial_recipient_not_internal', outside }
}
