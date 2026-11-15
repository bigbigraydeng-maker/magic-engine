/** Plain-language facts. The what-line is also the click router. */

import { ACTIVATE_AD_SENTENCE, ACTIVATE_AD_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import type { CardFacts } from '@/lib/confirmation-card/facts'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'

export interface ActivateNames {
  readonly adName: string
  readonly adsetName: string
}

export function activateSubject(adId: string): string {
  const stamp = canonicalHashOfInput({ adId }).slice(0, 12)
  return `activate-ad:${stamp}`
}

export function activateFacts(adId: string, names: ActivateNames): CardFacts {
  return {
    subjectKey: activateSubject(adId),
    what: ACTIVATE_AD_WHAT,
    account: `广告：${names.adName}`,
    amount: '不加预算',
    date: `广告组：${names.adsetName}`,
    scope: ACTIVATE_AD_SENTENCE,
    hardChecks: [{
      label: '确认后才改',
      state: 'green',
      reason: '这一步只出卡，不会改广告，也不会加预算',
    }],
  }
}

export function plainName(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const text = value.trim()
  if (!text || text.length > 40 || /[{}[\]`]/.test(text)) return fallback
  return text
}
