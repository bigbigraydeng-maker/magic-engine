import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { issueBudgetCard, submitBudgetCard } from '../flow'
import type { BudgetOrder, BudgetRuntime, BudgetSnapshot } from '../types'
import type { BudgetHold } from '../ledger'

const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }

const order: BudgetOrder = {
  adsetId: '111',
  adAccountId: 'act_111111',
  newDailyBudgetCents: 120,
  name: '春季组',
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

function harness(start: BudgetSnapshot) {
  const box = { current: start }
  const writes: number[] = []
  let readback: number | null | undefined
  const runtime: BudgetRuntime = {
    read: async () => box.current,
    write: async (next) => {
      writes.push(next.newDailyBudgetCents)
      return true
    },
    readback: async (next) => (readback === undefined ? next.newDailyBudgetCents : readback),
  }
  return {
    runtime,
    writes,
    setLive(next: BudgetSnapshot) { box.current = next },
    setReadback(cents: number | null) { readback = cents },
  }
}

function fixture() {
  return makeFixture({
    registry: ACTION_REGISTRY,
    capabilities: (sb) => createCapabilities(sb),
    startAt: '2026-11-02T00:00:00.000Z',
  })
}

describe('ad set budget card flow', () => {
  it('does not change the budget until a person confirms, then records the readback', async () => {
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime,
    })
    expect(h.writes).toEqual([])
    expect(issued.card?.what).toBe('把广告组 春季组 的日预算从 1.00 调到 1.20（+20%）')
    expect(issued.card?.confirmEnabled).toBe(true)
    const done = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: issued.card?.runId ?? '',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: issued.card?.expectedDecisionId ?? '',
      fingerprint: issued.card?.fingerprint ?? '',
      runtime: h.runtime,
    })
    expect(done.status).toBe('executed')
    expect(h.writes).toEqual([120])
    const row = f.tables.flywheel_actions[0]
    const payload = row?.payload as BudgetHold
    expect(row?.action_type).toBe('ads.adjust_adset_daily_budget')
    expect(payload).toMatchObject({
      beforeCents: 100,
      afterCents: 120,
      confirmedBy: 'opc@example.com',
      readbackCents: 120,
      readbackMatched: true,
      status: 'executed',
    })
  })

  it('does not write when the jump is past the step cap', async () => {
    const h = harness(live())
    const f = fixture()
    const big = { ...order, newDailyBudgetCents: 121 }
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order: big, runtime: h.runtime,
    })
    expect(issued.status).toBe('blocked')
    expect(issued.card?.confirmEnabled).toBe(false)
    const done = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: issued.card?.runId ?? '',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: issued.card?.expectedDecisionId ?? '',
      fingerprint: issued.card?.fingerprint ?? '',
      runtime: h.runtime,
    })
    expect(done.status).toBe('blocked')
    expect(done.wroteMeta).toBe(false)
    expect(h.writes).toEqual([])
  })

  it('fails closed when the budget changed after the card was shown', async () => {
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime,
    })
    h.setLive(live({ currentCents: 110 }))
    const done = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: issued.card?.runId ?? '',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: issued.card?.expectedDecisionId ?? '',
      fingerprint: issued.card?.fingerprint ?? '',
      runtime: h.runtime,
    })
    expect(done.status).toBe('blocked')
    expect(done.reason).toMatch(/不一样/)
    expect(h.writes).toEqual([])
  })

  it('marks a readback mismatch failed and does not write again', async () => {
    const h = harness(live())
    h.setReadback(100)
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime,
    })
    const first = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: issued.card?.runId ?? '',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: issued.card?.expectedDecisionId ?? '',
      fingerprint: issued.card?.fingerprint ?? '',
      runtime: h.runtime,
    })
    expect(first.status).toBe('failed')
    expect(first.reason).toMatch(/不一样/)
    expect(h.writes).toEqual([120])
    const row = f.tables.flywheel_actions[0]?.payload as BudgetHold
    expect(row).toMatchObject({
      status: 'failed',
      confirmedBy: 'opc@example.com',
      readbackCents: 100,
      readbackMatched: false,
      beforeCents: 100,
      afterCents: 120,
    })
    const second = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: issued.card?.runId ?? '',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: issued.card?.expectedDecisionId ?? '',
      fingerprint: issued.card?.fingerprint ?? '',
      runtime: h.runtime,
    })
    expect(second.status).toBe('failed')
    expect(h.writes).toEqual([120])
  })

  it('does not write when the person declines or an agent tries to click', async () => {
    const h = harness(live())
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime,
    })
    await expect(issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: AGENT, order, runtime: h.runtime,
    })).rejects.toThrow(/不能点/)
    const declined = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: issued.card?.runId ?? '',
      clicker: OPC,
      resolution: 'decline',
      expectedDecisionId: issued.card?.expectedDecisionId ?? '',
      fingerprint: issued.card?.fingerprint ?? '',
      runtime: h.runtime,
    })
    expect(declined.status).toBe('declined')
    expect(h.writes).toEqual([])
    const row = f.tables.flywheel_actions.find((item) => item.payload && (item.payload as BudgetHold).cardRunId === issued.card?.runId)
    expect((row?.payload as BudgetHold).confirmedBy).toBe('opc@example.com')
  })

  it('counts another account live budget before it will write', async () => {
    const h = harness(live({ otherAccountsLiveCents: 200, clientCapCents: 600 }))
    const f = fixture()
    const issued = await issueBudgetCard({
      kernel: f.kernel, clientId: CLIENT_A, clicker: OPC, order, runtime: h.runtime,
    })
    expect(issued.card?.confirmEnabled).toBe(false)
    const done = await submitBudgetCard({
      kernel: f.kernel,
      clientId: CLIENT_A,
      runId: issued.card?.runId ?? '',
      clicker: OPC,
      resolution: 'confirm',
      expectedDecisionId: issued.card?.expectedDecisionId ?? '',
      fingerprint: issued.card?.fingerprint ?? '',
      runtime: h.runtime,
    })
    expect(done.reason).toMatch(/加在一起/)
    expect(h.writes).toEqual([])
  })
})
