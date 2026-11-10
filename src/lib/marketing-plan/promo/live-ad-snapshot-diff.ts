/**
 * Compare consecutive ad-set snapshots only from complete captures, and tell
 * whether a budget / status change lines up with a Kernel action run (read-back).
 */

export interface AdsetSnapshotRow {
  entityId: string
  adAccountId: string
  capturedAt: string
  dailyBudgetMinor: number | null
  effectiveStatus: string | null
}

export interface BudgetFieldChange {
  kind: 'budget'
  adSetId: string
  fromAt: string
  at: string
  beforeMinor: number
  afterMinor: number
}

export interface StatusFieldChange {
  kind: 'status'
  adSetId: string
  fromAt: string
  at: string
  beforeStatus: string
  afterStatus: string
}

export type FieldChange = BudgetFieldChange | StatusFieldChange

export interface MeLedgerEntry {
  runId: string
  actionKey: string
  adSetId: string | null
  campaignId: string | null
  finishedAt: string
  afterMinor: number | null
}

const BUDGET_ACTION_KEYS = new Set([
  'ads.scale_unit_budget',
  'ads.cut_unit_budget',
  'ads.cut_campaign_budget',
])

const STATUS_ACTION_KEYS = new Set(['ads.pause_unit', 'ads.pause_campaign'])

export function captureTrustKey(adAccountId: string, capturedAt: string): string {
  const account = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId.replace(/^act_/, '')}`
  return `${account}|${capturedAt}`
}

export function fieldChangesFromSnapshots(
  rows: readonly AdsetSnapshotRow[],
  trustedCaptureKeys: ReadonlySet<string>,
): FieldChange[] {
  const grouped = new Map<string, AdsetSnapshotRow[]>()
  for (const row of rows) grouped.set(row.entityId, [...(grouped.get(row.entityId) ?? []), row])
  return [...grouped].flatMap(([entityId, list]) => changesForEntity(entityId, list, trustedCaptureKeys))
}

function changesForEntity(
  entityId: string,
  rows: readonly AdsetSnapshotRow[],
  trusted: ReadonlySet<string>,
): FieldChange[] {
  const sorted = [...rows].sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1))
  const out: FieldChange[] = []
  let prev: AdsetSnapshotRow | null = null
  for (const row of sorted) {
    if (!trusted.has(captureTrustKey(row.adAccountId, row.capturedAt))) continue
    if (prev) {
      out.push(...diffPair(entityId, prev, row))
    }
    prev = row
  }
  return out
}

function diffPair(entityId: string, before: AdsetSnapshotRow, after: AdsetSnapshotRow): FieldChange[] {
  const out: FieldChange[] = []
  if (
    before.dailyBudgetMinor !== null &&
    after.dailyBudgetMinor !== null &&
    before.dailyBudgetMinor !== after.dailyBudgetMinor
  ) {
    out.push({
      kind: 'budget',
      adSetId: entityId,
      fromAt: before.capturedAt,
      at: after.capturedAt,
      beforeMinor: before.dailyBudgetMinor,
      afterMinor: after.dailyBudgetMinor,
    })
  }
  const bStatus = normStatus(before.effectiveStatus)
  const aStatus = normStatus(after.effectiveStatus)
  if (bStatus !== '' && aStatus !== '' && bStatus !== aStatus) {
    out.push({
      kind: 'status',
      adSetId: entityId,
      fromAt: before.capturedAt,
      at: after.capturedAt,
      beforeStatus: bStatus,
      afterStatus: aStatus,
    })
  }
  return out
}

function normStatus(value: string | null): string {
  return (value ?? '').trim()
}

export function meLedgerExplainsChange(change: FieldChange, ledger: readonly MeLedgerEntry[], campaignId: string | null): boolean {
  const windowStart = Date.parse(change.fromAt)
  const windowEnd = Date.parse(change.at)
  if (Number.isNaN(windowStart) || Number.isNaN(windowEnd)) return false
  return ledger.some(entry => {
    const finished = Date.parse(entry.finishedAt)
    if (Number.isNaN(finished) || finished <= windowStart || finished > windowEnd) return false
    if (!entityMatches(entry, change.adSetId, campaignId)) return false
    if (change.kind === 'budget') {
      return BUDGET_ACTION_KEYS.has(entry.actionKey) && entry.afterMinor === change.afterMinor
    }
    return STATUS_ACTION_KEYS.has(entry.actionKey)
  })
}

function entityMatches(entry: MeLedgerEntry, adSetId: string, campaignId: string | null): boolean {
  if (entry.adSetId && entry.adSetId === adSetId) return true
  if (entry.campaignId && campaignId && entry.campaignId === campaignId) return true
  return false
}

export function formatBudgetMinor(minor: number): string {
  const major = minor / 100
  if (!Number.isFinite(major)) return '—'
  return major.toFixed(2)
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE': return '开着'
    case 'PAUSED': return '已暂停'
    case 'CAMPAIGN_PAUSED': return '系列已暂停'
    case 'ADSET_PAUSED': return '已暂停'
    default: return status
  }
}
