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
 */

import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { readResendAccountKey } from '@/lib/messaging/adapters/resend-email'
import { isLiveFor, readLiveSwitches, TRIGGERED_SEND_SWITCHES } from '@/lib/platform/live-switch'
import type { AuthorizationRecord } from './authorization-store'
import { GATE_CONTRACT_VERSION, parseSendRule, type SendableRule } from './rule'
import { publicOriginOf, PRECHECK_SEND_ID } from './send-letter'
import type { SendDeps, SendStopStatus } from './send-types'
import { judgeStandingAuthorization, SELF_REVOKING_REASONS, type StandingAuthorizationRow } from './standing-authorization'
import { checkTrialRecipients } from './trial-recipients'
import { signUnsubscribeToken } from './unsubscribe-token'
import { checkAutomatedTemplate } from './welcome-template'

export type Armed =
  | { ok: true; record: AuthorizationRecord; rule: SendableRule; template: EmailTemplateVersion; templateVersion: number; templateSha256: string }
  | { ok: false; status: SendStopStatus; detail: string | null; authorizationId: string | null }

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

/** `expected`: the authorization the run was planned for (before each letter); null at the start of the run. */
export async function checkArmed(deps: SendDeps, clientId: string, now: Date, expected: string | null): Promise<Armed> {
  if (!isLiveFor(readLiveSwitches(TRIGGERED_SEND_SWITCHES, deps.env), clientId)) return no('not_armed')
  const loaded = await deps.loadAuthorization(clientId)
  if (!loaded.ok) return no('read_failed', loaded.error)
  const record = loaded.record
  if (record === null) return no(expected === null ? 'no_active_authorization' : 'authorization_changed')
  if (expected !== null && record.id !== expected) return no('authorization_changed', null, record.id)
  if (record.clientId !== clientId) return no('authorization_changed', 'client mismatch', record.id)
  const parsed = parseSendRule(record.rule)
  if (!parsed.ok) return selfRevoke(deps, record, 'RULE_INVALID')
  const read = await deps.loadTemplate(clientId, parsed.rule.send.template.key)
  if (!read.ok) return no('template_unreadable', null, record.id)
  const check = checkAutomatedTemplate(read.template)
  if (!check.ok && check.reason === 'template_unreadable') return no('template_unreadable', null, record.id)
  // 127 disables a template by adding a new, disabled version: the approved version is no longer the current one.
  if (!check.ok || read.template === null) return selfRevoke(deps, record, 'TEMPLATE_CHANGED')
  const verdict = judgeStandingAuthorization(standingRow(record), { now, gateContractVersion: GATE_CONTRACT_VERSION, templateVersion: check.version, templateSha256: check.sha256 })
  if (!verdict.active) {
    return SELF_REVOKING_REASONS.has(verdict.reason) ? selfRevoke(deps, record, verdict.reason) : no('authorization_inactive', verdict.reason, record.id)
  }
  const trial = checkTrialRecipients(verdict.rule, deps.env)
  if (!trial.ok) return no(trial.reason, null, record.id)
  const missing = sendingPrerequisite(record, deps, now)
  if (missing !== null) return missing
  return { ok: true, record, rule: verdict.rule, template: read.template, templateVersion: check.version, templateSha256: check.sha256 }
}

/** Is `now` inside the rule's send window (start inclusive, end exclusive), in the rule's own time zone (§5.2 G)? */
export function isWithinSendWindow(rule: SendableRule, now: Date): boolean {
  let hhmm: string
  try {
    hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: rule.schedule.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  } catch {
    return false
  }
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return false
  return hhmm >= rule.send.send_window.start && hhmm < rule.send.send_window.end
}
