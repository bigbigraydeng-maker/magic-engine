/**
 * "May this client's welcome letter really go out right now?" — asked at the start of a send run AND again before EVERY
 * letter (76's review of #3754: each letter re-checks the authorization, the trial list and both switches). Reads the
 * database every time; nothing is cached between letters, so a revoke stops the very next letter (design P2 §4.3).
 *
 * In this order (the first failing one answers):
 *   both switches (TRIGGERED_SEND_LIVE + the client in TRIGGERED_SEND_CLIENTS) → the open AUTHORIZED row (and, before a
 *   letter, still the one the run was planned for) → its rule parses → the template as it is NOW is sendable → the
 *   standing authorization holds (judgeStandingAuthorization: not revoked, activated, not expired, same gate, same
 *   template) → a trial goes only to internal domains → the account key, the unsubscribe secret and ME's public origin
 *   are there (§16.8 ①: checked before anything is claimed).
 * A changed template, gate or rule revokes the authorization (`system:<reason>`); a template that cannot be READ only
 * holds this run back (a passing outage must not throw a PM's authorization away, §4.1).
 *
 * 🔴 **Only a trial goes out in this version** (an authorization with a recipient allow-list, internal inboxes only).
 *    An authorization for real guests stops here (`formal_sending_not_enabled`) until real sending is switched on in its
 *    own change: the old daily batch has to be retired first, or a guest could be welcomed twice on the overlap days
 *    (review of P2-2c-2a, 子牙 P0-1), and a sending account has to be bound to its clients (子牙 P1-1, 魏征 P1-3).
 *
 * A rule with a letter list (the AI follow-up letters, design 2026-11-17 §4.3, §7.2) is checked for ONE letter, the
 * one about to go, but EVERY letter's template of the list is read now (P2-2): any one that is no longer the version
 * and fingerprint the list pinned voids the whole authorization (`TEMPLATE_CHANGED`, PM: "a changed template voids the
 * authorization"); any one that cannot be read only holds this letter back (`template_unreadable`).
 */

import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { readResendAccountKey } from '@/lib/messaging/adapters/resend-email'
import { isLiveFor, readLiveSwitches, TRIGGERED_SEND_SWITCHES } from '@/lib/platform/live-switch'
import type { AuthorizationRecord } from './authorization-store'
import { GATE_CONTRACT_VERSION, isLetterRule, parseAnySendRule, type AnySendableRule, type LetterEntry } from './rule'
import { publicOriginOf, PRECHECK_SEND_ID } from './send-letter'
import { LETTER_LIST_TEMPLATE_VERSION, lettersFingerprint } from './send-rule'
import type { SendDeps, SendStopStatus } from './send-types'
import {
  judgeLetterAuthorization,
  judgeStandingAuthorization,
  SELF_REVOKING_REASONS,
  type StandingAuthorizationRow,
  type StandingAuthorizationVerdict,
} from './standing-authorization'
import { checkTrialRecipients } from './trial-recipients'
import { signUnsubscribeToken } from './unsubscribe-token'
import { checkAutomatedTemplate, LETTER_PLACEHOLDERS, WELCOME_PLACEHOLDERS, type AutomatedTemplateCheck } from './welcome-template'

export type Armed =
  | {
      ok: true
      record: AuthorizationRecord
      rule: AnySendableRule
      template: EmailTemplateVersion
      /** The template this letter is rendered from (the rule's one template, or the letter's). */
      templateKey: string
      templateVersion: number
      templateSha256: string
      /** The letter of a letter list being sent; null for a one-letter rule. */
      letter: LetterEntry | null
    }
  | { ok: false; status: SendStopStatus; detail: string | null; authorizationId: string | null }

type ArmedOk = Extract<Armed, { ok: true }>
type TemplatePick = { ok: true; templateKey: string; placeholders: ReadonlySet<string>; letter: LetterEntry | null } | { ok: false; status: SendStopStatus; detail: string }

