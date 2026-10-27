/**
 * Request bodies for the shared go-live card.
 * Only the two button values count. Chat words and extra fields are refused.
 */

import { parseDecisionBody } from '@/lib/confirmation-card/http'
import { ConfirmationCardError } from '@/lib/confirmation-card'
import { isUuid } from '@/lib/validation-utils'
import { goLiveSubjectKey } from './draft'

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

export function parseGoLiveIssue(value: unknown): string {
  const row = asRecord(value)
  rejectExtra(row, ['draftId'])
  if (typeof row.draftId !== 'string' || !goLiveSubjectKey(row.draftId)) {
    throw new ConfirmationCardError('invalid', '这条草稿的编号不对，没有出卡。')
  }
  return row.draftId.trim()
}

export function parseGoLiveDecision(value: unknown): {
  resolution: 'confirm' | 'decline'
  expectedDecisionId: string
  fingerprint: string
  runId: string
} {
  const row = asRecord(value)
  rejectExtra(row, ['resolution', 'expectedDecisionId', 'fingerprint', 'runId'])
  const runId = row.runId
  const rest = { ...row }
  delete rest.runId
  const body = parseDecisionBody(rest)
  if (typeof runId !== 'string' || !isUuid(runId)) {
    throw new ConfirmationCardError('invalid', '这张卡的编号对不上，请刷新后再点。')
  }
  return { ...body, runId: runId.toLowerCase() }
}
