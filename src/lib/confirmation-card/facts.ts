/**
 * Plain-language facts on a confirmation card, plus the content fingerprint.
 * The fingerprint uses the kernel's canonical hash. Issued time is not part
 * of it: the same facts stay the same card until they change or expire.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { ConfirmationCardError } from './errors'

export type HardCheckState = 'green' | 'red' | 'unread'

export interface HardCheck {
  readonly label: string
  readonly state: HardCheckState
  readonly reason: string
}

export interface CardFacts {
  readonly subjectKey: string
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly hardChecks: readonly HardCheck[]
}

export interface FingerprintBody {
  readonly subjectKey: string
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly hardChecks: readonly HardCheck[]
}

const SUBJECT_RE = /^[a-z0-9][a-z0-9:_-]{0,80}$/

function plain(value: string, field: string): string {
  const text = value.trim()
  if (!text || text.length > 180) {
    throw new ConfirmationCardError('invalid', `请用一两句大白话写「${field}」。`)
  }
  if (/[{}[\]`]/.test(text)) {
    throw new ConfirmationCardError('invalid', `「${field}」请写人话，不要贴代码。`)
  }
  return text
}

function oneCheck(raw: HardCheck): HardCheck {
  const label = plain(raw.label, '检查项')
  if (raw.state !== 'green' && raw.state !== 'red' && raw.state !== 'unread') {
    throw new ConfirmationCardError('invalid', '检查结果只能是通过、没通过或读不到。')
  }
  const reason = raw.reason.trim()
  if (reason.length > 180 || /[{}[\]`]/.test(reason)) {
    throw new ConfirmationCardError('invalid', '检查原因请写人话。')
  }
  if (raw.state === 'red' && !reason) {
    throw new ConfirmationCardError('invalid', `「${label}」没通过时要写原因。`)
  }
  return { label, state: raw.state, reason }
}

export function normalizeFacts(facts: CardFacts): CardFacts {
  if (!SUBJECT_RE.test(facts.subjectKey)) {
    throw new ConfirmationCardError('invalid', '这张卡缺少可以认出同一件事的编号。')
  }
  if (facts.hardChecks.length > 8) {
    throw new ConfirmationCardError('invalid', '一张卡最多写 8 条检查。')
  }
  return {
    subjectKey: facts.subjectKey,
    what: plain(facts.what, '要做的事'),
    account: plain(facts.account, '账户'),
    amount: plain(facts.amount, '金额'),
    date: plain(facts.date, '日期'),
    scope: plain(facts.scope, '范围'),
    hardChecks: facts.hardChecks.map(oneCheck),
  }
}

export function fingerprintBody(facts: CardFacts): FingerprintBody {
  return {
    subjectKey: facts.subjectKey,
    what: facts.what,
    account: facts.account,
    amount: facts.amount,
    date: facts.date,
    scope: facts.scope,
    hardChecks: facts.hardChecks.map((check) => ({
      label: check.label,
      state: check.state,
      reason: check.reason,
    })),
  }
}

export function contentFingerprint(facts: CardFacts): string {
  return canonicalHashOfInput(fingerprintBody(facts))
}

/** Empty or any non-green check blocks confirm. Unreadable is not treated as passed. */
export function confirmBlockReason(checks: readonly HardCheck[]): string | null {
  if (checks.length === 0) return '还没有硬检查结果，不能确认。'
  const problems = checks.filter((check) => check.state !== 'green')
  if (problems.length === 0) return null
  return problems
    .map((check) => (
      check.state === 'unread'
        ? `${check.label}：现在读不到${check.reason ? `，${check.reason}` : ''}`
        : `${check.label}：${check.reason}`
    ))
    .join('；')
}
