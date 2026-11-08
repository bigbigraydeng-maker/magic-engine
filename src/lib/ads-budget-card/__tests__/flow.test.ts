import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CLIENT_A, GOAL_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { issueBudgetCard, submitBudgetCard } from '../flow'
import type { BudgetHold } from '../ledger'
import type { BudgetExecuteResult, BudgetPath } from '../path'
import type { PrescriptionLock, VersionLockSource } from '../prescription-lock'
import type { BudgetOrder, BudgetRuntime, BudgetSnapshot } from '../types'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }
const PRESCRIPTION = 'p1110000-0000-4000-8000-000000000001'

const order: BudgetOrder = {
  prescriptionId: PRESCRIPTION,
  adsetId: '111',
  adAccountId: 'act_111111',
  newDailyBudgetCents: 120,
  name: '春季组',
  expectedMetric: 'ads.account.cpa',
  direction: 'down',
  observationWindowDays: 7,
}

const lock: PrescriptionLock = {
  prescriptionId: PRESCRIPTION,
  version: 2,
  goalId: GOAL_A,
  planId: 'plan-1',
  planHash: 'hash-1',
  approvedOn: '2026-11-02',
}

function live(over: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    registeredAccountIds: ['act_111111'],
    accountId: '111111',
    adsetId: '111',
    status: 'ACTIVE',
    currentCents: 100,
    name: '春季组',
    accountCapCents: 500,
    accountLiveCents: 400,
    countedInLive: true,
    otherAccountsLiveCents: 0,
    clientCapCents: 900,
    lifetimeBlocks: false,
    stepRatio: 0.2,
    ...over,
  }
}

function locks(box: { current: PrescriptionLock } = { current: lock }): VersionLockSource {
  return { read: async () => ({ ok: true, lock: box.current }) }
}

function harness(start: BudgetSnapshot, result?: BudgetExecuteResult | Error) {
  const box = { current: start }
  const calls: number[] = []
  const runtime: BudgetRuntime = { read: async () => box.current }
  const path: BudgetPath = {
    execute: async (call) => {
      calls.push(call.afterCents)
      if (result instanceof Error) throw result
      return result ?? {
        kind: 'executed',
        wrote: true,
        readbackCents: call.afterCents,
        actionRunId: 'run-1',
        reason: '已改好，回读的日预算和要改的一致。',
      }
    },
  }
  return {
    runtime,
    path,
    calls,
    setLive(next: BudgetSnapshot) { box.current = next },
  }
}

function fixture() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => createCapabilities(sb),
    startAt: '2026-11-02T00:00:00.000Z',
  })
}

function submitArgs(
  f: ReturnType<typeof fixture>,
  h: ReturnType<typeof harness>,
  issued: Awaited<ReturnType<typeof issueBudgetCard>>,
  source: VersionLockSource = locks(),
) {
  return {
    kernel: f.kernel,
    clientId: CLIENT_A,
    runId: issued.card?.runId ?? '',
    clicker: OPC,
    resolution: 'confirm' as const,
    expectedDecisionId: issued.card?.expectedDecisionId ?? '',
    fingerprint: issued.card?.fingerprint ?? '',
    runtime: h.runtime,
    locks: source,
    path: h.path,
  }
}

