/**
 * Read-only status of the welcome letter's standing authorization, for the PM's page (§17 ⑥): the open proposal (what
 * it says in plain words, the letter it would send, the rehearsal's evidence, whether it can be authorized and if not
 * why), the authorization in force and its state, whether real sending is switched on, and which of the things a real
 * send needs are in place (as yes/no only: never a value). Never writes and never sends.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.1, §4.3, §5.4 (plan: §17).
 */

import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { readResendAccountKey } from '@/lib/messaging/adapters/resend-email'
import { isLiveFor, readLiveSwitches, TRIGGERED_SEND_SWITCHES } from '@/lib/platform/live-switch'
import { salesCapWarning } from './authorization-authorize'
import { done, recordView, refuse, type CommandDeps, type CommandResult, type SalesCapRead } from './authorization-commands'
import type { AuthorizationRecord } from './authorization-store'
import type { RehearsalRead } from './rehearsal-evidence'
import { GATE_CONTRACT_VERSION, parseRule, ruleSha256, type TriggeredSendRule } from './rule'
import { describeRule } from './rule-summary'
import { judgeStandingAuthorization } from './standing-authorization'
import { UNSUBSCRIBE_SECRET_ENV, UNSUBSCRIBE_SECRET_MIN_LENGTH } from './unsubscribe-token'
import { checkAutomatedTemplate } from './welcome-template'

export interface StatusDeps extends CommandDeps {
  env: (name: string) => string | undefined
}

interface TemplateView {
  key: string
  readable: boolean
  version: number | null
  status: string | null
  subject: string | null
  body: string | null
  /** 'ok' or why the current version may not be sent automatically. */
  check: string
  sha256: string | null
}

async function templateView(deps: CommandDeps, clientId: string, key: string): Promise<TemplateView> {
  const empty = { key, version: null, status: null, subject: null, body: null, sha256: null }
  let read: Awaited<ReturnType<CommandDeps['loadTemplate']>>
  try {
    read = await deps.loadTemplate(clientId, key)
  } catch {
    read = { ok: false }
  }
  if (!read.ok) return { ...empty, readable: false, check: 'template_unreadable' }
  const t: EmailTemplateVersion | null = read.template
  const check = checkAutomatedTemplate(t)
  if (t === null) return { ...empty, readable: true, check: 'template_missing' }
  return {
    key,
    readable: true,
    version: t.version,
    status: t.status,
    subject: t.subject,
    body: t.body,
    check: check.ok ? 'ok' : check.reason,
    sha256: check.ok ? check.sha256 : null,
  }
}

async function rehearsalFor(deps: CommandDeps, clientId: string, rule: TriggeredSendRule): Promise<RehearsalRead> {
  try {
    return await deps.loadRehearsal(clientId, rule)
  } catch {
    return { ok: false, code: 'rehearsal_unreadable' }
  }
}

/** Why this proposal cannot be authorized right now, in the authorize command's own order; null = it can. */
function proposalProblem(rule: TriggeredSendRule, record: AuthorizationRecord, template: TemplateView | null, rehearsal: RehearsalRead): string | null {
  if (rule.send === undefined || template === null) return 'RULE_HAS_NO_SEND_BLOCK'
  if (ruleSha256(rule) !== record.ruleSha256) return 'RULE_INVALID'
  if (rule.gate_contract_version !== GATE_CONTRACT_VERSION) return 'GATE_VERSION_MISMATCH'
  if (record.templateVersion === null || record.templateSha256 === null) return 'PROPOSAL_HAS_NO_TEMPLATE'
  if (!template.readable) return 'TEMPLATE_UNREADABLE'
  if (template.check !== 'ok') return 'TEMPLATE_NOT_SENDABLE'
  if (template.version !== record.templateVersion || template.sha256 !== record.templateSha256) return 'TEMPLATE_CHANGED'
  if (rule.recipient_allowlist !== null) return null
  if (!rehearsal.ok) return 'REHEARSAL_UNREADABLE'
  return rehearsal.evidence.consecutiveDays < rehearsal.evidence.requiredDays ? 'REHEARSAL_NOT_READY' : null
}

