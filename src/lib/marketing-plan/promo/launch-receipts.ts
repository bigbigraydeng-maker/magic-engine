/** Executed launch rows that already have a read-back. Does not call Meta or write. */

export type LaunchBasis = 'pm' | 'confirmation_card' | 'recorded'

export interface LaunchReceipt {
  actionId: string
  adSetIds: string[]
  campaignId: string
  /** Original authorization time. Never rewritten. */
  authorizedAt: string
  basis: LaunchBasis
}

export function parseLaunchReceipts(rows: readonly { id: string; payload: unknown }[]): LaunchReceipt[] {
  return rows.flatMap(row => {
    const parsed = parseOne(row)
    return parsed ? [parsed] : []
  })
}

export function authorizedAdSetIds(receipts: readonly LaunchReceipt[]): Set<string> {
  return new Set(receipts.flatMap(receipt => receipt.adSetIds))
}

/** Earliest executed read-back for this ad set. A later row does not replace that time. */
export function earliestReceiptFor(adSetId: string, receipts: readonly LaunchReceipt[]): LaunchReceipt | null {
  const hits = receipts.filter(receipt => receipt.adSetIds.includes(adSetId))
  if (hits.length === 0) return null
  return hits.reduce((best, receipt) => Date.parse(receipt.authorizedAt) < Date.parse(best.authorizedAt) ? receipt : best)
}

function parseOne(row: { id: string; payload: unknown }): LaunchReceipt | null {
  const payload = rec(row.payload)
  const activation = rec(payload?.activation)
  const authorizedAt = str(activation?.authorized_at)
  const actionId = str(row.id)
  const adSetIds = payload ? adSetIdsOf(payload) : []
  if (!payload || payload.status !== 'active' || activation?.status !== 'executed') return null
  if (authorizedAt === '' || Number.isNaN(Date.parse(authorizedAt)) || !hasReadBack(payload)) return null
  if (adSetIds.length === 0 || actionId === '') return null
  return { actionId, adSetIds, campaignId: str(payload.campaignId), authorizedAt, basis: basisOf(activation.basis) }
}

function hasReadBack(payload: Record<string, unknown>): boolean {
  if (typeof payload.readback === 'string' && payload.readback.trim() !== '') return true
  // Go-live writes this only after the settle read-back says the ad is live.
  return typeof payload.goLiveStartedAt === 'string' && !Number.isNaN(Date.parse(payload.goLiveStartedAt))
}

function basisOf(value: unknown): LaunchBasis {
  if (value === 'go_live_card') return 'confirmation_card'
  if (value === 'global_admin') return 'pm'
  return 'recorded'
}

function adSetIdsOf(payload: Record<string, unknown>): string[] {
  const ids: string[] = []
  const single = str(payload.adSetId)
  if (single !== '') ids.push(single)
  if (!Array.isArray(payload.adSetIds)) return ids
  for (const item of payload.adSetIds) {
    const id = str(item)
    if (id !== '' && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
