/**
 * Tuesday tune: a budget increase or decrease only becomes a confirmation card.
 *
 * The card reuses the existing confirmation hold. Issuing it, and clicking it,
 * does not change a budget, write Meta, or spend. Missing numbers stay missing.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { issueConfirmationCard, type CardFacts, type HardCheck } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { isUuid } from '@/lib/validation-utils'
import type { WeeklyCheckSummary } from './prescription-weekly-check'

export type BudgetDirection = 'increase' | 'decrease'

export interface TuesdayBudgetProposal {
  readonly clientId: string
  readonly subjectKey: string
  readonly direction: BudgetDirection
  readonly accountLabel: string
  readonly beforeCents: number | null
  readonly afterCents: number | null
  readonly currencyLabel: string | null
  readonly why: string
  readonly dateLabel: string
  readonly scopeLabel: string
}

export interface TuesdayBudgetTuneResult {
  readonly clientId: string
  readonly issued: boolean
  readonly executed: false
  readonly reason: string
  readonly runId: string | null
  readonly fingerprint: string | null
}

const SUBJECT = /^[a-z0-9][a-z0-9:_-]{0,60}$/

/**
 * The weekly read has progress text, not a current daily budget and a computed
 * next amount. Inventing either number would be a budget change, so there is
 * nothing to put on a card.
 */
export function planTuesdayBudgetTunes(_summary: WeeklyCheckSummary): readonly TuesdayBudgetProposal[] {
  return []
}

export async function runTuesdayBudgetTune(
  openKernel: () => KernelDeps,
  summary: WeeklyCheckSummary,
  now?: Date,
): Promise<TuesdayBudgetTuneResult[]> {
  const proposals = planTuesdayBudgetTunes(summary)
  if (proposals.length === 0) return []
  return issueTuesdayBudgetTunes(openKernel(), proposals, now)
}

export async function issueTuesdayBudgetTunes(
  deps: KernelDeps,
  proposals: readonly TuesdayBudgetProposal[],
  now?: Date,
): Promise<TuesdayBudgetTuneResult[]> {
  const out: TuesdayBudgetTuneResult[] = []
  for (const proposal of proposals) out.push(await issueOne(deps, proposal, now))
  return out
}

async function issueOne(
  deps: KernelDeps,
  proposal: TuesdayBudgetProposal,
  now?: Date,
): Promise<TuesdayBudgetTuneResult> {
  const built = buildCard(proposal)
  if ('skip' in built) return skipped(proposal.clientId, built.skip)
  try {
    const card = await issueConfirmationCard(deps, {
      clientId: proposal.clientId,
      clicker: { kind: 'agent', email: null },
      facts: built.facts,
      now,
    })
    return {
      clientId: proposal.clientId,
      issued: true,
      executed: false,
      reason: '已出确认卡。没有改预算。',
      runId: card.runId,
      fingerprint: card.fingerprint,
    }
  } catch (error) {
    const reason = error instanceof ConfirmationCardError
      ? error.humanReason
      : '没有出卡，也没有改预算。'
    return skipped(proposal.clientId, reason)
  }
}

function skipped(clientId: string, reason: string): TuesdayBudgetTuneResult {
  return { clientId, issued: false, executed: false, reason, runId: null, fingerprint: null }
}

function buildCard(proposal: TuesdayBudgetProposal): { facts: CardFacts } | { skip: string } {
  if (!isUuid(proposal.clientId)) return { skip: '客户编号不对，没有出卡，也没有改预算。' }
  const subjectKey = tuneSubject(proposal)
  if (!subjectKey) return { skip: '认不出是哪一次调整，没有出卡，也没有改预算。' }
  const before = centsOrNull(proposal.beforeCents)
  const after = centsOrNull(proposal.afterCents)
  const clash = directionClash(proposal.direction, before, after)
  if (clash) return { skip: clash }
  return { facts: factsFrom(proposal, subjectKey, before, after) }
}

function factsFrom(
  proposal: TuesdayBudgetProposal,
  subjectKey: string,
  before: number | null,
  after: number | null,
): CardFacts {
  const account = safeAccount(proposal.accountLabel)
  const currency = safeCurrency(proposal.currencyLabel)
  const why = safeWhy(proposal.why)
  const date = safeDate(proposal.dateLabel)
  const whyFit = why.readable && scopeFits(proposal.scopeLabel, why)
  return {
    subjectKey,
    what: whatLine(proposal.direction),
    account: account.text,
    amount: amountLine(before, after, currency.text),
    date: date.text,
    scope: scopeLine(proposal.scopeLabel, why, whyFit),
    hardChecks: checks({
      amountsKnown: before !== null && after !== null,
      whyKnown: whyFit,
      currencyKnown: currency.readable,
      accountKnown: account.readable,
      dateKnown: date.readable,
    }),
  }
}

