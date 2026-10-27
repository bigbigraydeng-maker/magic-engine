import { describe, expect, it, vi } from 'vitest'
import {
  runWithStore, type LaunchCheckStore, type OutcomeInsert, type StoredPrescription,
} from '../prescription-launch-check-run'
import type { ActionRow } from '../prescription-launch-check'

const NOW = new Date('2026-11-02T00:00:00.000Z')

function prescription(): StoredPrescription {
  return {
    id: 'rx-1',
    clientId: 'client-1',
    goalId: 'goal-1',
    status: 'approved',
    approvedAt: '2026-10-25T10:20:00.000Z',
    kpis: [
      { metric: '线索', target: 10, unit: '条' },
      { metric: '成本', target: 12, unit: 'NZD' },
    ],
  }
}

function action(): ActionRow {
  return {
    id: 'act-1',
    clientId: 'client-1',
    payload: {
      status: 'active',
      campaignId: 'camp-1',
      activation: { status: 'executed', authorized_at: '2026-10-25T11:00:00.000Z' },
    },
  }
}

function store(over: Partial<LaunchCheckStore> = {}) {
  const insertOutcome = vi.fn(async (_row: OutcomeInsert) => undefined)
  const updateOutcome = vi.fn(async (_id: string, _patch: { unit: string; dimension: string }) => undefined)
  const db: LaunchCheckStore = {
    listClientActions: async () => [action()],
    listAllActions: async () => ({ rows: [action()], partial: false }),
    listApprovedPlans: async () => [{ goalId: 'goal-1', approvedAt: '2026-10-25T10:10:00.000Z' }],
    listApprovedPrescriptions: async (clientId: string) => [prescription()].filter(item => item.clientId === clientId),
    // One row per NZ day from launch day (10-26) to the day before NOW's day-7 deadline.
    listInsights: async () => ['26', '27', '28', '29', '30', '31'].map((d, i) => ({
      insightDate: `2026-10-${d}`, spend: i === 0 ? 96 : 0, results: i === 0 ? 12 : 0,
    })).concat([{ insightDate: '2026-11-01', spend: 0, results: 0 }]),
    findCaseId: async () => 'case-1',
    listOutcomes: async () => [],
    insertOutcome,
    updateOutcome,
    ...over,
  }
  return { db, insertOutcome, updateOutcome }
}

describe('runWithStore', () => {
  it('inserts due checks and leaves target and actual empty', async () => {
    const { db, insertOutcome, updateOutcome } = store()
    const receipt = await runWithStore(db, NOW)
    expect(receipt.outcomes_written).toBe(3)
    expect(receipt.failed).toBe(0)
    expect(insertOutcome).toHaveBeenCalledTimes(3)
    for (const call of insertOutcome.mock.calls) {
      const row = call[0]
      expect(row.unit).toBe('met')
      expect(row).not.toHaveProperty('data_source')
      expect(row).not.toHaveProperty('actual_value')
      expect(row).not.toHaveProperty('target_value')
    }
    expect(updateOutcome).not.toHaveBeenCalled()
  })

  it('does not insert when the case row is missing', async () => {
    const { db, insertOutcome } = store({ findCaseId: async () => null })
    const receipt = await runWithStore(db, NOW)
    expect(receipt.unsaved).toBe(1)
    expect(receipt.outcomes_written).toBe(0)
    expect(insertOutcome).not.toHaveBeenCalled()
  })

  it('does not overwrite a row already marked met', async () => {
    const { db, insertOutcome, updateOutcome } = store({
      listOutcomes: async () => [
        { id: 'kept', kpiMetric: 'launch_check_24h', unit: 'met', dimension: '旧' },
        { id: 'kept-48', kpiMetric: 'launch_check_48h', unit: 'missed', dimension: '旧' },
      ],
    })
    const receipt = await runWithStore(db, NOW)
    expect(receipt.outcomes_skipped).toBe(2)
    expect(insertOutcome.mock.calls.map(call => call[0].kpiMetric)).toEqual(['launch_check_day7'])
    expect(updateOutcome).not.toHaveBeenCalled()
  })

  it('does not invent a not-launched result for clients past the page cap', async () => {
    const { db, insertOutcome } = store({
      listAllActions: async () => ({ rows: [action()], partial: true }),
    })
    const receipt = await runWithStore(db, NOW)
    expect(receipt.partial).toBe(true)
    expect(receipt.launches).toBe(1)
    expect(receipt.prescriptions_checked).toBe(1)
    expect(insertOutcome.mock.calls.every(call => call[0].clientId === 'client-1')).toBe(true)
  })
})
