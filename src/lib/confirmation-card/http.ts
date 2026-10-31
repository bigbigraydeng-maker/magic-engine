/**
 * HTTP body rules for a confirmation card.
 * A click is only the two button values. Chat words are not a click.
 * Extra fields are refused so a caller cannot smuggle an action.
 */

import { isUuid } from '@/lib/validation-utils'
import { KernelError } from '@/lib/kernel/errors'
import { ConfirmationCardError } from './errors'
import type { CardFacts, HardCheck, HardCheckState } from './facts'
import type { CardResolution } from './decide'

const ISSUE_KEYS = ['subjectKey', 'what', 'account', 'amount', 'date', 'scope', 'hardChecks']
const CHECK_KEYS = ['label', 'state', 'reason']
const DECISION_KEYS = ['resolution', 'expectedDecisionId', 'fingerprint']
const FINGERPRINT_RE = /^[a-f0-9]{64}$/

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfirmationCardError('invalid', '请求内容读不懂，没有收下。')
  }
  return value as Record<string, unknown>
}

function rejectExtra(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ConfirmationCardError('invalid', '请求里带了确认卡不认识的内容，没有收下。')
    }
  }
}

function requireText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ConfirmationCardError('invalid', '要确认的内容请用文字写。')
  }
  return value
}

function oneCheck(value: unknown): HardCheck {
  const row = asRecord(value)
  rejectExtra(row, CHECK_KEYS)
  const state = row.state
  if (state !== 'green' && state !== 'red' && state !== 'unread') {
    throw new ConfirmationCardError('invalid', '检查结果只能是通过、没通过或读不到。')
  }
  return {
    label: requireText(row.label),
    state: state as HardCheckState,
    reason: typeof row.reason === 'string' ? row.reason : '',
  }
}

export function parseIssueBody(value: unknown): CardFacts {
  const row = asRecord(value)
  rejectExtra(row, ISSUE_KEYS)
  if (!Array.isArray(row.hardChecks)) {
    throw new ConfirmationCardError('invalid', '请带上硬检查结果。没有结果就不能确认。')
  }
  return {
    subjectKey: requireText(row.subjectKey),
    what: requireText(row.what),
    account: requireText(row.account),
    amount: requireText(row.amount),
    date: requireText(row.date),
    scope: requireText(row.scope),
    hardChecks: row.hardChecks.map(oneCheck),
  }
}

export interface DecisionBody {
  readonly resolution: CardResolution
  readonly expectedDecisionId: string
  readonly fingerprint: string
}

export function parseDecisionBody(value: unknown): DecisionBody {
  const row = asRecord(value)
  rejectExtra(row, DECISION_KEYS)
  if (row.resolution !== 'confirm' && row.resolution !== 'decline') {
    throw new ConfirmationCardError('invalid', '只能点「确认」或「不做」。')
  }
  if (!isUuid(row.expectedDecisionId)) {
    throw new ConfirmationCardError('invalid', '这张卡的编号对不上，请刷新后再点。')
  }
  if (typeof row.fingerprint !== 'string' || !FINGERPRINT_RE.test(row.fingerprint)) {
    throw new ConfirmationCardError('invalid', '你看到的内容对不上，请刷新后再点。')
  }
  return {
    resolution: row.resolution,
    expectedDecisionId: row.expectedDecisionId.toLowerCase(),
    fingerprint: row.fingerprint,
  }
}

/** What the browser may see. Never the kernel detail object. */
export function publicError(error: unknown): { status: number; message: string } {
  if (error instanceof ConfirmationCardError) {
    return { status: error.status, message: error.humanReason }
  }
  if (error instanceof KernelError) {
    return { status: 409, message: error.humanReason }
  }
  return { status: 500, message: '确认卡暂时处理不了。请稍后再试。' }
}