function tuneSubject(proposal: TuesdayBudgetProposal): string | null {
  if (!SUBJECT.test(proposal.subjectKey)) return null
  const key = `tune-${proposal.direction}-${proposal.subjectKey}`
  return key.length <= 80 ? key : null
}

function centsOrNull(value: number | null): number | null {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return null
  return value
}

function directionClash(
  direction: BudgetDirection,
  before: number | null,
  after: number | null,
): string | null {
  if (before === null || after === null) return null
  if (after === before) return '金额没有变化，没有出卡，也没有改预算。'
  if (direction === 'increase' && after < before) return '说是加预算，金额却更少，没有出卡，也没有改预算。'
  if (direction === 'decrease' && after > before) return '说是减预算，金额却更多，没有出卡，也没有改预算。'
  return null
}

function whatLine(direction: BudgetDirection): string {
  return direction === 'increase'
    ? '把日预算加上去。这一步只出确认卡，不会自动改预算。'
    : '把日预算减下来。这一步只出确认卡，不会自动改预算。'
}

function amountLine(before: number | null, after: number | null, currency: string): string {
  if (before === null && after === null) return '现预算和要改成的金额都读不到，没有填数。'
  if (before === null && after !== null) {
    return `现预算读不到。要改成 ${money(after)}${unitSuffix(currency)}没有把现预算填成 0。`
  }
  if (before !== null && after === null) {
    return `现预算是 ${money(before)}${unitSuffix(currency)}要改成多少读不到，没有填一个目标金额。`
  }
  if (before === null || after === null) return '现预算和要改成的金额都读不到，没有填数。'
  if (!currency) return `每天从 ${money(before)} 改成 ${money(after)}，币种读不到。`
  return `每天从 ${money(before)} ${currency}改成 ${money(after)} ${currency}。`
}

function unitSuffix(currency: string): string {
  return currency ? ` ${currency}。` : '。'
}

function money(cents: number): string {
  const whole = Math.floor(cents / 100)
  const frac = String(cents % 100).padStart(2, '0')
  return `${whole}.${frac}`
}

function safeAccount(label: string): { text: string; readable: boolean } {
  const text = label.trim()
  if (!text || text.length > 80 || /[{}[\]`]/.test(text) || /\d{10,}/.test(text) || /act_/i.test(text)) {
    return { text: '广告账户', readable: false }
  }
  return { text, readable: true }
}

function safeCurrency(label: string | null): { text: string; readable: boolean } {
  if (!label) return { text: '', readable: false }
  const text = label.trim()
  if (!text || text.length > 20 || /[{}[\]`\d]/.test(text)) return { text: '', readable: false }
  return { text, readable: true }
}

function safeWhy(why: string): { text: string; readable: boolean } {
  const text = why.trim()
  if (!text || text.length > 120 || /[{}[\]`]/.test(text)) return { text: '', readable: false }
  return { text, readable: true }
}

function safeDate(label: string): { text: string; readable: boolean } {
  const text = label.trim()
  if (!text || text.length > 40 || /[{}[\]`]/.test(text)) return { text: '日期读不到', readable: false }
  return { text, readable: true }
}

function scopeLine(scopeLabel: string, why: { text: string; readable: boolean }, whyFit: boolean): string {
  const base = `点了也只记下，不会改预算。${scopeBit(scopeLabel)}`
  if (!why.readable || !whyFit) return `${base}依据读不到，没有编一句。`
  return `${base}${why.text}`
}

function scopeBit(scopeLabel: string): string {
  const text = scopeLabel.trim()
  if (!text || text.length > 40 || /[{}[\]`]/.test(text)) return '范围按这张卡上的金额。'
  return text.endsWith('。') ? text : `${text}。`
}

function scopeFits(scopeLabel: string, why: { text: string; readable: boolean }): boolean {
  if (!why.readable) return false
  return scopeLine(scopeLabel, why, true).length <= 180
}

function checks(flags: {
  amountsKnown: boolean
  whyKnown: boolean
  currencyKnown: boolean
  accountKnown: boolean
  dateKnown: boolean
}): HardCheck[] {
  return [
    check('金额', flags.amountsKnown, '有一个金额读不到'),
    check('调整依据', flags.whyKnown, '依据读不到'),
    check('币种', flags.currencyKnown, '币种读不到'),
    check('账户称呼', flags.accountKnown, '没有可用的账户称呼'),
    check('日期', flags.dateKnown, '日期读不到'),
  ]
}

function check(label: string, ok: boolean, reason: string): HardCheck {
  return ok ? { label, state: 'green', reason: '' } : { label, state: 'unread', reason }
}