describe('budget step card', () => {
  it('does not change the budget until a person confirms, then records the readback', async () => {
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(),
    })
    expect(h.calls).toEqual([])
    expect(issued.card?.confirmEnabled).toBe(true)
    const done = await submitBudgetCard(submitArgs(f, h, issued))
    expect(done.status).toBe('executed')
    expect(h.calls).toEqual([120])
    const row = f.tables.flywheel_actions[0]
    const payload = row?.payload as BudgetHold
    expect(row?.action_type).toBe('ads.adjust_adset_daily_budget')
    expect(row?.expected_metric).toBe('ads.account.cpa')
    expect(row?.expected_delta).toBe(-1)
    expect(payload).toMatchObject({
      beforeCents: 100,
      afterCents: 120,
      direction: 'down',
      observationWindowDays: 7,
      readbackCents: 120,
      readbackMatched: true,
      status: 'executed',
      lock: { version: 2, goalId: GOAL_A, planId: 'plan-1' },
    })
    expect(payload.idempotencyKey.length).toBeGreaterThan(10)
  })

  it('does not execute the same card twice', async () => {
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(),
    })
    await submitBudgetCard(submitArgs(f, h, issued))
    const second = await submitBudgetCard(submitArgs(f, h, issued))
    expect(second.status).toBe('executed')
    expect(h.calls).toEqual([120])
  })

  it('does not retry a row left in writing', async () => {
    const h = harness(live(), new Error('ledger vanished'))
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(),
    })
    const first = await submitBudgetCard(submitArgs(f, h, issued))
    expect(first.reason).toMatch(/正在写/)
    expect(h.calls).toEqual([120])
    const second = await submitBudgetCard(submitArgs(f, h, issued))
    expect(second.reason).toMatch(/正在写/)
    expect(h.calls).toEqual([120])
    const payload = f.tables.flywheel_actions[0]?.payload as BudgetHold
    expect(payload.status).toBe('writing')
  })

  it('fails closed when the prescription version changed', async () => {
    const box = { current: lock }
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(box),
    })
    box.current = { ...lock, version: 3 }
    const done = await submitBudgetCard(submitArgs(f, h, issued, locks(box)))
    expect(done.status).toBe('blocked')
    expect(done.reason).toMatch(/作废/)
    expect(h.calls).toEqual([])
  })

  it('fails closed when the budget changed after the card was shown', async () => {
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(),
    })
    h.setLive(live({ currentCents: 110 }))
    const done = await submitBudgetCard(submitArgs(f, h, issued))
    expect(done.status).toBe('blocked')
    expect(done.reason).toMatch(/不一样/)
    expect(h.calls).toEqual([])
  })

  it('marks a readback mismatch failed and does not write again', async () => {
    const h = harness(live(), {
      kind: 'mismatch',
      wrote: true,
      readbackCents: 100,
      actionRunId: 'run-1',
      reason: '回读的日预算和要改的不一样，已标失败，没有再写一次。',
    })
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(),
    })
    const first = await submitBudgetCard(submitArgs(f, h, issued))
    expect(first.status).toBe('failed')
    expect(first.reason).toMatch(/不一样/)
    expect(h.calls).toEqual([120])
    const row = f.tables.flywheel_actions[0]?.payload as BudgetHold
    expect(row).toMatchObject({ status: 'failed', readbackCents: 100, readbackMatched: false })
    const second = await submitBudgetCard(submitArgs(f, h, issued))
    expect(second.status).toBe('failed')
    expect(h.calls).toEqual([120])
  })

  it('does not write when an expired card is confirmed', async () => {
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(),
    })
    f.clock.now = new Date(f.clock.now.getTime() + 31 * 60 * 1000)
    const done = await submitBudgetCard(submitArgs(f, h, issued))
    expect(done.wroteMeta).toBe(false)
    expect(h.calls).toEqual([])
  })

  it('does not write when the person declines or an agent tries to click', async () => {
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(),
    })
    await expect(issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: AGENT, order, runtime: h.runtime, locks: locks(),
    })).rejects.toThrow(/不能点/)
    const declined = await submitBudgetCard({ ...submitArgs(f, h, issued), resolution: 'decline' })
    expect(declined.status).toBe('declined')
    expect(h.calls).toEqual([])
  })

  it('counts another account live budget before it will write', async () => {
    const h = harness(live({ otherAccountsLiveCents: 200, clientCapCents: 600 }))
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime, locks: locks(),
    })
    expect(issued.card?.confirmEnabled).toBe(false)
    const done = await submitBudgetCard(submitArgs(f, h, issued))
    expect(done.reason).toMatch(/加在一起/)
    expect(h.calls).toEqual([])
  })

  it('does not keep a second budget writer', () => {
    const meta = readFileSync('src/lib/ads-budget-card/meta.ts', 'utf8')
    const kernel = readFileSync('src/lib/ads-budget-card/kernel-path.ts', 'utf8')
    const flow = readFileSync('src/lib/ads-budget-card/flow.ts', 'utf8')
    expect(meta + kernel + flow).not.toMatch(/setAdSetDailyBudget|setCampaignDailyBudget/)
  })
})
