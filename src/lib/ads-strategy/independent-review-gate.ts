/**
 * Extra guard between the existing hard checks and the pending card.
 * It does not issue, confirm, or write. Callers write the mark onto the
 * card they were already going to issue, or they stop before that card.
 * Unreadable and off both leave the checks untouched.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { HardCheck } from '@/lib/confirmation-card/facts'
import { reviewAdsAgentText } from './independent-review'
import { readIndependentReviewSwitch } from './independent-review-switch'

const CHECK_CAP = 8

export type ReviewHold =
  | { readonly kind: 'keep'; readonly checks: readonly HardCheck[] }
  | { readonly kind: 'return'; readonly reason: string }

export async function markOrHold(
  sb: KernelDeps['supabase'],
  clientId: string,
  checks: readonly HardCheck[],
  guardBlocked: boolean,
  text: string,
): Promise<ReviewHold> {
  if (guardBlocked) return { kind: 'keep', checks }
  const switched = await readIndependentReviewSwitch(sb, clientId)
  if (switched !== 'on') return { kind: 'keep', checks }
  const review = reviewAdsAgentText(text)
  if (review.verdict === 'return') return { kind: 'return', reason: review.reason }
  if (checks.length >= CHECK_CAP) {
    return { kind: 'return', reason: '检查项已满，结论写不上去，没有送审' }
  }
  return { kind: 'keep', checks: [...checks, reviewMark(review.reason)] }
}

function reviewMark(reason: string): HardCheck {
  return { label: '独立复核', state: 'green', reason: clean(reason) }
}

function clean(reason: string): string {
  return reason.replace(/[{}[\]`]/g, '').trim().slice(0, 160)
}
