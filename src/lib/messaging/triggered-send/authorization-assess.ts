/**
 * Can this rule be proposed, and can this proposal be authorized right now? If not, why? One place for both, used by
 * the propose and authorize commands and by the status page, so the page never offers an "authorize" the server would
 * refuse, nor hides one it would accept (except who may click: that is the route's door).
 *
 * The checks, in this order (the first failing one is the answer):
 *   the rule parses → it has its send block → (proposal) its fingerprint is the stored one → the gate version is today's
 *   → the sending account label is valid → a trial goes only to internal domains (trial-recipients.ts) → (proposal) a
 *   template is bound → the template can be read, may be sent automatically and (proposal) is still the bound version
 *   → the salespeople's mailboxes are connected (§5.2 F) → (proposal, real leads) five consistent rehearsal days
 *   (§5.4) → (proposal) events can be sent.
 * Warnings never block: the sales path's weekly cap wider than the rule's, an old batch that sent to people ME did not
 * see (§16.6), and a proposal submitted today (authorized today, its rehearsal days hold; from tomorrow they restart).
 * A letter list (the AI follow-up letters, design 2026-11-17 §4.5) is checked letter by letter: every letter's template
 * is read, may be sent automatically, and is still exactly the version and fingerprint the list pinned; the stored
 * proposal carries version 1 and the list's fingerprint. A letter list has no rehearsal, so only a trial (an allow-list)
 * may be authorized in this version (`FORMAL_LETTERS_NOT_ENABLED`). The rule's kind must be the trigger's.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3, §5.2, §5.4, §6.6 (plan: §17.2).
 */

import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { resendAccountKeyEnvName } from '@/lib/messaging/adapters/resend-email'
import { refuse, triggerOf, type CommandDeps, type CommandResult, type SalesCapRead, type TemplateRead } from './authorization-core'
import type { AuthorizationRecord } from './authorization-store'
import type { RehearsalRead } from './rehearsal-evidence'
import { GATE_CONTRACT_VERSION, parseLetterRule, parseRule, ruleSha256, type AnySendableRule, type LetterEntry, type TriggeredSendRule } from './rule'
import { isLettersBlock, LETTER_LIST_TEMPLATE_VERSION, lettersFingerprint } from './send-rule'
import { triggerProfile } from './trigger-scope'
import { checkTrialRecipients } from './trial-recipients'
import type { MailboxCheck } from './types'
import { checkAutomatedTemplate, LETTER_PLACEHOLDERS, type AutomatedTemplateCheck } from './welcome-template'

/** Red text, never a block: the sales path is 127's. Compared with the rule's own cap (the snapshot is what ME uses). */
export function salesCapWarning(read: SalesCapRead, rule: TriggeredSendRule): string | null {
  if (read.kind === 'unknown') return 'SALES_FREQUENCY_CAP_UNKNOWN'
  if (read.cap === null) return 'SALES_FREQUENCY_CAP_OFF'
  if (read.cap.max > rule.frequency_cap.max || read.cap.windowDays < rule.frequency_cap.window_days) return 'SALES_FREQUENCY_CAP_WIDER'
  return null
}

async function safely<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch {
    return fallback
  }
}

/** One letter of a letter list, as the checks read it. */
export interface LetterTemplateRead {
  letter: LetterEntry
  read: TemplateRead
  check: AutomatedTemplateCheck | null
}

/** What the checks read, kept for the page to show. */
export interface Assessment {
  rule: TriggeredSendRule | null
  templateRead: TemplateRead | null
  templateCheck: AutomatedTemplateCheck | null
  /** A letter list's letters (null for a one-letter rule). */
  letters: LetterTemplateRead[] | null
  mailboxes: MailboxCheck | null
  rehearsal: RehearsalRead | null
  warnings: string[]
  problem: CommandResult | null
}

interface Bound {
  ruleSha256: string
  templateVersion: number | null
  templateSha256: string | null
}

/**
 * The gates belong to a letter list only (P1-1): a one-letter rule with a gates block is refused whatever it says (the
 * welcome letter's gates are fixed in code; a block there would print one thing and judge another). A letter list must
 * pass the sender's own parse (`parseLetterRule`: its gates are required), at proposal AND at authorization (P2-1).
 */
function kindProblem(raw: unknown, kind: 'letters' | 'single', hasGates: boolean): CommandResult | null {
  if (kind === 'single') return hasGates ? refuse(422, 'RULE_INVALID', { detail: 'gates is only allowed on a rule that sends a list of letters' }) : null
  const letters = parseLetterRule(raw)
  return letters.ok ? null : refuse(422, 'RULE_INVALID', { detail: letters.error })
}

