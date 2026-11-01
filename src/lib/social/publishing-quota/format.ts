/**
 * Sentences for the week overview and the daily-plan quota line.
 * A weekly cap is never printed as that day's limit.
 */
import { kindCap, type PublishingQuota, type QuotaCap, type QuotaKind, type QuotaPeriod } from './parse'

const LABEL: Record<QuotaPeriod, string> = { day: '每天', week: '每周' }

export function quotaPhrase(cap: QuotaCap | null, fallback: QuotaPeriod): string {
  if (!cap) return `${LABEL[fallback]}名额未配置`
  return `${LABEL[cap.period]}名额 ${cap.count} 条`
}

export function phraseFor(quota: Partial<PublishingQuota> | null | undefined, kind: QuotaKind, fallback: QuotaPeriod): string {
  return quotaPhrase(kindCap(quota, kind), fallback)
}

/** `row` is the row being counted. A weekly cap does not become that row's denominator. */
export function usagePhrase(used: number, cap: QuotaCap | null, row: QuotaPeriod): string {
  if (!cap) return `${used} 条（名额未配置）`
  if (cap.period !== row) return `${used} 条`
  return `用了 ${used}/${cap.count}`
}