/** Which template this check reads: the rule's one template, or the asked-for letter of its list (never a mix). */
function pickTemplate(rule: AnySendableRule, letterKey: string | null): TemplatePick {
  if (!isLetterRule(rule)) {
    if (letterKey !== null) return { ok: false, status: 'authorization_inactive', detail: 'rule_kind' }
    return { ok: true, templateKey: rule.send.template.key, placeholders: WELCOME_PLACEHOLDERS, letter: null }
  }
  if (letterKey === null) return { ok: false, status: 'authorization_inactive', detail: 'rule_kind' }
  const letter = rule.send.letters.find((l) => l.letter_key === letterKey)
  if (letter === undefined) return { ok: false, status: 'letter_not_authorized', detail: letterKey }
  return { ok: true, templateKey: letter.template_key, placeholders: LETTER_PLACEHOLDERS, letter }
}

/**
 * The standing judgement, with what "the current template" means for this kind of rule. For a letter list the one
 * letter is compared with its pinned template first; the authorization row then carries the list's fingerprint.
 */
function judge(record: AuthorizationRecord, rule: AnySendableRule, letter: LetterEntry | null, check: Extract<AutomatedTemplateCheck, { ok: true }>, now: Date): StandingAuthorizationVerdict<AnySendableRule> {
  const row = standingRow(record)
  if (!isLetterRule(rule) || letter === null) {
    return judgeStandingAuthorization(row, { now, gateContractVersion: GATE_CONTRACT_VERSION, templateVersion: check.version, templateSha256: check.sha256 })
  }
  if (check.version !== letter.template_version || check.sha256 !== letter.template_sha256) return { active: false, reason: 'TEMPLATE_CHANGED' }
  return judgeLetterAuthorization(row, { now, gateContractVersion: GATE_CONTRACT_VERSION, templateVersion: LETTER_LIST_TEMPLATE_VERSION, templateSha256: lettersFingerprint(rule.send.letters) })
}

function no(status: SendStopStatus, detail: string | null = null, authorizationId: string | null = null): Armed {
  return { ok: false, status, detail, authorizationId }
}

function standingRow(r: AuthorizationRecord): StandingAuthorizationRow {
  return {
    id: r.id,
    clientId: r.clientId,
    ruleRaw: r.rule,
    ruleSha256: r.ruleSha256,
    templateVersion: r.templateVersion,
    templateSha256: r.templateSha256,
    authorizedAt: r.authorizedAt,
    expiresAt: r.expiresAt,
    activatedAt: r.activatedAt,
    revokedAt: r.revokedAt,
  }
}

async function selfRevoke(deps: SendDeps, record: AuthorizationRecord, reason: string): Promise<Armed> {
  const revoked = await deps.revokeAsSystem(record, reason)
  return no('authorization_self_revoked', `${reason}:${revoked}`, record.id)
}

/** The account key, the unsubscribe secret and the public origin: without them no letter can be built (§16.8 ①). */
function sendingPrerequisite(record: AuthorizationRecord, deps: SendDeps, now: Date): Armed | null {
  if (!readResendAccountKey(record.account, deps.env).ok) return no('no_account_key', null, record.id)
  const probe = signUnsubscribeToken({ sendId: PRECHECK_SEND_ID, clientId: record.clientId, issuedAt: Math.floor(now.getTime() / 1000) }, deps.env)
  if (!probe.ok) return no('no_unsubscribe_secret', probe.code, record.id)
  if (publicOriginOf(deps.env) === null) return no('no_app_url', null, record.id)
  return null
}

/**
 * `expected`: the authorization the run was planned for (before each letter); null at the start of the run.
 * `letterKey`: the letter of a letter list about to go (null for a one-letter rule; a mismatch either way stops).
 */