function ruleProblem(deps: CommandDeps, raw: unknown, account: string, bound: Bound | null): CommandResult | null {
  const parsed = parseRule(raw)
  if (!parsed.ok) return refuse(422, 'RULE_INVALID', { detail: parsed.error })
  const rule = parsed.rule
  if (rule.send === undefined) return refuse(422, 'RULE_HAS_NO_SEND_BLOCK')
  const kind = isLettersBlock(rule.send) ? 'letters' : 'single'
  if (kind !== triggerProfile(triggerOf(deps)).kind) return refuse(422, 'RULE_KIND_MISMATCH', { trigger: triggerOf(deps), rule_kind: kind })
  const shape = kindProblem(raw, kind, rule.gates !== undefined)
  if (shape !== null) return shape
  if (bound !== null && ruleSha256(rule) !== bound.ruleSha256) return refuse(422, 'RULE_INVALID', { detail: 'the stored rule does not match its fingerprint' })
  if (rule.gate_contract_version !== GATE_CONTRACT_VERSION) {
    return refuse(422, 'GATE_VERSION_MISMATCH', { rule_gate: rule.gate_contract_version, code_gate: GATE_CONTRACT_VERSION })
  }
  if (resendAccountKeyEnvName(account) === null) return refuse(422, 'ACCOUNT_INVALID')
  const trial = checkTrialRecipients(rule, deps.env)
  if (!trial.ok) {
    return trial.reason === 'trial_domains_not_configured'
      ? refuse(422, 'TRIAL_DOMAINS_NOT_CONFIGURED')
      : refuse(422, 'TRIAL_RECIPIENT_NOT_INTERNAL', { outside: trial.outside })
  }
  if (bound !== null && (bound.templateVersion === null || bound.templateSha256 === null)) return refuse(422, 'PROPOSAL_HAS_NO_TEMPLATE')
  return null
}

/** Every letter of a list: readable, sendable, still exactly the pinned template; the stored list fingerprint holds. */
function lettersProblem(letters: readonly LetterTemplateRead[], bound: Bound | null): CommandResult | null {
  for (const { letter, read, check } of letters) {
    const named = { letter_key: letter.letter_key }
    if (!read.ok) return refuse(503, 'TEMPLATE_UNREADABLE', named)
    if (check === null || !check.ok) return refuse(422, 'TEMPLATE_NOT_SENDABLE', { reason: check !== null && !check.ok ? check.reason : 'template_missing', ...named })
    if (check.version !== letter.template_version || check.sha256 !== letter.template_sha256) return refuse(409, 'TEMPLATE_CHANGED', named)
  }
  if (bound === null) return null
  const fingerprint = lettersFingerprint(letters.map((l) => l.letter))
  if (bound.templateVersion !== LETTER_LIST_TEMPLATE_VERSION || bound.templateSha256 !== fingerprint) return refuse(409, 'TEMPLATE_CHANGED')
  return null
}

function templateProblem(a: Assessment, bound: Bound | null): CommandResult | null {
  if (a.letters !== null) return lettersProblem(a.letters, bound)
  const read = a.templateRead
  const check = a.templateCheck
  if (read === null || !read.ok) return refuse(503, 'TEMPLATE_UNREADABLE')
  if (check === null || !check.ok) return refuse(422, 'TEMPLATE_NOT_SENDABLE', { reason: check !== null && !check.ok ? check.reason : 'template_missing' })
  if (bound !== null && (check.version !== bound.templateVersion || check.sha256 !== bound.templateSha256)) return refuse(409, 'TEMPLATE_CHANGED')
  return null
}

function readinessProblem(a: Assessment, bound: Bound | null, canEmit: boolean): CommandResult | null {
  if (a.mailboxes === null || !a.mailboxes.ok) {
    return a.mailboxes !== null && a.mailboxes.reason === 'missing'
      ? refuse(422, 'REQUIRED_MAILBOXES_NOT_CONNECTED')
      : refuse(503, 'REQUIRED_MAILBOXES_UNREADABLE')
  }
  if (bound === null) return null
  // A letter list has no rehearsal (design 2026-11-17 §7.7): only a trial may be authorized in this version.
  if (a.letters !== null && a.rule !== null && a.rule.recipient_allowlist === null) return refuse(422, 'FORMAL_LETTERS_NOT_ENABLED')
  if (a.rule !== null && a.rule.recipient_allowlist === null) {
    if (a.rehearsal === null || !a.rehearsal.ok) return refuse(503, 'REHEARSAL_UNREADABLE')
    const e = a.rehearsal.evidence
    if (e.consecutiveDays < e.requiredDays) {
      return refuse(422, 'REHEARSAL_NOT_READY', { consecutive_days: e.consecutiveDays, required_days: e.requiredDays })
    }
  }
  return canEmit ? null : refuse(503, 'EVENTS_NOT_CONFIGURED')
}

