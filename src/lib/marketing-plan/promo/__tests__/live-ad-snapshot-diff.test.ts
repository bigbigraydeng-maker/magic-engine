import { describe, expect, it } from 'vitest'
import {
  captureTrustKey,
  fieldChangesFromSnapshots,
  meLedgerExplainsChange,
  type AdsetSnapshotRow,
  type MeLedgerEntry,
} from '../live-ad-snapshot-diff'

const trusted = new Set([captureTrustKey('act_demo', '2026-10-02T00:00:00.000Z'), captureTrustKey('act_demo', '2026-10-03T00:00:00.000Z')])

function row(over: Partial<AdsetSnapshotRow> & Pick<AdsetSnapshotRow, 'capturedAt'>): AdsetSnapshotRow {
  return {
    entityId: 'set-a',
    adAccountId: 'act_demo',
    capturedAt: over.capturedAt,
    dailyBudgetMinor: over.dailyBudgetMinor ?? 1000,
    effectiveStatus: over.effectiveStatus ?? 'ACTIVE',
  }
}

describe('live-ad-snapshot-diff', () => {
  it('ignores snapshots from incomplete captures and diffs consecutive trusted rows', () => {
    const changes = fieldChangesFromSnapshots([
      row({ capturedAt: '2026-10-01T00:00:00.000Z', dailyBudgetMinor: 800 }),
      row({ capturedAt: '2026-10-02T00:00:00.000Z', dailyBudgetMinor: 800 }),
      row({ capturedAt: '2026-10-03T00:00:00.000Z', dailyBudgetMinor: 1200, effectiveStatus: 'PAUSED' }),
    ], trusted)
    expect(changes).toEqual([
      {
        kind: 'budget',
        adSetId: 'set-a',
        fromAt: '2026-10-02T00:00:00.000Z',
        at: '2026-10-03T00:00:00.000Z',
        beforeMinor: 800,
        afterMinor: 1200,
      },
      {
        kind: 'status',
        adSetId: 'set-a',
        fromAt: '2026-10-02T00:00:00.000Z',
        at: '2026-10-03T00:00:00.000Z',
        beforeStatus: 'ACTIVE',
        afterStatus: 'PAUSED',
      },
    ])
  })

  it('ties a budget change to a kernel ledger entry in the snapshot window', () => {
    const change = {
      kind: 'budget' as const,
      adSetId: 'set-a',
      fromAt: '2026-10-02T00:00:00.000Z',
      at: '2026-10-03T00:00:00.000Z',
      beforeMinor: 800,
      afterMinor: 1200,
    }
    const ledger: MeLedgerEntry[] = [{
      runId: 'r1',
      actionKey: 'ads.scale_unit_budget',
      adSetId: 'set-a',
      campaignId: null,
      finishedAt: '2026-10-02T12:00:00.000Z',
      afterMinor: 1200,
    }]
    expect(meLedgerExplainsChange(change, ledger, 'camp-x')).toBe(true)
    expect(meLedgerExplainsChange(change, [{ ...ledger[0]!, afterMinor: 999 }], 'camp-x')).toBe(false)
  })
})
