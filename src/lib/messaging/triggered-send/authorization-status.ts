/**
 * Read-only status of the welcome letter's standing authorization, for the PM's page (§17 ⑥): the open proposal (what
 * it says in plain words, the letter it would send, the rehearsal's evidence, whether it can be authorized and if not
 * why: the same `assessProposal` the authorize command runs), the authorization in force and its state, whether real
 * sending is switched on, whether this viewer may authorize, and which of the things a real send needs are in place
 * (yes/no only: never a value). Never writes and never sends.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.1, §4.3, §5.4 (plan: §17, §17.2).
 */

import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { readResendAccountKey } from '@/lib/messaging/adapters/resend-email'
import { isLiveFor, readLiveSwitches, TRIGGERED_SEND_SWITCHES } from '@/lib/platform/live-switch'
import { assessProposal, type Assessment } from './authorization-assess'
import { done, recordView, refuse, type CommandDeps, type CommandResult, type TemplateRead } from './authorization-core'
import type { AuthorizationRecord } from './authorization-store'
import { GATE_CONTRACT_VERSION, parseRule } from './rule'
import { describeRule } from './rule-summary'
import { judgeStandingAuthorization } from './standing-authorization'
import { readApprovers } from './approvers'
import { RECENT_SENDS_LIMIT, type RecentSendsRead } from './recent-sends'
import { publicOriginOf } from './send-letter'
import { checkTrialRecipients, readTrialDomains } from './trial-recipients'
import { UNSUBSCRIBE_SECRET_ENV, UNSUBSCRIBE_SECRET_MIN_LENGTH } from './unsubscribe-token'
import { checkAutomatedTemplate, type AutomatedTemplateCheck } from './welcome-template'

