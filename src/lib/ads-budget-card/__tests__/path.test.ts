import { describe, expect, it } from 'vitest'
import { interpretBudgetOutcome, kernelInput, readbackFromSteps } from '../path'
import { loadApprovedLock, planHashOf, sameLock, type PrescriptionLock } from '../prescription-lock'

const lock: PrescriptionLock = {
  prescriptionId: 'p1110000-0000-4000-8000-000000000001',
  version: 2,
  goalId: '90a10000-0000-4000-8000-00000000000a',
  planId: 'plan-1',
  planHash: 'hash-1',
  approvedOn: '2026-11-02',
}

describe('budget path result', () => {
  it('treats a matching read-back as done and a mismatch as closed', () => {
    const matched = interpretBudgetOutcome({
      kind: 'succeeded', runId: 'run-1', humanReason: null, readbackCents: 120, verificationPassed: true,
    }, 120)
    expect(matched).toMatchObject({ kind: 'executed', wrote: true, readbackCents: 120 })
    const missed = interpretBudgetOutcome({
      kind: 'succeeded', runId: 'run-1', humanReason: null, readbackCents: 100, verificationPassed: false,
    }, 120)
    expect(missed.kind).toBe('mismatch')
    expect(missed.wrote).toBe(true)
  })

  it('does not treat an idempotent hit as a second write', () => {
    const again = interpretBudgetOutcome({
      kind: 'idempotent_hit', runId: 'run-1', humanReason: null, readbackCents: 120, verificationPassed: true,
    }, 120)
    expect(again).toMatchObject({ kind: 'executed', wrote: false })
  })

  it('leaves a raise that is still waiting, and a dead letter, without another write', () => {
    const waiting = interpretBudgetOutcome({
      kind: 'pending_approval', runId: 'run-1', humanReason: '还在等', readbackCents: null, verificationPassed: null,
    }, 120)
    expect(waiting).toMatchObject({ kind: 'awaiting', wrote: false })
    const dead = interpretBudgetOutcome({
      kind: 'dead_letter', runId: 'run-1', humanReason: null, readbackCents: 90, verificationPassed: false,
    }, 120)
    expect(dead.kind).toBe('mismatch')
    expect(readbackFromSteps([{
      step_key: 'readback',
      output: { daily_budget_now: 90 },
      verification: { passed: false },
    }])).toEqual({ cents: 90, passed: false })
  })

  it('sends the confirmed baseline and prescription lock with both directions', () => {
    const raise = kernelInput({
      cycleDate: '2026-11-02', adAccountId: 'act_1', adsetId: '1', beforeCents: 100, afterCents: 120, raising: true, lock,
    })
    expect(raise).toMatchObject({ before_cents: 100, after_cents: 120, card_prescription_id: lock.prescriptionId, card_version: 2 })
    const cut = kernelInput({
      cycleDate: '2026-11-02', adAccountId: 'act_1', adsetId: '1', beforeCents: 100, afterCents: 80, raising: false, lock,
    })
    expect(cut.before_cents).toBe(100)
    expect(cut.after_cents).toBe(80)
    expect(cut.card_goal_id).toBe(lock.goalId)
  })
})

describe('prescription version lock', () => {
  it('matches only the same version, goal, and plan', () => {
    expect(sameLock(lock, { ...lock })).toBe(true)
    expect(sameLock(lock, { ...lock, version: 3 })).toBe(false)
    expect(sameLock(lock, { ...lock, goalId: 'other-goal' })).toBe(false)
    expect(sameLock(lock, { ...lock, planHash: 'other' })).toBe(false)
    expect(planHashOf('plan-1', { schema_version: 1 })).toBe(planHashOf('plan-1', { schema_version: 1 }))
    expect(planHashOf('plan-1', { schema_version: 1 })).not.toBe(planHashOf('plan-2', { schema_version: 1 }))
  })

  it('refuses a prescription that is not approved', async () => {
    const unread = await loadApprovedLock(fake({ status: 'draft', version: 1, goal_id: lock.goalId, approved_at: '2026-11-02T00:00:00.000Z' }), 'c', lock.prescriptionId)
    expect(unread.ok).toBe(false)
    const missingGoal = await loadApprovedLock(fake({ status: 'approved', version: 1, goal_id: null, approved_at: '2026-11-02T00:00:00.000Z' }), 'c', lock.prescriptionId)
    expect(missingGoal.ok).toBe(false)
  })
})

function fake(row: Record<string, unknown>) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { id: lock.prescriptionId, content: {}, generation_meta: {}, ...row }, error: null }),
  }
  return { from: () => chain } as unknown as Parameters<typeof loadApprovedLock>[0]
}
