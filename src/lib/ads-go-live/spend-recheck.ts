/**
 * Compare the spend stored on a paused draft with a fresh read of the same ad set.
 * Pure. Callers stop when this returns a sentence.
 */

import { sameInheritedSpend, type InheritedAdSetSpend } from '@/lib/ads-strategy/ad-draft'
import type { SpendRead } from '@/lib/meta/existing-adset-spend'

const MISSING = '还没读到这个广告组的真实每天预算，没有开。'
const UNREAD = '现在读不到这个广告组的每天预算或结束时间，没有开。'
const CHANGED = '这个广告组的每天预算或结束时间已经变了，跟上次确认的不一样，没有开。'

export function goLiveSpendReason(stored: InheritedAdSetSpend | null, fresh: SpendRead): string | null {
  if (!stored) return MISSING
  if (!fresh.ok) return UNREAD
  return sameInheritedSpend(stored, fresh.spend) ? null : CHANGED
}