async function readLetters(deps: CommandDeps, clientId: string, letters: readonly LetterEntry[]): Promise<LetterTemplateRead[]> {
  return Promise.all(
    letters.map(async (letter) => {
      const read = await safely<TemplateRead>(() => deps.loadTemplate(clientId, letter.template_key), { ok: false })
      return { letter, read, check: read.ok ? checkAutomatedTemplate(read.template, LETTER_PLACEHOLDERS) : null }
    }),
  )
}

async function gather(deps: CommandDeps, clientId: string, raw: unknown, withRehearsal: boolean): Promise<Assessment> {
  const parsed = parseRule(raw)
  const rule = parsed.ok ? parsed.rule : null
  const send = rule?.send
  const single = send !== undefined && !isLettersBlock(send) ? send : undefined
  const listed = send !== undefined && isLettersBlock(send) ? send.letters : null
  const [templateRead, letters, mailboxes, rehearsal, salesCap] = await Promise.all([
    single === undefined ? null : safely<TemplateRead>(() => deps.loadTemplate(clientId, single.template.key), { ok: false }),
    listed === null ? null : readLetters(deps, clientId, listed),
    rule === null ? null : safely<MailboxCheck>(() => deps.checkMailboxes(clientId, rule.human_mail.required_mailboxes), { ok: false, reason: 'unreadable', detail: 'read failed' }),
    rule === null || rule.recipient_allowlist !== null || !withRehearsal || listed !== null ? null : safely<RehearsalRead>(() => deps.loadRehearsal(clientId, rule), { ok: false, code: 'rehearsal_unreadable' }),
    send === undefined ? null : safely<SalesCapRead>(() => deps.loadSalesFrequencyCap(clientId), { kind: 'unknown' }),
  ])
  const templateCheck = templateRead !== null && templateRead.ok ? checkAutomatedTemplate(templateRead.template) : null
  const warnings: string[] = []
  const capWarning = salesCap !== null && rule !== null ? salesCapWarning(salesCap, rule) : null
  if (capWarning !== null) warnings.push(capWarning)
  if (rehearsal !== null && rehearsal.ok && rehearsal.evidence.batchGap > 0) warnings.push('LEGACY_BATCH_GAP')
  // Submitted today after midnight: today counts, but from tomorrow this partly compared day restarts the run.
  if (rehearsal !== null && rehearsal.ok && rehearsal.evidence.switchToday) warnings.push('REHEARSAL_RESETS_TOMORROW')
  return { rule, templateRead, templateCheck, letters, mailboxes, rehearsal, warnings, problem: null }
}

/** A stored proposal: everything above, in order. The status page shows what was read; the command refuses on `problem`. */
export async function assessProposal(deps: CommandDeps, record: AuthorizationRecord): Promise<Assessment> {
  const bound: Bound = { ruleSha256: record.ruleSha256, templateVersion: record.templateVersion, templateSha256: record.templateSha256 }
  const a = await gather(deps, record.clientId, record.rule, true)
  a.problem =
    ruleProblem(deps, record.rule, record.account, bound) ??
    templateProblem(a, bound) ??
    readinessProblem(a, bound, deps.canEmit())
  return a
}

export type SendableCheck =
  | {
      ok: true
      rule: AnySendableRule
      ruleSha256: string
      /** The one template of a one-letter rule; null for a letter list (its letters are in the rule). */
      template: EmailTemplateVersion | null
      /** What the authorization row binds: the template's, or 1 and the letter list's fingerprint. */
      templateVersion: number
      templateSha256: string
    }
  | { ok: false; result: CommandResult }

/** A rule about to be proposed: the same checks, without the stored-proposal ones. */
export async function checkSendableRule(deps: CommandDeps, clientId: string, raw: unknown, account: string): Promise<SendableCheck> {
  const a = await gather(deps, clientId, raw, false)
  const problem = ruleProblem(deps, raw, account, null) ?? templateProblem(a, null) ?? readinessProblem(a, null, true)
  if (problem !== null) return { ok: false, result: problem }
  const { rule, templateRead: read, templateCheck: check } = a
  // The checks above passed, so these hold; narrowed again here rather than cast.
  if (rule === null || rule.send === undefined) return { ok: false, result: refuse(500, 'INTERNAL_ERROR') }
  const send = rule.send
  if (isLettersBlock(send)) {
    const letters: AnySendableRule = { ...rule, send }
    return { ok: true, rule: letters, ruleSha256: ruleSha256(letters), template: null, templateVersion: LETTER_LIST_TEMPLATE_VERSION, templateSha256: lettersFingerprint(send.letters) }
  }
  if (read === null || !read.ok || read.template === null || check === null || !check.ok) return { ok: false, result: refuse(500, 'INTERNAL_ERROR') }
  const sendable: AnySendableRule = { ...rule, send }
  return { ok: true, rule: sendable, ruleSha256: ruleSha256(sendable), template: read.template, templateVersion: check.version, templateSha256: check.sha256 }
}
