import { describe, expect, it } from 'vitest'
import { spendFromSnapshots, type SnapshotCaptureRow, type SnapshotSpendRow } from '../paused-draft-spend'

const NOW = Date.parse('2026-11-01T00:00:00.000Z')

function capture(level: 'campaign' | 'adset', over: Partial<SnapshotCaptureRow> = {}): SnapshotCaptureRow {
  return {
    level,
    complete: true,
    skipped_shared: false,
    error: null,
    captured_at: '2026-11-01T00:00:00.000Z',
    ...over,
  }
}

function row(over: Partial<SnapshotSpendRow> = {}): SnapshotSpendRow {
  return {
    ad_account_id: 'act_1',
    level: 'adset',
    entity_id: 'set-1',
    campaign_id: 'camp-1',
    budget_level: 'abo',
    daily_budget_minor: 1000,
    effective_status: 'ACTIVE',
    currency: 'NZD',
    capture_reason: 'daily',
    captured_at: '2026-11-01T00:00:00.000Z',
    objective: null,
    ...over,
  }
}

const covered = [capture('campaign'), capture('adset')]

describe('spendFromSnapshots', () => {
  it('returns null when there are no rows, even if the capture receipt is complete', () => {
    expect(spendFromSnapshots([], covered, NOW).liveDeliveringCents).toBeNull()
    expect(spendFromSnapshots(null, covered, NOW)).toEqual({ liveDeliveringCents: null, campaignShapes: null })
  })

  it('does not treat a missing ad set capture as zero delivering', () => {
    const rows = [
      row({ level: 'campaign', entity_id: 'camp-1', campaign_id: null, budget_level: 'abo', daily_budget_minor: null, objective: 'OUTCOME_LEADS' }),
    ]
    const read = spendFromSnapshots(rows, [capture('campaign'), capture('adset', { complete: false })], NOW)
    expect(read.liveDeliveringCents).toBeNull()
    expect(read.campaignShapes).toEqual([{ entityId: 'camp-1', objective: 'OUTCOME_LEADS', budgetLevel: 'abo' }])
  })

  it('sums delivering rows when both levels were captured, and paused-only is zero', () => {
    expect(spendFromSnapshots([row({ daily_budget_minor: 14500 })], covered, NOW).liveDeliveringCents).toBe(14500)
    const paused = spendFromSnapshots([
      row({ effective_status: 'PAUSED', daily_budget_minor: 4000 }),
    ], covered, NOW)
    expect(paused.liveDeliveringCents).toBe(0)
  })

  it('rejects a stale, skipped, or failed capture', () => {
    const rows = [row()]
    expect(spendFromSnapshots(rows, [capture('campaign', { captured_at: '2026-10-28T00:00:00.000Z' }), capture('adset')], NOW).liveDeliveringCents).toBeNull()
    expect(spendFromSnapshots(rows, [capture('campaign', { skipped_shared: true }), capture('adset')], NOW).liveDeliveringCents).toBeNull()
    expect(spendFromSnapshots(rows, [capture('campaign'), capture('adset', { error: 'incomplete read' })], NOW).liveDeliveringCents).toBeNull()
  })
})
