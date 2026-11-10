/**
 * The template an automated letter may be authorized and sent with, and its content fingerprint.
 *
 * Fingerprint = SHA-256 of the canonical JSON of what the guest's letter is made of: subject, body, fact source and the
 * pick settings (not the name, the change note or who wrote it). It is bound into the authorization when the proposal
 * is written; the PM approves exactly that content, and any edit (a new version) ends the authorization.
 *
 * First version of the welcome letter (PM 2026-11-02, D4): plain text, the guest's first name only. So a template is
 * accepted only when it is the current version, active, an automated (`auto-`) key, uses no facts (no tours, prices,
 * dates), picks nothing, and its only placeholder is `first_name`. Checked when proposing and before every send.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3.1, §6.2 (plan: §17).
 */

import { createHash } from 'node:crypto'
import { isAutomatedTemplateKey } from '@/lib/crm/email-templates/automated-template-key'
import { hasUnresolvedBraces, scanPlaceholders } from '@/lib/crm/email-templates/placeholders'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { canonicalJson } from './rule'

export const WELCOME_PLACEHOLDERS: ReadonlySet<string> = new Set(['first_name'])

export function templateContentSha256(t: EmailTemplateVersion): string {
  // The pick filter goes through JSON so an absent optional field never reaches the canonical encoder as `undefined`.
  const pickFilter: unknown = JSON.parse(JSON.stringify(t.pickFilter ?? {}))
  const content = { subject: t.subject, body: t.body, fact_source: t.factSource, pick_mode: t.pickMode, pick_filter: pickFilter }
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex')
}

export type AutomatedTemplateCheck =
  | { ok: true; version: number; sha256: string }
  | {
      ok: false
      reason:
        | 'template_missing'
        | 'template_disabled'
        | 'template_not_automated'
        | 'template_uses_facts'
        | 'template_picks'
        | 'template_placeholder_not_allowed'
        | 'template_unreadable'
    }

function placeholdersAllowed(text: string): boolean {
  const refs = scanPlaceholders(text)
  if (refs.some((ref) => !WELCOME_PLACEHOLDERS.has(ref.name) || ref.count !== null)) return false
  // Braces left over after taking out the allowed placeholders = a malformed or unknown placeholder.
  let rest = text
  for (const ref of refs) rest = rest.replace(ref.raw, '')
  return !hasUnresolvedBraces(rest)
}

/** `current` = the template store's current version of the key (null when the key does not exist). */
export function checkAutomatedTemplate(current: EmailTemplateVersion | null): AutomatedTemplateCheck {
  if (current === null) return { ok: false, reason: 'template_missing' }
  if (current.status !== 'active') return { ok: false, reason: 'template_disabled' }
  if (!isAutomatedTemplateKey(current.templateKey)) return { ok: false, reason: 'template_not_automated' }
  if (current.factSource !== 'none') return { ok: false, reason: 'template_uses_facts' }
  if (current.pickMode !== 'none') return { ok: false, reason: 'template_picks' }
  if (!placeholdersAllowed(current.subject) || !placeholdersAllowed(current.body)) {
    return { ok: false, reason: 'template_placeholder_not_allowed' }
  }
  try {
    return { ok: true, version: current.version, sha256: templateContentSha256(current) }
  } catch {
    return { ok: false, reason: 'template_unreadable' }
  }
}