export async function checkArmed(deps: SendDeps, clientId: string, now: Date, expected: string | null, letterKey: string | null = null): Promise<Armed> {
  if (!isLiveFor(readLiveSwitches(TRIGGERED_SEND_SWITCHES, deps.env), clientId)) return no('not_armed')
  const loaded = await deps.loadAuthorization(clientId)
  if (!loaded.ok) return no('read_failed', loaded.error)
  const record = loaded.record
  if (record === null) return no(expected === null ? 'no_active_authorization' : 'authorization_changed')
  if (expected !== null && record.id !== expected) return no('authorization_changed', null, record.id)
  if (record.clientId !== clientId) return no('authorization_changed', 'client mismatch', record.id)
  const parsed = parseAnySendRule(record.rule)
  if (!parsed.ok) return selfRevoke(deps, record, 'RULE_INVALID')
  const pick = pickTemplate(parsed.rule, letterKey)
  if (!pick.ok) return no(pick.status, pick.detail, record.id)
  const read = await deps.loadTemplate(clientId, pick.templateKey)
  if (!read.ok) return no('template_unreadable', null, record.id)
  const check = checkAutomatedTemplate(read.template, pick.placeholders)
  if (!check.ok && check.reason === 'template_unreadable') return no('template_unreadable', null, record.id)
  // 127 disables a template by adding a new, disabled version: the approved version is no longer the current one.
  if (!check.ok || read.template === null) return selfRevoke(deps, record, 'TEMPLATE_CHANGED')
  const others = isLetterRule(parsed.rule) ? await otherLetters(deps, clientId, parsed.rule.send.letters, pick.templateKey) : null
  if (others === 'unreadable') return no('template_unreadable', null, record.id)
  if (others === 'changed') return selfRevoke(deps, record, 'TEMPLATE_CHANGED')
  const verdict = judge(record, parsed.rule, pick.letter, check, now)
  if (!verdict.active) {
    return SELF_REVOKING_REASONS.has(verdict.reason) ? selfRevoke(deps, record, verdict.reason) : no('authorization_inactive', verdict.reason, record.id)
  }
  return armedIfSendable(deps, now, { ok: true, record, rule: verdict.rule, template: read.template, templateKey: pick.templateKey, templateVersion: check.version, templateSha256: check.sha256, letter: pick.letter })
}

/**
 * The list's other letters, as they are now: each must still be exactly its pinned template. One read per template
 * (a template shared by two letters is read once); the letter about to go was read and checked by the caller.
 */
async function otherLetters(deps: SendDeps, clientId: string, letters: readonly LetterEntry[], checkedKey: string): Promise<'unreadable' | 'changed' | null> {
  const keys = [...new Set(letters.map((l) => l.template_key).filter((k) => k !== checkedKey))]
  const reads = await Promise.all(keys.map(async (key) => ({ key, read: await deps.loadTemplate(clientId, key) })))
  let changed = false
  for (const { key, read } of reads) {
    if (!read.ok) return 'unreadable'
    const check = checkAutomatedTemplate(read.template, LETTER_PLACEHOLDERS)
    if (!check.ok && check.reason === 'template_unreadable') return 'unreadable'
    const pinned = letters.filter((l) => l.template_key === key)
    if (!check.ok || pinned.some((l) => l.template_version !== check.version || l.template_sha256 !== check.sha256)) changed = true
  }
  return changed ? 'changed' : null
}

/** The last checks, the same for both kinds: a trial only, to internal inboxes, with everything a letter needs. */
function armedIfSendable(deps: SendDeps, now: Date, armed: ArmedOk): Armed {
  const { record, rule } = armed
  if (rule.recipient_allowlist === null) return no('formal_sending_not_enabled', null, record.id)
  const trial = checkTrialRecipients(rule, deps.env)
  if (!trial.ok) return no(trial.reason, null, record.id)
  return sendingPrerequisite(record, deps, now) ?? armed
}

/** Is `now` inside the rule's send window (start inclusive, end exclusive), in the rule's own time zone (§5.2 G)? */
export function isWithinSendWindow(rule: AnySendableRule, now: Date): boolean {
  let hhmm: string
  try {
    hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: rule.schedule.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  } catch {
    return false
  }
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return false
  return hhmm >= rule.send.send_window.start && hhmm < rule.send.send_window.end
}
