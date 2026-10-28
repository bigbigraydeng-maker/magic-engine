/**
 * The confirmation card for whatever the page check could not settle.
 * The green line does not mean the page passed. The sentences above it do.
 */

import {
  contentFingerprint,
  normalizeFacts,
  type CardFacts,
} from '@/lib/confirmation-card'
import { landingSubjectKey } from './destination'
import type { LandingReceipt } from './receipt'

const WHAT = '请确认这条广告的落地页或表单'
const AMOUNT = '这次核实不花钱'
const DATE = '查完后 36 小时内有效'

function clip(value: string): string {
  const text = value.replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.slice(0, 180) || '请看这次核实结果'
}

function accountLine(label: string | null): string {
  if (!label) return '读不到广告账户'
  const text = label.trim()
  if (!text || text.length > 180 || /[{}[\]`]/.test(text) || /act_\d/i.test(text)) {
    return '读不到广告账户'
  }
  return text
}

export function landingCardFacts(
  draftId: string,
  accountLabel: string | null,
  receipt: LandingReceipt,
): CardFacts | null {
  const subjectKey = landingSubjectKey(draftId)
  if (!subjectKey) return null
  const open = receipt.items.filter((row) => row.state === 'fail' || row.state === 'unchecked')
  const scope = clip(open.map((row) => row.detail).join('；'))
  return normalizeFacts({
    subjectKey,
    what: WHAT,
    account: accountLine(accountLabel),
    amount: AMOUNT,
    date: DATE,
    scope,
    hardChecks: [{ label: '请你看过再点', state: 'green', reason: `点确认表示你接受这次核实结果。目标校验码 ${receipt.destinationKey}` }],
  })
}

export function landingCardFingerprint(facts: CardFacts): string {
  return contentFingerprint(normalizeFacts(facts))
}
