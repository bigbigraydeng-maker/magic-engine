import type { StoredReceipt } from './types'
import type { GateViolation } from './types'

export interface FollowUpInput {
  templateKey: string | null
  callEvidenceAt: string | null
  cooldownHours: number
  now: Date
  sentTemplateReceipts: readonly StoredReceipt[]
}

function parseIso(value: string): number | null {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function isSentWithTemplate(receipt: StoredReceipt): boolean {
  return receipt.outcome === 'sent' && receipt.templateKey !== null
}

export function evaluateFollowUp(input: FollowUpInput): GateViolation | null {
  if (input.templateKey === null) return null

  const sent = input.sentTemplateReceipts.filter(isSentWithTemplate)

  if (input.callEvidenceAt !== null) {
    const callMs = parseIso(input.callEvidenceAt)
    if (callMs !== null) {
      const alreadyFollowed = sent.some((r) => {
        const createdMs = parseIso(r.createdAt)
        return createdMs !== null && createdMs > callMs
      })
      if (alreadyFollowed) {
        return {
          code: 'already_followed_up',
          detail: '该通话后已发送过跟进邮件，请勿重复发送。',
        }
      }
    }
  }

  if (input.cooldownHours > 0) {
    const cutoffMs = input.now.getTime() - input.cooldownHours * 60 * 60 * 1000
    const duplicate = sent.some((r) => {
      if (r.templateKey !== input.templateKey) return false
      const createdMs = parseIso(r.createdAt)
      return createdMs !== null && createdMs >= cutoffMs
    })
    if (duplicate) {
      return {
        code: 'duplicate_template',
        detail: `该模板在 ${input.cooldownHours} 小时内已发送过，请稍后再试。`,
      }
    }
  }

  return null
}