/** The command ports plus the page's 「最近发送」 (`recent-sends.ts`). */
export interface StatusDeps extends CommandDeps {
  loadRecentSends(clientId: string): Promise<RecentSendsRead>
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

function templateView(key: string, read: TemplateRead | null, check: AutomatedTemplateCheck | null): TemplateView {
  const empty = { key, version: null, status: null, subject: null, body: null, sha256: null }
  if (read === null || !read.ok) return { ...empty, readable: false, check: 'template_unreadable' }
  const t: EmailTemplateVersion | null = read.template
  if (t === null) return { ...empty, readable: true, check: 'template_missing' }
  const ok = check !== null && check.ok
  return {
    key,
    readable: true,
    version: t.version,
    status: t.status,
    subject: t.subject,
    body: t.body,
    check: ok ? 'ok' : check !== null && !check.ok ? check.reason : 'template_unreadable',
    sha256: check !== null && check.ok ? check.sha256 : null,
  }
}

function proposalView(record: AuthorizationRecord, a: Assessment): Record<string, unknown> {
  const rule = a.rule
  return {
    record: recordView(record),
    rule: record.rule,
    summary: rule === null ? null : describeRule(rule, record.dailyCap),
    problem: a.problem === null ? null : a.problem.body.error,
    problem_detail: a.problem === null ? null : { ...a.problem.body, success: undefined, error: undefined },
    trial: rule !== null && rule.recipient_allowlist !== null,
    rehearsal: a.rehearsal !== null && a.rehearsal.ok ? a.rehearsal.evidence : null,
    rehearsal_problem: a.rehearsal !== null && !a.rehearsal.ok ? a.rehearsal.code : null,
    template: rule?.send === undefined ? null : templateView(rule.send.template.key, a.templateRead, a.templateCheck),
    mailboxes_connected: a.mailboxes === null ? null : a.mailboxes.ok,
    warnings: a.warnings,
  }
}

async function readTemplate(deps: CommandDeps, clientId: string, key: string): Promise<TemplateRead> {
  try {
    return await deps.loadTemplate(clientId, key)
  } catch {
    return { ok: false }
  }
}

/**
 * The state the sender would see (§4.1 order). Only a template that cannot be READ is named separately (that is
 * temporary); a template that was disabled or edited is a new version in 127, so the authorization itself is void
 * (`template_changed`: propose and authorize again), exactly as the sender will treat it.
 */
async function authorizationView(deps: CommandDeps, record: AuthorizationRecord): Promise<Record<string, unknown>> {
  const parsed = parseRule(record.rule)
  const key = parsed.ok && parsed.rule.send !== undefined ? parsed.rule.send.template.key : null
  const read = key === null ? null : await readTemplate(deps, record.clientId, key)
  const check = read !== null && read.ok ? checkAutomatedTemplate(read.template) : null
  const verdict = judgeStandingAuthorization(
    { ...record, ruleRaw: record.rule },
    {
      now: deps.now(),
      gateContractVersion: GATE_CONTRACT_VERSION,
      templateVersion: check !== null && check.ok ? check.version : -1,
      templateSha256: check !== null && check.ok ? check.sha256 : '',
    },
  )
  let state = verdict.active ? 'active' : verdict.reason.toLowerCase()
  if (state === 'template_changed' && (read === null || !read.ok)) state = 'template_unreadable'
  // This version sends trials only: an authorization for the real list is in force but sends nothing (`send-arming.ts`).
  if (state === 'active' && parsed.ok && parsed.rule.recipient_allowlist === null) state = 'formal_sending_not_enabled'
  // A trial in force whose addresses are no longer on the internal domains will not be sent (the sender checks again).
  if (state === 'active' && parsed.ok && !checkTrialRecipients(parsed.rule, deps.env).ok) state = 'trial_recipient_not_internal'
  return {
    record: recordView(record),
    rule: record.rule,
    summary: parsed.ok ? describeRule(parsed.rule, record.dailyCap) : null,
    trial: parsed.ok && parsed.rule.recipient_allowlist !== null,
    state,
    template: key === null ? null : templateView(key, read, check),
  }
}

/** What a real send needs, as yes/no. Receipts are proved by the controlled trial (which webhook an account uses is
 *  not visible from here: CTS shares the Resend account behind the `system` webhook). */
function prerequisitesFor(account: string, deps: CommandDeps): Record<string, unknown> {
  const unsubscribe = (deps.env(UNSUBSCRIBE_SECRET_ENV) ?? '').trim()
  return {
    account,
    account_key: readResendAccountKey(account, deps.env).ok,
    unsubscribe_secret: unsubscribe.length >= UNSUBSCRIBE_SECRET_MIN_LENGTH,
    events: deps.canEmit(),
    trial_domains: readTrialDomains(deps.env).size > 0,
    approvers: readApprovers(deps.env).length > 0,
    // The letter's unsubscribe link points at ME itself: no usable https site address = the sender stops the run.
    app_url: publicOriginOf(deps.env) !== null,
  }
}

/**
 * The page's 「最近发送」 and how many letters wait for a person (counted here, over every unknown one); a read that
 * fails is `null` for both (the page says it could not read them), never an empty list or a zero.
 */
async function recentSends(deps: StatusDeps, clientId: string): Promise<Record<string, unknown>> {
  const read = await deps.loadRecentSends(clientId).catch((): RecentSendsRead => ({ ok: false, error: 'threw' }))
  return {
    recent_sends: read.ok ? read.rows : null,
    recent_sends_limit: RECENT_SENDS_LIMIT,
    unknown_sends: read.ok ? { count: read.unknownCount, more: read.unknownMore } : null,
  }
}

export async function statusQuery(deps: StatusDeps, clientId: string, viewer: { canAuthorize: boolean }): Promise<CommandResult> {
  const open = await deps.store.loadOpen(clientId)
  if (!open.ok) return refuse(500, 'AUTHORIZATIONS_UNREADABLE')
  const { proposal, authorized } = open.open
  const account = (proposal ?? authorized)?.account ?? null
  return done({
    ...(await recentSends(deps, clientId)),
    can_manage: true,
    can_authorize: viewer.canAuthorize,
    server_now: deps.now().toISOString(),
    mode: isLiveFor(readLiveSwitches(TRIGGERED_SEND_SWITCHES, deps.env), clientId) ? 'live' : 'practice',
    proposal: proposal === null ? null : proposalView(proposal, await assessProposal(deps, proposal)),
    authorization: authorized === null ? null : await authorizationView(deps, authorized),
    prerequisites: account === null ? null : prerequisitesFor(account, deps),
  })
}
