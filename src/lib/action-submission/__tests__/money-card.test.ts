import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { CLIENT_A, makeFixture, type Fixture } from '@/lib/kernel/__tests__/fixtures'
import type { BudgetSnapshot } from '@/lib/ads-budget-card/types'
import type { CardClicker } from '@/lib/confirmation-card'
import {
  confirmMoneyBudget,
  executeConfirmedMoney,
  issueMoneyBudget,
  loadMoneyHold,
  type MoneyHold,
  type MoneyWriteResult,
} from '../money-card'

const START = '2026-11-09T00:00:00.000Z'
const OPC: CardClicker = { kind: 'opc', email: 'opc@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: null }
const NONE: MoneyWriteResult = { wroteMeta: false, readbackCents: null, reason: '不应该写' }

function fixture(): Fixture {
  return makeFixture({
    registry: ACTION_REGISTRY,
    startAt: START,
    capabilities: (sb) => ({ [CONFIRMATION_ACTION_KEY]: createCapabilities(sb)[CONFIRMATION_ACTION_KEY] }),
  })
}

function live(over: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    registeredAccountIds: ['act_test'],
    accountId: 'act_test',
    adsetId: 'set-1',
    status: 'ACTIVE',
    currentCents: 1000,
    name: '组',
    accountCapCents: 5000,
    accountLiveCents: 1000,
    countedInLive: true,
    otherAccountsLiveCents: 0,
    clientCapCents: 8000,
    lifetimeBlocks: false,
    stepRatio: 0.2,
    ...over,
  }
}

function issue(f: Fixture, after = 800, over: Partial<BudgetSnapshot> = {}, snapshotAt: string | null = START, entityId = 'set-1') {
  const seen = live({ adsetId: entityId, ...over })
  const writes: MoneyWriteResult[] = []
  const write = async (): Promise<MoneyWriteResult> => {
    const result = { wroteMeta: true, readbackCents: after, reason: '已改。' }
    writes.push(result)
    return result
  }
  return {
    writes,
    write,
    card: issueMoneyBudget({
      kernel: f.kernel,
      sb: f.supabase,
      clientId: CLIENT_A,
      clicker: OPC,
      source: after > 1000 ? 'scorecard_up' : 'scorecard_down',
      level: 'adset',
      entityId,
      adAccountId: 'act_test',
      campaignId: 'cmp-1',
      scaleAdsetId: after > 1000 ? 'set-1' : null,
      name: '组',
      beforeCents: 1000,
      afterCents: after,
      snapshotAt,
      goalId: null,
      cycleDate: '2026-11-09',
      requestId: '11111111-2222-4333-8444-555555555555',
      readLive: async () => seen,
      now: f.clock.now,
    }),
  }
}

function confirm(f: Fixture, runId: string, fingerprint: string, write: (hold: MoneyHold) => Promise<MoneyWriteResult>, seen = live()) {
  return confirmMoneyBudget({
    kernel: f.kernel,
    sb: f.supabase,
    clientId: CLIENT_A,
    runId,
    clicker: OPC,
    resolution: 'confirm',
    expectedDecisionId: 'unused-until-loaded',
    fingerprint,
    now: f.clock.now,
    readLive: async () => seen,
    write,
  })
}

