import { loadLedger } from '@/lib/ledger/load'
import { walkLedger } from '@/lib/ledger/walk'
import { LANE_OF_KIND, isPmKind } from '@/lib/pm-todo/five-kinds'
import type { ManualItemKind } from '@/lib/pm-todo/manual-item-types'
import type { LedgerCardView } from './classify'

export interface LedgerView {
  cards: Map<string, LedgerCardView>
  /** ids of cards for which the ledger lane will today raise a todo that lands in one of PM's five lanes */
  coveredLedgerIds: Set<string>
  parseErrorCount: number
}

/** `ledger_${finding.kind}` is only a ManualItemKind if the exhaustive table knows it. */
function isManualItemKind(key: string): key is ManualItemKind {
  return Object.prototype.hasOwnProperty.call(LANE_OF_KIND, key)
}

export function buildLedgerView(todayNz: string, dir?: string): LedgerView {
  const loaded = dir === undefined ? loadLedger() : loadLedger(dir)

  const cards = new Map<string, LedgerCardView>()
  for (const entry of loaded.entries) {
    cards.set(entry.id, {
      id: entry.id,
      status: entry.status,
      verifiedRef: entry.verifiedRef,
    })
  }

  const coveredLedgerIds = new Set<string>()
  for (const finding of walkLedger(loaded.entries, todayNz)) {
    const key = `ledger_${finding.kind}`
    if (!isManualItemKind(key)) continue
    if (isPmKind(LANE_OF_KIND[key])) coveredLedgerIds.add(finding.entry.id)
  }

  return {
    cards,
    coveredLedgerIds,
    parseErrorCount: loaded.errors.length,
  }
}
