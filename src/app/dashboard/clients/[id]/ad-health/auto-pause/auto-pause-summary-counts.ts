import type { CardPayload } from '@/components/confirmation-card/HeldCards'
import type { PendingItem } from './use-auto-pause-data'

export function matchPauseCard(p: PendingItem, cards: readonly CardPayload[]): CardPayload | null {
  const name = p.adsetName?.trim()
  if (!name) return null
  return cards.find((c) => c.what.includes(name) || c.scope.includes(name) || c.account.includes(name)) ?? null
}

/** 摘要格计数：确认卡已出只按「待办里能配上暂停卡」的条数算，不和卡片列表再加一遍。 */
export function autoPauseSummaryCounts(
  pending: readonly PendingItem[] | null,
  cards: readonly CardPayload[],
  ledger: ReadonlyArray<{ status: string }>,
) {
  const dismissed = ledger.filter((r) => r.status === 'rejected').length
  const paused = ledger.filter((r) => r.status === 'paused').length
  if (!pending) return { waiting: 0, issued: 0, paused, dismissed }
  const issued = pending.filter((p) => matchPauseCard(p, cards) !== null).length
  const waiting = pending.length - issued
  return { waiting, issued, paused, dismissed }
}