describe('money card does not write before a confirmed, unexpired card', () => {
  it('no card → no write', async () => {
    const f = fixture()
    const write = async () => NONE
    const result = await confirm(f, '11111111-2222-4333-8444-555555555556', 'none', write)
    expect(result.handled).toBe(false)
    expect(result.wroteMeta).toBe(false)
  })

  it('unconfirmed card → no write', async () => {
    const f = fixture()
    const opened = issue(f)
    const card = await opened.card
    expect(card.card).toBeTruthy()
    const row = await loadMoneyHold(f.supabase, CLIENT_A, card.card!.runId)
    expect(row).toBeTruthy()
    const result = await executeConfirmedMoney({
      kernel: f.kernel, sb: f.supabase, clientId: CLIENT_A, runId: card.card!.runId,
      clicker: OPC, resolution: 'confirm', expectedDecisionId: card.card!.expectedDecisionId,
      fingerprint: card.card!.fingerprint, now: f.clock.now, write: opened.write,
    }, row!)
    expect(result.wroteMeta).toBe(false)
    expect(opened.writes).toHaveLength(0)
  })

  it('expired card → no write', async () => {
    const f = fixture()
    const opened = issue(f)
    const card = await opened.card
    f.clock.now = new Date(f.clock.now.getTime() + 31 * 60 * 1000)
    const result = await confirmMoneyBudget({
      kernel: f.kernel, sb: f.supabase, clientId: CLIENT_A, runId: card.card!.runId,
      clicker: OPC, resolution: 'confirm', expectedDecisionId: card.card!.expectedDecisionId,
      fingerprint: card.card!.fingerprint, now: f.clock.now, readLive: async () => live(), write: opened.write,
    })
    expect(result.wroteMeta).toBe(false)
    expect(opened.writes).toHaveLength(0)
  })

  it('a step over 20%, a missing plan cap, or a stale snapshot does not write', async () => {
    const f = fixture()
    const tooFar = issue(f, 1600, {}, START, 'set-far')
    const farCard = await tooFar.card
    const far = await confirm(f, farCard.card!.runId, farCard.card!.fingerprint, tooFar.write, live({ adsetId: 'set-far' }))
    expect(far.wroteMeta).toBe(false)
    expect(tooFar.writes).toHaveLength(0)

    const uncapped = issue(f, 1100, { clientCapCents: null }, START, 'set-cap')
    const capCard = await uncapped.card
    const cap = await confirm(f, capCard.card!.runId, capCard.card!.fingerprint, uncapped.write, live({ adsetId: 'set-cap', clientCapCents: null }))
    expect(cap.wroteMeta).toBe(false)

    const stale = issue(f, 800, {}, '2026-11-07T00:00:00.000Z', 'set-old')
    const staleCard = await stale.card
    const old = await confirm(f, staleCard.card!.runId, staleCard.card!.fingerprint, stale.write, live({ adsetId: 'set-old' }))
    expect(old.wroteMeta).toBe(false)
    expect(stale.writes).toHaveLength(0)
  })

  it('a raise does not write unless the clicker is the spend approver', async () => {
    const f = fixture()
    const opened = issue(f, 1100, {}, START, 'set-up')
    const card = await opened.card
    const result = await confirmMoneyBudget({
      kernel: f.kernel, sb: f.supabase, clientId: CLIENT_A, runId: card.card!.runId,
      clicker: OPC, resolution: 'confirm', expectedDecisionId: card.card!.expectedDecisionId,
      fingerprint: card.card!.fingerprint, now: f.clock.now,
      readLive: async () => live({ adsetId: 'set-up' }), write: opened.write,
    })
    expect(result.wroteMeta).toBe(false)
    expect(result.reason).toContain('花钱批准人')
    expect(opened.writes).toHaveLength(0)
  })

  it('an agent cannot confirm, and a confirmed cut writes once', async () => {
    const f = fixture()
    const opened = issue(f)
    const card = await opened.card
    await expect(confirmMoneyBudget({
      kernel: f.kernel, sb: f.supabase, clientId: CLIENT_A, runId: card.card!.runId,
      clicker: AGENT, resolution: 'confirm', expectedDecisionId: card.card!.expectedDecisionId,
      fingerprint: card.card!.fingerprint, now: f.clock.now, readLive: async () => live(), write: opened.write,
    })).rejects.toThrow(/不能点/)
    expect(opened.writes).toHaveLength(0)
    const done = await confirmMoneyBudget({
      kernel: f.kernel, sb: f.supabase, clientId: CLIENT_A, runId: card.card!.runId,
      clicker: OPC, resolution: 'confirm', expectedDecisionId: card.card!.expectedDecisionId,
      fingerprint: card.card!.fingerprint, now: f.clock.now, readLive: async () => live(), write: opened.write,
    })
    expect(done.wroteMeta).toBe(true)
    expect(opened.writes).toHaveLength(1)
  })
})
