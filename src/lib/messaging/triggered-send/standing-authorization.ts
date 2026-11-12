/**
 * Is a standing authorization in force for a real send, right now? Pure: no database, no clock of its own.
 *
 * The order is fixed (§4.1, after `judgeAuthorization` in the daily-plan auto-publisher) and fails closed:
 *   REVOKED → NOT_AUTHORIZED (only a proposal) → NOT_ACTIVATED (authorized, its event not yet out) → EXPIRED
 *   (an unreadable expiry counts as expired) → RULE_INVALID (the snapshot does not parse as a sendable rule, or its
 *   fingerprint does not match) → GATE_CHANGED (the gates' contract version moved on) → TEMPLATE_CHANGED (the current
 *   template is not the one the PM approved) → in force.
 * Hitting the daily cap is not here: that is the claim function's `cap_reached`, not a dead authorization.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.1 (plan: §17).
 */

import { parseSendRule, ruleSha256, type SendableRule } from './rule'

export interface StandingAuthorizationRow {
  id: string
  clientId: string
  ruleRaw: unknown
  ruleSha256: string
  templateVersion: number | null
  templateSha256: string | null
  authorizedAt: string | null
  expiresAt: string | null
  activatedAt: string | null
  revokedAt: string | null
}

export interface StandingAuthorizationNow {
  now: Date
  gateContractVersion: number
  /** The current version of the rule's template and its fingerprint, computed fresh by the caller. */
  templateVersion: number
  templateSha256: string
}

export type StandingAuthorizationReason =
  | 'REVOKED'
  | 'NOT_AUTHORIZED'
  | 'NOT_ACTIVATED'
  | 'EXPIRED'
  | 'RULE_INVALID'
  | 'GATE_CHANGED'
  | 'TEMPLATE_CHANGED'

export type StandingAuthorizationVerdict =
  | { active: true; rule: SendableRule }
  | { active: false; reason: StandingAuthorizationReason }

function expired(expiresAt: string | null, now: Date): boolean {
  if (expiresAt === null) return true
  const at = Date.parse(expiresAt)
  return Number.isNaN(at) || at <= now.getTime()
}

function sendableRule(row: StandingAuthorizationRow): SendableRule | null {
  const parsed = parseSendRule(row.ruleRaw)
  if (!parsed.ok) return null
  return ruleSha256(parsed.rule) === row.ruleSha256 ? parsed.rule : null
}

export function judgeStandingAuthorization(
  row: StandingAuthorizationRow,
  current: StandingAuthorizationNow,
): StandingAuthorizationVerdict {
  if (row.revokedAt !== null) return { active: false, reason: 'REVOKED' }
  if (row.authorizedAt === null) return { active: false, reason: 'NOT_AUTHORIZED' }
  if (row.activatedAt === null) return { active: false, reason: 'NOT_ACTIVATED' }
  if (expired(row.expiresAt, current.now)) return { active: false, reason: 'EXPIRED' }
  const rule = sendableRule(row)
  if (rule === null) return { active: false, reason: 'RULE_INVALID' }
  if (rule.gate_contract_version !== current.gateContractVersion) return { active: false, reason: 'GATE_CHANGED' }
  if (row.templateVersion !== current.templateVersion || row.templateSha256 !== current.templateSha256) {
    return { active: false, reason: 'TEMPLATE_CHANGED' }
  }
  return { active: true, rule }
}

/**
 * The reasons that make the sender revoke the authorization itself (`revoked_by = 'system:<reason>'`) and raise a
 * decision card: the PM approved something that no longer exists. A merely unreadable template is NOT one of them
 * (that only blocks one letter, `template_unreadable`), and neither is an expiry (it simply runs out).
 */
export const SELF_REVOKING_REASONS: ReadonlySet<StandingAuthorizationReason> = new Set(['GATE_CHANGED', 'TEMPLATE_CHANGED', 'RULE_INVALID'])
