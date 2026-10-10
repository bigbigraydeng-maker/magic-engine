/**
 * Client Knowledge Base — the "is this person allowed to stand in for the
 * customer?" predicate, shared by BOTH sides of the dual-sign gate.
 *
 * Why this file exists (issue #1646): until now the three identity rules
 * lived only inside `read.ts`'s `isCustomerReplyEligible` — i.e. they were
 * only ever applied when *reading*. The customer confirmation link (this
 * issue) is the path that actually *writes* `client_confirmed_by_email`, and
 * if it re-derived "slightly the same" rules, the two copies would drift:
 * the write path would happily record a confirmation the read path then
 * silently refuses to honour, and nobody would see an error anywhere — the
 * fact would just never go live, with no explanation. One implementation,
 * called from both sides, makes that class of drift impossible.
 *
 * The three rules, in the order they are checked:
 *   1. The confirmer is not the same person who approved the draft
 *      (职责分离 — otherwise one FDE clicks twice and the customer never
 *      actually saw anything).
 *   2. The confirmer is not a Magic Engine global admin — exact
 *      `ADMIN_EMAILS` match only, never the looser `ADMIN_EMAIL_DOMAIN`
 *      check (design doc §9.14 A.B).
 *   3. The confirmer's email is a CURRENTLY-registered confirmer for this
 *      client (`client_knowledge_confirmers`, registered by a global admin).
 *
 * 🔴 Comparison standard: trim → lower-case, everywhere, every time. A
 * trailing space is enough to make one email look like three different
 * people to three different comparisons — 2026-09-14 狄仁杰 attack
 * verification showed the DB CHECK layer really did accept a space-padded
 * email. Every comparison in this module goes through `normaliseEmail`.
 */

import { isGlobalAdminEmail } from '@/lib/auth/whitelist'

/** trim + lower-case. The one true email comparison standard for this module. */
export function normaliseEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export interface ConfirmerIdentityInput {
  /** The email that would be (or was) recorded as the customer's confirmer. */
  confirmerEmail: string | null | undefined
  /** `client_knowledge_facts.approved_by_email` for the fact being confirmed. */
  approverEmail: string | null | undefined
  /** Currently-registered, non-revoked confirmer emails for THIS client, already lower-cased. */
  registeredConfirmerEmails: ReadonlySet<string>
}

/** Machine-readable reason an identity was refused — the confirmation route turns these into customer-readable Chinese. */
export type ConfirmerIdentityRejection = 'missing' | 'same_as_approver' | 'global_admin' | 'not_registered'

/**
 * Full result — `null` reason means "acceptable". Returned as a discriminated
 * shape (rather than a bare boolean) because the write path has to TELL the
 * customer why their link was refused; a bare boolean would force it to
 * re-derive the reason and drift all over again.
 *
 * Each rule is its own `if` so a mutation test can delete exactly one and
 * watch exactly one behaviour go red.
 */
export function checkConfirmerIdentity(input: ConfirmerIdentityInput): ConfirmerIdentityRejection | null {
  const confirmer = normaliseEmail(input.confirmerEmail)
  // A whitespace-only email is truthy as a string but is not an identity.
  if (!confirmer) return 'missing'

  if (input.approverEmail && normaliseEmail(input.approverEmail) === confirmer) {
    return 'same_as_approver'
  }

  if (isGlobalAdminEmail(confirmer)) return 'global_admin'

  if (!input.registeredConfirmerEmails.has(confirmer)) return 'not_registered'

  return null
}

/** Boolean convenience wrapper for read paths that only need pass/fail. */
export function isAcceptableConfirmerIdentity(input: ConfirmerIdentityInput): boolean {
  return checkConfirmerIdentity(input) === null
}