async function salesCap(deps: CommandDeps, clientId: string): Promise<SalesCapRead> {
  try {
    return await deps.loadSalesFrequencyCap(clientId)
  } catch {
    return { kind: 'unknown' }
  }
}

async function proposalStatus(deps: CommandDeps, record: AuthorizationRecord): Promise<Record<string, unknown>> {
  const base = { record: recordView(record), rule: record.rule }
  const parsed = parseRule(record.rule)
  if (!parsed.ok) return { ...base, summary: null, problem: 'RULE_INVALID', trial: false, rehearsal: null, template: null, warnings: [] }
  const rule = parsed.rule
  const template = rule.send === undefined ? null : await templateView(deps, record.clientId, rule.send.template.key)
  const rehearsal = await rehearsalFor(deps, record.clientId, rule)
  const warning = rule.send === undefined ? null : salesCapWarning(await salesCap(deps, record.clientId), rule)
  return {
    ...base,
    summary: describeRule(rule, record.dailyCap),
    problem: proposalProblem(rule, record, template, rehearsal),
    trial: rule.recipient_allowlist !== null,
    rehearsal: rehearsal.ok ? rehearsal.evidence : null,
    rehearsal_problem: rehearsal.ok ? null : rehearsal.code,
    template,
    warnings: warning === null ? [] : [warning],
  }
}

/** The state the sender would see (§4.1 order); a template it could not read or may not send is named as such. */
async function authorizationStatus(deps: CommandDeps, record: AuthorizationRecord): Promise<Record<string, unknown>> {
  const parsed = parseRule(record.rule)
  const key = parsed.ok && parsed.rule.send !== undefined ? parsed.rule.send.template.key : null
  const template = key === null ? null : await templateView(deps, record.clientId, key)
  const verdict = judgeStandingAuthorization(
    { ...record, ruleRaw: record.rule },
    {
      now: deps.now(),
      gateContractVersion: GATE_CONTRACT_VERSION,
      templateVersion: template?.version ?? -1,
      templateSha256: template?.sha256 ?? '',
    },
  )
  let state = verdict.active ? 'active' : verdict.reason.toLowerCase()
  if (state === 'template_changed' && template !== null && template.check !== 'ok') {
    state = template.readable ? 'template_not_sendable' : 'template_unreadable'
  }
  return {
    record: recordView(record),
    rule: record.rule,
    summary: parsed.ok ? describeRule(parsed.rule, record.dailyCap) : null,
    trial: parsed.ok && parsed.rule.recipient_allowlist !== null,
    state,
    template,
  }
}

/**
 * What a real send of this account needs, as yes/no. Receipts are not listed: which webhook receives an account's
 * receipts is not visible from here (an account label can share the Resend account behind the `system` webhook, as
 * CTS does), so the controlled trial proves them instead (provider events = ledger rows, §17).
 */
function prerequisitesFor(account: string, env: StatusDeps['env']): Record<string, unknown> {
  const unsubscribe = (env(UNSUBSCRIBE_SECRET_ENV) ?? '').trim()
  return {
    account,
    account_key: readResendAccountKey(account, env).ok,
    unsubscribe_secret: unsubscribe.length >= UNSUBSCRIBE_SECRET_MIN_LENGTH,
  }
}

export async function statusQuery(deps: StatusDeps, clientId: string): Promise<CommandResult> {
  const open = await deps.store.loadOpen(clientId)
  if (!open.ok) return refuse(500, 'AUTHORIZATIONS_UNREADABLE')
  const { proposal, authorized } = open.open
  const account = (proposal ?? authorized)?.account ?? null
  return done({
    can_manage: true,
    server_now: deps.now().toISOString(),
    mode: isLiveFor(readLiveSwitches(TRIGGERED_SEND_SWITCHES, deps.env), clientId) ? 'live' : 'practice',
    proposal: proposal === null ? null : await proposalStatus(deps, proposal),
    authorization: authorized === null ? null : await authorizationStatus(deps, authorized),
    prerequisites: account === null ? null : prerequisitesFor(account, deps.env),
  })
}
